# Security

## Credentials

- Claude Code and Codex credentials are read only by the Neon Meter app.
- The renderer receives only sanitized usage payloads over IPC.
- Settings persistence stores locale, sync interval, display rotation interval,
  and auto-sync state.
- Do not add credential form fields to the renderer.

## BLE

- The renderer connects only to devices matching the `Neon Meter` name prefix,
  or the legacy `AI Meter` prefix.
- Payloads contain percentages, reset times, status, and compact text only.
- BLE writes are initiated by the local user or the local auto-sync timer.

## Electron Boundaries

- `contextIsolation` is enabled.
- `nodeIntegration` is disabled in the renderer.
- The preload bridge exposes only metadata, settings, and provider bundle fetch
  calls.

## Network

Provider network requests are made from the Neon Meter app:

- Claude Code: `https://api.anthropic.com/v1/messages`
- ChatGPT/Codex: `https://chatgpt.com/backend-api/wham/usage`
