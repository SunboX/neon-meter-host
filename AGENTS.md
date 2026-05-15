# AGENTS

## Project Overview

- Repository: Neon Meter Host.
- Purpose: Electron host daemon for syncing OpenAI, ChatGPT, and Claude-style usage payloads to the AI Meter CoreS3 over BLE.
- Source is in `src/`.
- Tests are in `tests/`.
- Documentation is in `docs/`.
- Host daemon specs are in `specs/`; scaffold compatibility spec is in `spec/`.

## Build, Run, Test

- Install: `npm install`
- Run Electron: `OPENAI_ADMIN_KEY=sk-... npm start`
- Static preview: `npm run serve`
- Test: `npm test`
- Format: `npm run format`

## Architecture Rules

- Keep OpenAI API calls in the Neon Meter app.
- Do not expose API keys to the renderer, BLE payloads, localStorage, or settings files.
- Keep BLE UUIDs synchronized with the firmware docs in the sibling `AI-Meter` project.
- Use Web Bluetooth from the renderer; use the preload bridge only for trusted main-process capabilities.
- Keep provider adapters in `src/providers/` and shared payload shaping in `src/core/FirmwarePayload.mjs`.

## Coding Style

- Use ESM `.mjs` modules except for Electron preload `.cjs`.
- Use 4-space indentation, single quotes, no semicolons, and no trailing commas.
- Keep each source file below 1000 lines.
- Add focused tests for provider mapping and payload behavior.
- Prefer small modules with explicit dependencies over global state.

## Security Notes

- `OPENAI_ADMIN_KEY` must come from the process environment.
- Persist only non-secret settings such as budgets, intervals, provider selection, and manual estimates.
- Treat Bluetooth payloads as local status data only; never include raw API responses or credentials.
