# Optional ChatGPT Session Window Design

## Scope

This change spans both local repositories:

- `/Users/afiedler/Documents/privat/Andrés_Werkstatt/Neon-Meter-Host` for
  ChatGPT window classification, payload shaping, and macOS status-bar output.
- `/Users/afiedler/Documents/privat/Andrés_Werkstatt/Neon-Meter` for payload
  parsing, conditional Session rendering, and Weekly-only layout behavior.

The existing unrelated `AGENTS.md` modification in the firmware repository is
outside this change and must remain untouched.

## Problem

ChatGPT/Codex temporarily removed its five-hour Session limit while retaining
the seven-day Weekly limit. The live usage response now places the Weekly
window in `rate_limit.primary_window`, identifies it with
`limit_window_seconds: 604800`, and returns `secondary_window: null`.

Neon Meter Host currently interprets `primary_window` as Session and
`secondary_window` as Weekly. This positional assumption sends the Weekly
percentage and reset as Session data, then invents an empty Weekly value. The
macOS status bar and Neon Meter firmware consequently render two incorrect
gauges.

## Requirements

- Identify Session and Weekly windows by their semantics and declared duration,
  not only by their `primary_window` or `secondary_window` positions.
- Never map a seven-day Weekly window into Session fields.
- Represent whether a real Session window is available in the firmware payload.
- Omit Session everywhere when it is unavailable:
  - no Session panel or bar graph on Neon Meter,
  - no `S` gauge in the macOS status bar,
  - no Session entry in status-bar tooltips or menus,
  - no Session value in the compact detail/footer text.
- Continue displaying the real Weekly percentage and reset.
- Restore Session rendering automatically when a five-hour window returns.
- Preserve existing Claude behavior and existing ChatGPT behavior when both
  windows are present.
- Keep older payloads compatible by treating a missing availability field as
  Session available.

## Approaches Considered

### Host-only relabeling

The host could label a missing Session as disabled while continuing to send a
zero percentage. This would leave a misleading `100%` bar on older and current
renderers and would not satisfy the requirement to omit Session entirely.

### Dynamic single-panel inference without a protocol field

Renderers could infer Session availability from labels or reset values. This
would overload presentation fields with control semantics and make ordinary
unknown reset values ambiguous.

### Explicit availability metadata

The selected approach adds a compact `se` boolean to the provider payload.
`se: false` means no Session window exists and renderers must omit it. Missing
`se` continues to mean available, preserving compatibility with existing hosts
and payload fixtures.

## Host Data Mapping

`ChatGptUsageProvider` will classify candidate windows using this order:

1. Explicit semantic keys such as `five_hour` and `weekly`.
2. A declared `limit_window_seconds` duration. Exactly `18000` seconds maps to
   Session and exactly `604800` seconds maps to Weekly regardless of whether
   the object is named `primary_window` or `secondary_window`.
3. Legacy positional fallback only when both primary and secondary windows are
   present and neither declares a recognizable duration.

A lone positional window with no semantic name or recognizable duration is
ambiguous. The provider will return an unrecognized-response error instead of
risking a Weekly-to-Session misclassification.

For the current one-window response, the mapped provider payload will contain:

```json
{
    "p": "chatgpt",
    "title": "ChatGPT",
    "se": false,
    "s": 0,
    "sl": "Session",
    "sr": -1,
    "w": 52,
    "wl": "Weekly",
    "wr": 7941,
    "st": "ok",
    "detail": "7d 52%",
    "ok": true
}
```

The reset value above is illustrative because it decreases over time. When a
five-hour window returns, `se` becomes `true`, Session fields carry the actual
five-hour data, and detail text returns to the two-window form.

`FirmwarePayload.mjs` will accept `sessionEnabled` and emit `se`. The default
will be `true` so Claude and existing callers retain their current behavior.

## macOS Status-Bar Rendering

`TrayQuotaStatus.mjs` will build its gauge list from available windows:

- `se !== false`: render both `S` and `W` gauges as today.
- `se === false`: render only the `W` gauge.

The same availability rule applies to menu and tooltip text. With Session
absent, a ChatGPT line contains only the Weekly remaining percentage and reset.
Provider urgency continues to consider the available Weekly window, and no
placeholder Session percentage participates in selection or coloring.

## Firmware Rendering

The firmware usage model will parse `se` into a `sessionEnabled` field. It will
default to `true` when `se` is missing.

The UI will retain references to both usage-panel containers so their
visibility and position can change on each payload update:

- Session available: show both panels in their existing positions.
- Session unavailable: hide the complete Session panel and move the Weekly
  panel to the upper `kContentY` position previously occupied by Session.
- Session available again: show Session and restore both original positions.

No `OFF`, `100%`, placeholder bar, reset text, or Session label is rendered
while Session is unavailable. The footer receives the host's Weekly-only detail
text. Usage-rate tracking will use the first available window, so a hidden
Session value does not suppress changes in Weekly usage.

## Compatibility

The `se` field is additive. Older firmware ignores it and continues parsing the
existing compact fields. Updated firmware treats its absence as `true`, so it
continues to accept existing hosts, raw single-provider objects, and legacy
Clawdmeter-compatible payloads.

The existing `s`, `sr`, `w`, `wr`, `st`, and `ok` fields remain present and keep
their existing meanings. BLE and USB framing and UUIDs do not change.

## Testing

Host tests will cover:

- a current ChatGPT response with one 604800-second primary window maps to
  `se: false`, neutral Session fields, and the real Weekly fields;
- a response with five-hour and seven-day windows maps to `se: true` with both
  windows in the correct fields;
- a Weekly window is never selected as Session because of its position;
- an ambiguous lone positional window is rejected instead of guessed;
- shared payload shaping defaults `se` to `true`;
- the status bar renders only `W` and Weekly text when `se` is false;
- normal two-gauge status rendering remains unchanged when `se` is true or
  absent.

Firmware native tests will cover:

- parsing explicit `se: false` and the backward-compatible missing-field
  default;
- preserving Weekly data while Session is unavailable;
- selecting Weekly for usage-rate tracking when it is the first available
  window.

Firmware UI structure tests will verify that the Session container can be
hidden, the Weekly container is repositioned for the one-panel state, and both
positions are restored when Session becomes available again. Full host tests,
firmware native tests, and the CoreS3 firmware build must pass before completion.
