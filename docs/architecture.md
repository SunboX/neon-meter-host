# Architecture

## Repository Layout

- `src/electron/`: Neon Meter app and preload bridge.
- `src/ble/`: Web Bluetooth client.
- `src/core/`: state and firmware payload mapping.
- `src/providers/`: Claude Code and ChatGPT/Codex provider adapters.
- `src/ui/`: DOM rendering.
- `docs/`: operating notes and technical reference.
- `specs/`: host daemon product spec.
- `spec/`: scaffold compatibility spec.
- `tests/`: Node test suite.

## Processes

- Neon Meter app: owns app lifecycle, tray, settings persistence,
  Bluetooth selection permissions, provider credential reads, and provider
  network requests.
- Preload bridge: exposes a narrow `window.aiMeterHost` IPC API to the
  renderer.
- Renderer process: renders controls, manages Web Bluetooth, schedules sync, and
  writes firmware payloads to BLE.

## Source Modules

- `src/electron/main.mjs`: Electron window, tray, IPC, settings, provider
  invocation.
- `src/electron/ProviderCredentials.mjs`: main-process credential lookup for
  Claude Code and Codex.
- `src/electron/preload.cjs`: context-isolated bridge.
- `src/main.mjs`: renderer bootstrap.
- `src/AppController.mjs`: auto-detected provider sync scheduling and BLE
  writes.
- `src/core/AppState.mjs`: state container.
- `src/core/FirmwarePayload.mjs`: firmware payload defaults, clamping, and reset
  helpers.
- `src/core/ProviderBundle.mjs`: wraps detected provider payloads and display
  rotation timing for BLE.
- `src/providers/ClaudeCodeUsageProvider.mjs`: Anthropic header-to-payload
  mapper.
- `src/providers/ChatGptUsageProvider.mjs`: ChatGPT usage-to-payload mapper.
- `src/ble/WebBluetoothAiMeterClient.mjs`: Web Bluetooth GATT client.
- `src/ui/AppView.mjs`: DOM rendering and form bindings.

## Data Flow

1. The renderer loads non-secret settings through preload IPC.
2. The user connects to `Neon Meter` over Web Bluetooth.
3. The controller asks the main process for a detected-provider bundle.
4. The main process reads local tool credentials and fetches every detected
   provider.
5. The renderer receives only the sanitized firmware bundle.
6. The controller writes the bundle to the firmware RX characteristic.
7. The firmware acknowledgement updates UI status.

## Static Server

`src/server.mjs` remains available as a browser-only static preview and health
endpoint. Full BLE and live quota behavior requires Electron.
