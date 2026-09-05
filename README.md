# Flint firmware uploader

Local web application for uploading precompiled firmware over a selected COM port.

- Arduino Uno: select one `.hex` file.
- ESP32 / ESP32-CAM: select the compiled build folder containing its `.bin` files.

## Requirements

- Node.js 22.13 or newer
- Arduino IDE 2 installed with the Arduino AVR and ESP32 board platforms

## Run

Double-click `START_APP.cmd`, or run:

```powershell
npm install
npm run dev
```

Open http://localhost:3000, select the board and COM port, add the compiled firmware, and click **Flash firmware**.
