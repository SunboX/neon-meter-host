# Neon Meter Host

Desktop host app for showing live AI usage on the Neon Meter CoreS3 device.
It is the companion app for the [SunboX/neon-meter](https://github.com/SunboX/neon-meter)
project.

## Device

<img src="docs/assets/neon-meter-device-chatgpt-display.jpg" alt="Neon Meter CoreS3 device showing ChatGPT usage" width="520">

## Screenshots

![Neon Meter dashboard](docs/screenshots/neon-meter-dashboard.png)

![Neon Meter settings](docs/screenshots/neon-meter-settings.png)

## Quick Start

```bash
npm install
npm start
```

No credential setup is required in the app. Neon Meter uses credentials already
managed by Claude Code or Codex on the local machine.

## Documentation

- [Getting started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [Providers](docs/providers.md)
- [BLE protocol](docs/ble-protocol.md)
- [Security](docs/security.md)
- [Testing](docs/testing.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Host spec](specs/host-daemon.md)

## License

Neon Meter Host is licensed under the GNU Affero General Public License v3.0 or
later (`AGPL-3.0-or-later`). Documentation and media notices are covered in the
REUSE metadata. See [LICENSE](LICENSE), [NOTICE.md](NOTICE.md), and
[COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).
