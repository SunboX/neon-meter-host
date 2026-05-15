# Neon Meter Host

Electron host daemon for syncing AI usage to the Neon Meter CoreS3 firmware over BLE.

## Device

<img src="docs/assets/neon-meter-device-chatgpt-display.jpg" alt="Neon Meter CoreS3 device showing ChatGPT usage" width="520">

## Features

- Electron window plus tray lifecycle.
- Web Bluetooth connection to the `Neon Meter` CoreS3 firmware, with legacy
  `AI Meter` discovery compatibility.
- Auto-detection for Claude Code credentials and ChatGPT/Codex auth.
- One-provider display when only one source is detected.
- Two-provider BLE bundle with a configurable 30-second display rotation when
  both sources are detected.
- Provider bundle preview.
- Local settings persistence without storing credentials.

## Screenshots

![Neon Meter dashboard](docs/screenshots/neon-meter-dashboard.png)

![Neon Meter settings](docs/screenshots/neon-meter-settings.png)

## Start

```bash
npm install
npm start
```

No credential setup is required in the app. Neon Meter reads credentials already
managed by Claude Code or Codex from the Neon Meter app.

## Build Installers

```bash
npm run dist
```

Installer artifacts are written to `dist/`. Builds target macOS, Windows, and
Linux on Intel and ARM.

## Test

```bash
npm test
```

## License

Neon Meter Host is licensed under the GNU Affero General Public License v3.0 or
later (`AGPL-3.0-or-later`). Documentation and media notices are covered in the
REUSE metadata. See [LICENSE](LICENSE), [NOTICE.md](NOTICE.md), and
[COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).

## Project Structure

- `src/electron/`: Neon Meter app and preload bridge.
- `src/ble/`: Web Bluetooth client.
- `src/core/`: state and firmware payload mapping.
- `src/providers/`: Claude Code and ChatGPT/Codex provider adapters.
- `src/ui/`: DOM rendering.
- `docs/`: operating notes.
- `specs/`: host daemon product spec.
- `tests/`: Node test suite.

## Documentation

- [BLE protocol](docs/ble-protocol.md)
- [Providers](docs/providers.md)
- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
- [Testing](docs/testing.md)
- [Host spec](specs/host-daemon.md)
