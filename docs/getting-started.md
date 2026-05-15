# Getting Started

## Prerequisites

- Node.js 20+
- npm
- Neon Meter firmware running on the M5Stack CoreS3
- Bluetooth enabled on the host computer

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
3. Click `Connect` and allow Bluetooth selection.
4. Click `Sync now`, or enable auto sync.

## Static Preview

For a browser-only UI preview:

```bash
npm run serve
```

Open [http://localhost:3417/](http://localhost:3417/). BLE and live quota sync require Electron.

## Build Installers

```bash
npm run dist
```

Installer artifacts are written to `dist/`. Builds target macOS, Windows, and
Linux on Intel and ARM.
