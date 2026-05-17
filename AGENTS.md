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

## Release Rules

- Every GitHub release must include installer artifacts for all configured build targets.
- Use the `Build installers` GitHub Actions workflow for releases; do not finish a release from tag and notes alone.
- For an existing release, run the workflow manually with `release_tag` set to the release tag and verify the release assets are attached before reporting completion.

## Architecture Rules

- Keep OpenAI API calls in the Neon Meter app.
- Do not expose API keys to the renderer, BLE payloads, localStorage, or settings files.
- Keep BLE UUIDs synchronized with the firmware docs in the sibling `AI-Meter` project.
- Use native BLE from the Electron main process for persistent reconnect; keep Web Bluetooth only as a renderer fallback for static preview or native BLE load failures.
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
