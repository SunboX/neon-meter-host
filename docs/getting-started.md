# Getting Started

## Prerequisites

- Node.js 20+
- npm
- Neon Meter firmware running on the M5Stack CoreS3
- USB cable connected to the CoreS3, or Bluetooth enabled on the host computer
- Linux only: BlueZ running and adapter access for the desktop user

## Install

```bash
npm install
```

## Start Electron

```bash
npm start
```

Neon Meter automatically detects Claude Code credentials and Codex auth from
the local machine. There is no API-token field in the UI.

## Connect and Sync

1. Power on the CoreS3 running Neon Meter firmware.
2. Start Neon Meter Host.
3. Click `Connect` once so Neon Meter can store the local device identity.
4. Click `Sync now`, or enable auto sync.

Electron builds prefer USB when the CoreS3 is connected by cable. If USB is not
present, the app uses native BLE and can reconnect to the latest BLE device on
restart without showing the Bluetooth chooser.

## Update Firmware

Connect the CoreS3 over USB, then use `Install or update` in the Firmware panel.
The app releases its serial connection automatically, flashes the published
split images without erasing NVS, reconnects over USB, and verifies the reported
firmware version. This safe path preserves BLE identity and pairing data.

`Factory reinstall` is an advanced recovery action. It requires confirmation
because it erases local state and pairing data before writing the merged factory
image.

## Static Preview

For a browser-only UI preview:

```bash
npm run serve
```

Open [http://localhost:3417/](http://localhost:3417/). USB/BLE and live quota sync require Electron.

## Build Installers

```bash
npm run dist
```

Installer artifacts are written to `dist/`. Builds target macOS, Windows, and
Linux on Intel and ARM.
