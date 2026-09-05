"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import type { ESPLoader as ESPLoaderType, Transport as TransportType } from "esptool-js";
import { driveFiles } from "./drive-files.generated";

type BoardId = "esp32" | "cam" | "uno";

const boards = {
  esp32: { name: "ESP32", note: "DevKit / WROOM", ext: ".bin", mark: "32" },
  cam: { name: "ESP32-CAM", note: "AI Thinker", ext: ".bin", mark: "CAM" },
  uno: { name: "Arduino Uno", note: "Local uploader required", ext: ".hex", mark: "UNO" },
} as const;

function flashAddress(file: File, fileCount: number) {
  const name = file.name.toLowerCase();
  if (name.includes("bootloader")) return 0x1000;
  if (name.includes("partition")) return 0x8000;
  if (name.includes("boot_app0")) return 0xe000;
  if (fileCount === 1 && (name.includes("merged") || name.includes("factory"))) return 0x0;
  return 0x10000;
}

export default function Home() {
  const [board, setBoard] = useState<BoardId>("esp32");
  const [files, setFiles] = useState<File[]>([]);
  const [connected, setConnected] = useState(false);
  const [manualBoot, setManualBoot] = useState(false);
  const [driveId, setDriveId] = useState("");
  const [driveBusy, setDriveBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState(["Browser flasher is ready.", "Use Chrome or Edge and connect your board."]);
  const portRef = useRef<SerialPort | null>(null);
  const transportRef = useRef<TransportType | null>(null);
  const loaderRef = useRef<ESPLoaderType | null>(null);
  const info = boards[board];
  const size = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);
  const log = (message: string) => setLogs(value => [...value.slice(-7), message]);

  function chooseFiles(incoming: FileList | null) {
    const wanted = incoming ? Array.from(incoming).filter(file => file.name.toLowerCase().endsWith(info.ext)) : [];
    setFiles(board === "uno" ? wanted.slice(0, 1) : wanted);
    setDriveId("");
    setProgress(0);
    log(wanted.length ? `Loaded ${wanted.length} ${info.ext} file${wanted.length === 1 ? "" : "s"}.` : `No ${info.ext} files found.`);
  }

  async function disconnect() {
    try { await transportRef.current?.disconnect(); } catch { /* Port may already be closed. */ }
    portRef.current = null;
    transportRef.current = null;
    loaderRef.current = null;
    setConnected(false);
  }

  function selectBoard(id: BoardId) {
    void disconnect();
    setBoard(id);
    setFiles([]);
    setDriveId("");
    setProgress(0);
    setManualBoot(false);
    log(`${boards[id].name} selected. Add ${boards[id].ext} firmware.`);
  }

  async function connectDevice() {
    if (!("serial" in navigator)) return log("Web Serial is unavailable. Use current Chrome or Edge on desktop.");
    if (board === "uno") return log("Arduino Uno browser flashing is not yet supported. Use the local uploader for Uno.");
    try {
      setBusy(true);
      log(manualBoot ? "Connecting in manual bootloader mode…" : "Connecting…");
      const { ESPLoader, Transport } = await import("esptool-js");
      const port = await navigator.serial.requestPort();
      const transport = new Transport(port, true);
      portRef.current = port;
      transportRef.current = transport;
      const terminal = { clean() {}, write: (data: string) => log(data.trim()), writeLine: (data: string) => log(data.trim()) };
      const loader = new ESPLoader({ transport, baudrate: 115200, terminal, debugLogging: false });
      loaderRef.current = loader;
      const chip = await loader.main(manualBoot ? "no_reset" : "default_reset");
      setConnected(true);
      setManualBoot(false);
      log(`Connected to ${chip}.`);
    } catch (error) {
      await disconnect();
      log(`Connection failed: ${error instanceof Error ? error.message : String(error)}`);
      setManualBoot(true);
      log("Hold BOOT, tap EN/RESET, then retry while still holding BOOT.");
    } finally { setBusy(false); }
  }

  async function chooseDriveFile() {
    const selected = driveFiles.find(file => file.id === driveId);
    if (!selected) return;
    try {
      setDriveBusy(true);
      log(`Loading ${selected.name}…`);
      const response = await fetch(`${import.meta.env.BASE_URL}${selected.path}`);
      if (!response.ok) throw new Error(`Firmware request failed (${response.status}).`);
      const firmware = new File([await response.blob()], selected.name, { type: "application/octet-stream" });
      setFiles([firmware]);
      setProgress(0);
      log(`Loaded ${selected.name}.`);
    } catch (error) {
      log(`Drive firmware failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally { setDriveBusy(false); }
  }

  async function upload() {
    if (board === "uno") return log("Arduino Uno browser flashing is not yet supported. Use the local uploader.");
    if (!files.length) return log(`Choose ${info.ext} firmware first.`);
    if (!connected || !loaderRef.current) return log("Connect the board first.");
    try {
      setBusy(true);
      setProgress(1);
      const images = await Promise.all(files.map(async file => ({
        data: new Uint8Array(await file.arrayBuffer()),
        address: flashAddress(file, files.length),
      })));
      log(`Flashing ${images.length} image${images.length === 1 ? "" : "s"}…`);
      await loaderRef.current.writeFlash({
        fileArray: images,
        flashMode: "dio",
        flashFreq: "40m",
        flashSize: "keep",
        eraseAll: false,
        compress: true,
        reportProgress: (_index, written, total) => setProgress(Math.round((written / total) * 100)),
      });
      await loaderRef.current.after("hard_reset");
      setProgress(100);
      log("Upload complete. The board has restarted.");
    } catch (error) {
      setProgress(0);
      log(`Upload failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
      await disconnect();
    }
  }

  return <main>
    <header className="siteHeader"><div className="appIdentity"><a className="scienceBrand" href="https://www.scienceutsav.com/" target="_blank" rel="noreferrer"><img src="/science-utsav-logo.png" alt="Science Utsav — Science is awesome" /></a><span className="appTitle">Flash Code Uploader</span></div><div className="headerRight"><span className="secure"><i /> BROWSER & SECURE</span><a href="#guide">HOW IT WORKS</a><button className="help">?</button></div></header>
    <section className="workflowIntro"><div><span>WEB SERIAL FLASHER</span><h1>Flash your board with confidence.</h1><p>No application install required. Use Chrome or Edge and connect over USB.</p></div><ol><li className="done"><b>1</b> Board</li><li className={files.length ? "done" : ""}><b>2</b> Firmware</li><li className={connected ? "done" : ""}><b>3</b> Device</li></ol></section>
    <section className="workspace">
      <div className="panel boardPanel"><div className="panelHead"><span>01</span><div><h2>Choose your board</h2><p>Pick the hardware connected via USB</p></div></div><div className="boardGrid">{(Object.keys(boards) as BoardId[]).map(id => <button key={id} onClick={() => selectBoard(id)} className={`board ${board === id ? "selected" : ""}`}><div className="chipMark">{boards[id].mark}</div><strong>{boards[id].name}</strong><small>{boards[id].note}</small><span className="check">✓</span></button>)}</div><div className="tip"><b>USB TIP</b><span>Use a data-capable cable. Web Serial works in desktop Chrome and Edge.</span></div></div>
      <div className="panel uploadPanel"><div className="panelHead"><span>02</span><div><h2>Add compiled firmware</h2><p>{board === "uno" ? "Choose the Arduino .hex file" : "Choose the complete ESP .bin build folder"}</p></div></div><label className={`drop ${files.length ? "hasFiles" : ""}`} onDragOver={event => event.preventDefault()} onDrop={(event: DragEvent) => { event.preventDefault(); chooseFiles(event.dataTransfer.files); }}><input type="file" multiple={board !== "uno"} accept={info.ext} onChange={(event: ChangeEvent<HTMLInputElement>) => chooseFiles(event.target.files)} /><div className="uploadIcon">↑</div>{files.length ? <><strong>{files.length} file{files.length === 1 ? "" : "s"} ready</strong><span>{files.map(file => file.name).join(" · ")}</span></> : <><strong>Drop firmware here</strong><span>or click to browse · {info.ext} · max 24 MB</span></>}<button type="button">CHOOSE FILE{board === "uno" ? "" : "S"}</button></label>{board !== "uno" && <label className="folderPick"><input type="file" multiple {...({ webkitdirectory: "" } as object)} onChange={(event: ChangeEvent<HTMLInputElement>) => chooseFiles(event.target.files)} /><span>□</span> Select compiled build folder <b>Finds .bin files →</b></label>}<div className="drivePick"><span className="driveLabel">OR SELECT FROM GOOGLE DRIVE</span><div><select aria-label="Google Drive firmware" value={driveId} onChange={event => setDriveId(event.target.value)}><option value="">Choose {info.ext} firmware</option>{driveFiles.filter(item => item.name.toLowerCase().endsWith(info.ext)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" disabled={!driveId || driveBusy} onClick={chooseDriveFile}>{driveBusy ? "LOADING…" : "USE FILE"}</button></div><a href="https://drive.google.com/drive/folders/12w02nJfTBFPVHQIK7ImZ8iMsDpza86Y-" target="_blank" rel="noreferrer">Open firmware folder ↗</a></div></div>
      <aside className="panel flashPanel"><div className="panelHead"><span>03</span><div><h2>Flash device</h2><p>Connect with Web Serial and start upload</p></div></div><div className="summary"><div><span>BOARD</span><b>{info.name}</b></div><div><span>FIRMWARE</span><b>{files.length ? `${files.length} file · ${(size / 1024).toFixed(1)} KB` : "Not selected"}</b></div><div><span>FORMAT</span><b>{info.ext}</b></div></div><label className="controlLabel">USB DEVICE</label><div className="portRow"><button type="button" disabled={busy || board === "uno"} onClick={connected ? disconnect : connectDevice}>{connected ? "DISCONNECT" : manualBoot ? "RETRY CONNECTION" : "CONNECT DEVICE"}</button></div>{manualBoot && !connected && <div className="tip"><b>MANUAL BOOT</b><span>Hold BOOT, tap EN/RESET, then click Retry while holding BOOT.</span></div>}<button className="flashBtn" disabled={busy || !files.length || !connected || board === "uno"} onClick={upload}>{board === "uno" ? "UNO REQUIRES LOCAL UPLOADER" : busy ? "WORKING…" : "FLASH FIRMWARE →"}</button><div className="progress"><i style={{ width: `${progress}%` }} /></div><div className="connection"><i className={connected ? "on" : ""} />{progress === 100 ? "UPLOAD COMPLETE" : connected ? "DEVICE CONNECTED" : "WAITING FOR DEVICE"}<span>{progress}%</span></div><div className="console">{logs.slice(-4).map((entry, index) => <p key={index}><span>›</span>{entry}</p>)}</div></aside>
    </section>
    <section id="guide" className="guide"><p>QUICK START</p><h2>Three steps. One minute.</h2><div><article><span>1</span><b>Select board</b><p>Use ESP32 or ESP32-CAM in Chrome or Edge.</p></article><article><span>2</span><b>Add compiled build</b><p>Select every .bin file from the Arduino build folder.</p></article><article><span>3</span><b>Connect & flash</b><p>Choose the USB serial device and keep it connected.</p></article></div></section>
    <footer className="siteFooter"><div><strong>Built for curious minds and moving machines.</strong><span>Made by Samarth Kulkarni</span></div><nav aria-label="Footer links"><a href="https://www.scienceutsav.com/" target="_blank" rel="noreferrer">ScienceUtsav</a><a href="https://store.scienceutsav.com/" target="_blank" rel="noreferrer">Store</a><a href="https://www.scienceutsav.com/contact-us" target="_blank" rel="noreferrer">Support</a></nav></footer>
  </main>;
}
