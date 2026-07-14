# Neon Meter Host Daemon Spec

## Goal

Build an Electron host app that fetches live AI usage data from already
authenticated local tools and sends a compact Neon Meter provider bundle to the
M5Stack CoreS3 firmware over USB serial or BLE.

## Runtime

- Neon Meter app owns application lifecycle, tray behavior, settings
  persistence, credential lookup, and provider network calls.
- Electron renderer owns the operator UI. The Electron main process owns native
  USB/BLE connection and reconnect to the CoreS3.
- The renderer receives only sanitized payload data from the main process.
  Access tokens never enter device payloads or localStorage.

## Provider Sources

- `claude`: reads Claude Code OAuth credentials and maps Anthropic unified
  5-hour and 7-day rate-limit headers to firmware percentages.
- `chatgpt`: reads Codex auth and maps ChatGPT/Codex 5-hour and weekly quota
  windows by semantic key or exact duration, never by position alone.
- Provider selection is automatic. When both providers are detected, both
  payloads are included in one firmware bundle.
- `rotationSeconds`: defaults to `30` and controls firmware display rotation
  when the bundle contains two providers.

## Device Target

USB serial is preferred when a CoreS3 answers the `neon-meter-usb` hello frame
at `115200` baud. The host writes newline-delimited JSON payload frames:

```json
{ "type": "payload", "payload": { "rotationSeconds": 30, "providers": [] } }
```

If USB is unavailable, the host connects to a BLE device named `Neon Meter`, or
a legacy device named `AI Meter`, and writes UTF-8 JSON to the firmware RX
characteristic:

- Service: `41494d45-7465-7220-0000-000000000001`
- RX: `41494d45-7465-7220-0000-000000000002`
- TX: `41494d45-7465-7220-0000-000000000003`
- Refresh: `41494d45-7465-7220-0000-000000000004`

## Acceptance Criteria

- The app launches as an Electron window and stays available from the tray when
  hidden.
- The UI can connect to the Neon Meter through the main-process native device
  bridge, preferring USB and falling back to BLE.
- Claude Code sync maps `s`, `sr`, `w`, `wr`, `detail`, and `ok` from provider
  rate-limit headers.
- ChatGPT/Codex sync maps `se`, `s`, `sr`, `w`, `wr`, `detail`, and `ok` from
  quota windows. A `604800`-second window always maps to Weekly, and Session is
  omitted from the device and status bar when `se` is false.
- Host settings allow changing the display rotation interval without requiring
  provider configuration.
- Settings persist locally, excluding credentials.
- `npm test` passes.
