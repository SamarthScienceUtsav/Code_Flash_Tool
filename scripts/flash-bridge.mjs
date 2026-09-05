import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const PORT = 3210;
const CLI = process.env.ARDUINO_CLI || "C:\\Program Files\\Arduino IDE\\resources\\app\\lib\\backend\\resources\\arduino-cli.exe";
const ESPTOOL = process.env.ESPTOOL || join(process.env.LOCALAPPDATA || "", "Arduino15", "packages", "esp32", "tools", "esptool_py", "5.3.1", "esptool.exe");
const boards = { uno: "arduino:avr:uno", esp32: "esp32:esp32:esp32", cam: "esp32:esp32:esp32cam" };
const DRIVE_FOLDER_ID = "12w02nJfTBFPVHQIK7ImZ8iMsDpza86Y-";
let driveFiles = [
  { id: "1QsdnUgXAoQMDE6DkOp3Aeu5s6ZCOugeg", name: "04_Army_Radar_Watch_Tower.ino.hex", size: 14352 },
  { id: "13U4iTySE3vZCrouGL_5uQxabsFCWi77Y", name: "Ai_Doodle_controlled_Car.ino.bin", size: 0 },
];
const clean = value => value.replace(/\u001b\[[0-9;]*m/g, "").trim();
const decodeHtml = value => value
  .replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;|&#x27;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">");

async function refreshDriveFiles() {
  const response = await fetch(`https://drive.google.com/embeddedfolderview?id=${DRIVE_FOLDER_ID}#list`);
  if (!response.ok) throw new Error(`Google Drive folder listing failed (${response.status}).`);
  const html = await response.text(), files = [];
  const entries = html.matchAll(/class="flip-entry" id="entry-([^"]+)"[\s\S]*?class="flip-entry-title">([\s\S]*?)<\/div>/g);
  for (const match of entries) {
    const name = decodeHtml(match[2].replace(/<[^>]*>/g, "").trim());
    if (/\.(?:bin|hex)$/i.test(name)) files.push({ id: match[1], name, size: 0 });
  }
  if (!files.length) throw new Error("No firmware files were found in the Google Drive folder.");
  driveFiles = files;
  return files;
}

function run(args, command=CLI) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true }); let output = "";
    child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
    child.on("error", reject); child.on("close", code => code === 0 ? resolve(clean(output)) : reject(new Error(clean(output) || `Upload exited with code ${code}`)));
  });
}
function reply(res, status, value) {
  res.writeHead(status, { "content-type":"application/json", "access-control-allow-headers":"content-type", "access-control-allow-methods":"GET,POST,OPTIONS" }); res.end(JSON.stringify(value));
}
async function readJson(req) {
  let body=""; for await (const chunk of req) { body+=chunk; if(body.length>32_000_000) throw new Error("Build is larger than 24 MB."); } return JSON.parse(body);
}

createServer(async (req,res)=>{
  const allowedOrigins = new Set(["http://localhost:3000", "http://127.0.0.1:3000", "https://samarthscienceutsav.github.io"]);
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) res.setHeader("access-control-allow-origin", origin);
  if(req.method==="OPTIONS") return reply(res,204,{});
  try {
    if(req.method==="GET"&&req.url==="/health") return reply(res,200,{ok:true,version:4,mode:"precompiled"});
    if(req.method==="GET"&&req.url==="/drive-files") {
      try { return reply(res,200,{files:await refreshDriveFiles()}); }
      catch (error) { return reply(res,200,{files:driveFiles,warning:error instanceof Error?error.message:String(error)}); }
    }
    if(req.method==="GET"&&req.url?.startsWith("/drive-download?")) {
      const id=new URL(req.url,"http://127.0.0.1").searchParams.get("id"),file=driveFiles.find(item=>item.id===id);
      if(!file) return reply(res,404,{error:"Drive file not found."});
      const download=await fetch(`https://drive.google.com/uc?export=download&id=${file.id}`);
      if(!download.ok) throw new Error(`Google Drive download failed (${download.status}).`);
      const bytes=Buffer.from(await download.arrayBuffer());
      res.writeHead(200,{"content-type":"application/octet-stream","content-length":bytes.length,"content-disposition":`attachment; filename="${file.name}"`});
      return res.end(bytes);
    }
    if(req.method==="GET"&&req.url==="/ports") {
      const found=JSON.parse(await run(["board","list","--format","json"]));
      const ports=(found.detected_ports||[]).filter(item=>item.port?.protocol==="serial").map(item=>({address:item.port.address,label:item.matching_boards?.[0]?.name?`${item.port.address} — ${item.matching_boards[0].name}`:item.port.label}));
      return reply(res,200,{ports});
    }
    if(req.method==="POST"&&req.url==="/upload") {
      const {board,port,files}=await readJson(req);
      if(!(board in boards)) throw new Error("Unsupported board profile.");
      if(typeof port!=="string"||!/^COM\d+$/i.test(port)) throw new Error("Select a valid COM port.");
      if(!Array.isArray(files)||!files.length) throw new Error("No compiled firmware was supplied.");
      const expected=board==="uno"?".hex":".bin";
      if(files.some(file=>typeof file.name!=="string"||!file.name.toLowerCase().endsWith(expected)||typeof file.data!=="string")) throw new Error(`Only ${expected} files are accepted for this board.`);
      const root=await mkdtemp(join(tmpdir(),"flint-upload-"));
      try {
        await mkdir(root,{recursive:true});
        const paths=[];
        for(const file of files){const path=join(root,basename(file.name));await writeFile(path,Buffer.from(file.data,"base64"));paths.push(path);}
        if(board!=="uno"&&paths.length===1) {
          await run(["--chip","esp32","--port",port,"--baud","921600","--before","default-reset","--after","hard-reset","write-flash","-z","0x10000",paths[0]],ESPTOOL);
        } else {
          const args=board==="uno"?["upload","--port",port,"--fqbn",boards[board],"--input-file",paths[0]]:["upload","--port",port,"--fqbn",boards[board],"--input-dir",root];
          await run(args);
        }
        return reply(res,200,{ok:true});
      } finally {await rm(root,{recursive:true,force:true});}
    }
    return reply(res,404,{error:"Not found."});
  } catch(error){return reply(res,400,{error:error instanceof Error?error.message:String(error)});}
}).listen(PORT,"127.0.0.1",()=>console.log(`Firmware upload bridge: http://127.0.0.1:${PORT}`));
