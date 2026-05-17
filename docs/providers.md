# Providers

Neon Meter syncs live quota data from tools that are already authenticated on
the host machine. The renderer never receives access tokens and the persisted
settings file stores only locale, auto-sync, sync interval, and display rotation
seconds.

The host always auto-detects both supported providers. If one is available, the
device shows that one provider. If both are available, the host sends both
payloads in one firmware bundle and the device rotates between them.

## Claude Code

- Source: Claude Code OAuth credentials.
- macOS lookup order:
    - Keychain item `Claude Code-credentials`
    - `~/.claude/.credentials.json`
- Linux and Windows lookup:
    - `~/.claude/.credentials.json`
- Quota probe: a minimal `POST https://api.anthropic.com/v1/messages` request.
- Usage fields: `anthropic-ratelimit-unified-5h-*` and
  `anthropic-ratelimit-unified-7d-*` response headers.

## ChatGPT / Codex

- Source: Codex auth file.
- Lookup:
    - `$CODEX_HOME/auth.json` when `CODEX_HOME` is set
    - `~/.codex/auth.json` otherwise
- Quota probe: `GET https://chatgpt.com/backend-api/wham/usage`.
- Usage fields are mapped from the returned 5-hour/session and weekly windows
  when present.

## Firmware Payload

Each provider maps into the same compact firmware payload:

```json
{
    "p": "claude",
    "title": "Claude Code",
    "s": 46,
    "sl": "Session",
    "sr": 120,
    "w": 12,
    "wl": "Weekly",
    "wr": 3000,
    "st": "ok",
    "detail": "5h 46% / 7d 12%",
    "ok": true
}
```

The host sends one or two of those payloads in a provider bundle:

```json
{
    "rotationSeconds": 30,
    "providers": [
        {
            "p": "claude",
            "title": "Claude Code",
            "s": 46,
            "sl": "Session",
            "sr": 120,
            "w": 12,
            "wl": "Weekly",
            "wr": 3000,
            "st": "ok",
            "detail": "5h 46% / 7d 12%",
            "ok": true
        }
    ]
}
```
