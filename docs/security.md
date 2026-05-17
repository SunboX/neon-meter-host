# Security

## Credentials

- Claude Code and Codex credentials are read only by the Neon Meter app.
- The renderer receives only sanitized usage payloads over IPC.
- Settings persistence stores locale, sync interval, display rotation interval,
  and auto-sync state.
- Do not add credential form fields to the renderer.

## Device Transport

- Electron uses native main-process USB serial and BLE for reconnects and
  writes. The renderer only calls the preload bridge and does not receive
  native device handles.
- USB serial connects only after the firmware answers the `neon-meter-usb`
  hello frame. Non-JSON serial logs and unknown JSON frames are ignored.
- Native BLE connects only to devices matching the `Neon Meter` name prefix, the
  legacy `AI Meter` prefix, the remembered local device ID/name, or the firmware
  service UUID.
- Web Bluetooth remains a static-preview fallback when native BLE is unavailable.
- Payloads contain percentages, reset times, status, and compact text only.
- Device writes are initiated by the local user or the local auto-sync timer.

## Electron Boundaries

- `contextIsolation` is enabled.
- `nodeIntegration` is disabled in the renderer.
- The preload bridge exposes only metadata, settings, provider bundle fetch, and
  device control calls.

## Network

Provider network requests are made from the Neon Meter app:

- Claude Code: `https://api.anthropic.com/v1/messages`
- ChatGPT/Codex: `https://chatgpt.com/backend-api/wham/usage`
