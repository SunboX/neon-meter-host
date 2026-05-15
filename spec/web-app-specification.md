# Neon Meter Host Application Specification

## Goal

Provide a local Electron operator app that keeps the Neon Meter CoreS3 display
updated with live Claude Code and ChatGPT/Codex usage payloads.

## Functional Requirements

1. The app starts with `npm start` as an Electron app.
2. The app can also run a browser-only static preview with `npm run serve`.
3. The renderer can connect to the CoreS3 firmware over Web Bluetooth.
4. The Claude Code provider reads local Claude Code credentials in the Neon
   Meter app and maps Anthropic rate-limit headers.
5. The ChatGPT/Codex provider reads local Codex auth in the Neon Meter app and
   maps ChatGPT quota windows.
6. The app auto-detects both providers and sends one BLE bundle containing all
   detected providers.
7. The app persists non-secret settings locally, including the display rotation
   interval.
8. The app previews the exact JSON payload written to BLE.

## Non-Functional Requirements

1. Keep credentials out of renderer settings, BLE payloads, and source files.
2. Keep source modules below 1000 lines.
3. Use ESM for application modules and CommonJS only for Electron preload
   compatibility.
4. Keep behavior tests deterministic and independent of live BLE/provider
   services.

## Acceptance Criteria

1. `npm test` passes.
2. `npm start` launches Electron.
3. Missing local tool auth is visible and produces an error bundle instead of
   throwing.
4. Claude Code and ChatGPT/Codex providers can generate sanitized payloads from
   mocked provider responses.
5. When both providers are detected, the bundle includes both and defaults to
   30-second rotation.
6. BLE service UUIDs match the firmware protocol.
