# Troubleshooting

## Claude Code Shows Missing Credentials

- Start Claude Code once on the same machine and complete its login flow.
- On macOS, confirm the Keychain item `Claude Code-credentials` exists.
- On other platforms, confirm `~/.claude/.credentials.json` exists.

## ChatGPT/Codex Shows Missing Auth

- Start Codex once on the same machine and complete its login flow.
- Confirm `~/.codex/auth.json` exists, or set `CODEX_HOME` to the directory
  containing `auth.json` before launching Neon Meter.

## BLE Device Is Not Listed

- Confirm the CoreS3 is powered on and showing the Neon Meter firmware.
- Open the firmware Bluetooth screen and confirm it advertises as `Neon Meter`.
- Toggle Bluetooth on the host computer.
- Restart the Electron app if the browser Bluetooth chooser is stale.

## Static Preview Cannot Sync

`npm run serve` is only a static UI preview. Live quota sync and the Bluetooth
selection handler require Electron.

## Electron Runs Like Node

Some agent shells set `ELECTRON_RUN_AS_NODE=1`, which makes Electron expose Node
behavior instead of main-process APIs. The `npm start` script unsets this
variable before launching Electron.

## Tests Fail After File Moves

Update `tests/project-structure.test.mjs` when moving required files, and keep
source `.mjs` files below 1000 lines.
