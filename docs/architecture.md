# Architecture

## Repository Layout

- `src/electron/`: Neon Meter app and preload bridge.
- `src/ble/`: BLE clients for native Electron IPC and browser fallback.
- `src/usb/`: native USB serial client for the firmware line protocol.
- `src/transport/`: USB-first transport selection with BLE fallback.
- `src/core/`: state and firmware payload mapping.
- `src/providers/`: Claude Code and ChatGPT/Codex provider adapters.
- `src/ui/`: DOM rendering.
- `docs/`: operating notes and technical reference.
- `specs/`: host daemon product spec.
- `spec/`: scaffold compatibility spec.
- `tests/`: Node test suite.

## Processes

- Neon Meter app: owns app lifecycle, tray, settings persistence, native USB
  and BLE reconnect, provider credential reads, and provider network requests.
- Preload bridge: exposes a narrow `window.aiMeterHost` IPC API to the
  renderer.
- Renderer process: renders controls, schedules sync, and calls a device client
  interface. In Electron, that client delegates to the main-process USB-first
  transport over IPC. In static browser preview, it falls back to Web Bluetooth.

## Source Modules

- `src/electron/main.mjs`: Electron window, tray, IPC, settings, provider
  invocation, and native transport client ownership.
- `src/electron/NativeBleIpc.mjs`: legacy-named IPC handlers and event
  forwarding for the native device transport.
- `src/electron/ProviderCredentials.mjs`: main-process credential lookup for
  Claude Code and Codex.
- `src/electron/preload.cjs`: context-isolated bridge.
- `src/main.mjs`: renderer bootstrap.
- `src/AppController.mjs`: auto-detected provider sync scheduling and device
  writes.
- `src/core/AppState.mjs`: state container.
- `src/core/FirmwarePayload.mjs`: firmware payload defaults, clamping, and reset
  helpers.
- `src/core/ProviderBundle.mjs`: wraps detected provider payloads and display
  rotation timing for the firmware.
- `src/providers/ClaudeCodeUsageProvider.mjs`: Anthropic header-to-payload
  mapper.
- `src/providers/ChatGptUsageProvider.mjs`: ChatGPT usage-to-payload mapper.
- `src/ble/NativeNobleAiMeterClient.mjs`: main-process native BLE GATT client.
- `src/ble/IpcBleClient.mjs`: renderer BLE client backed by preload IPC.
- `src/ble/WebBluetoothAiMeterClient.mjs`: Web Bluetooth GATT fallback for
  static preview or native BLE load failures.
- `src/usb/NativeUsbSerialAiMeterClient.mjs`: main-process USB serial client.
- `src/transport/PreferredAiMeterClient.mjs`: tries USB first and falls back to
  BLE.
- `src/ui/AppView.mjs`: DOM rendering and form bindings.

## Data Flow

1. The renderer loads non-secret settings through preload IPC.
2. The controller asks the main-process transport client to connect. USB serial
   is probed first; BLE is used when USB is not present.
3. The controller asks the main process for a detected-provider bundle.
4. The main process reads local tool credentials and fetches every detected
   provider.
5. The renderer receives only the sanitized firmware bundle.
6. The controller writes the bundle through the device client interface.
7. USB writes a typed line-protocol payload, or BLE writes the payload to the
   firmware RX characteristic.
8. Firmware acknowledgements are forwarded through IPC and update UI status.

## Static Server

`src/server.mjs` remains available as a browser-only static preview and health
endpoint. Full USB/BLE and live quota behavior requires Electron.
