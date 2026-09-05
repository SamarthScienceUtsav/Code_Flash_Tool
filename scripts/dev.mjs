import { spawn } from "node:child_process";
const bridge = spawn(process.execPath, ["scripts/flash-bridge.mjs"], { stdio: "inherit", windowsHide: true });
const web = spawn(process.execPath, ["node_modules/vinext/dist/cli.js", "dev"], { stdio: "inherit", windowsHide: true });
const stop = () => { bridge.kill(); web.kill(); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
bridge.on("exit", code => { if (code) { web.kill(); process.exitCode = code; } });
web.on("exit", code => { bridge.kill(); process.exitCode = code ?? 0; });
