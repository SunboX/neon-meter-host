# Neon Meter Host Daemon Spec

## Goal

Build an Electron host app that fetches live AI usage data from already
authenticated local tools and sends a compact Neon Meter BLE provider bundle to
the M5Stack CoreS3 firmware.

## Runtime

- Neon Meter app owns application lifecycle, tray behavior, settings
  persistence, credential lookup, and provider network calls.
- Electron renderer owns the operator UI and Web Bluetooth connection to the
  CoreS3.
- The renderer receives only sanitized payload data from the main process.
  Access tokens never enter BLE payloads or localStorage.

## Provider Sources

- `claude`: reads Claude Code OAuth credentials and maps Anthropic unified
  5-hour and 7-day rate-limit headers to firmware percentages.
- `chatgpt`: reads Codex auth and maps ChatGPT/Codex 5-hour and weekly quota
  windows to firmware percentages.
- Provider selection is automatic. When both providers are detected, both
  payloads are included in one BLE bundle.
- `rotationSeconds`: defaults to `30` and controls firmware display rotation
  when the bundle contains two providers.

## BLE Target

The host connects to a device named `Neon Meter`, or a legacy device named
`AI Meter`, and writes UTF-8 JSON to the firmware RX characteristic:

- Service: `41494d45-7465-7220-0000-000000000001`
- RX: `41494d45-7465-7220-0000-000000000002`
- TX: `41494d45-7465-7220-0000-000000000003`
- Refresh: `41494d45-7465-7220-0000-000000000004`

## Acceptance Criteria

- The app launches as an Electron window and stays available from the tray when
  hidden.
- The UI can connect to the Neon Meter over Web Bluetooth.
- Claude Code sync maps `s`, `sr`, `w`, `wr`, `detail`, and `ok` from provider
  rate-limit headers.
- ChatGPT/Codex sync maps `s`, `sr`, `w`, `wr`, `detail`, and `ok` from quota
  windows.
- Host settings allow changing the display rotation interval without requiring
  provider configuration.
- Settings persist locally, excluding credentials.
- `npm test` passes.
