# Testing

## Command

```bash
npm test
```

## Coverage

- `tests/app-state.test.mjs`: host state shape and subscription behavior.
- `tests/payload-builder.test.mjs`: firmware payload clamping, defaults, and
  reset helpers.
- `tests/claude-code-provider.test.mjs`: Claude Code credential extraction and
  Anthropic rate-limit header mapping.
- `tests/chatgpt-provider.test.mjs`: Codex auth extraction and ChatGPT quota
  mapping.
- `tests/provider-credentials.test.mjs`: main-process credential lookup paths.
- `tests/provider-bundle.test.mjs`: one/two-provider BLE bundle wrapping and
  rotation defaults.
- `tests/project-structure.test.mjs`: required host files.
- `tests/mjs-line-limit.test.mjs`: source file size guard.

## Manual Checks

After dependency installation, run:

```bash
npm start
```

Then verify:

- The Electron window opens as Neon Meter.
- The settings dialog has no provider selector and exposes rotation seconds.
- `Sync now` produces a provider bundle preview or a no-auth error payload.
- `Connect` opens the Bluetooth chooser when the CoreS3 is advertising as
  Neon Meter.
