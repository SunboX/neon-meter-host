# Optional ChatGPT Session Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect whether ChatGPT supplies a real five-hour Session window, keep the seven-day Weekly window in Weekly fields, and omit Session from the host status bar and Neon Meter firmware UI only while it is unavailable.

**Architecture:** Neon Meter Host classifies quota objects by semantic keys and exact window durations, then carries an additive `se` boolean through the compact provider payload. The macOS tray and local Neon Meter firmware treat missing `se` as Session available for compatibility, but omit Session rendering when `se` is explicitly false.

**Tech Stack:** Node.js ESM, Node test runner, Electron tray rendering, C++17, ArduinoJson 7, LVGL 9, PlatformIO native Unity tests, PlatformIO CoreS3 build.

## Global Constraints

- Never map a `604800`-second Weekly window into Session fields.
- A Session window is duration `18000`; a Weekly window is duration `604800`.
- A lone positional window without a semantic name or recognized duration is an error, not a guessed Session.
- Missing `se` means Session available for backward compatibility.
- When `se` is false, render no Session panel, bar, label, reset, tray gauge, tooltip entry, menu entry, or detail text.
- Restore Session automatically when a real five-hour window returns.
- Preserve existing Claude and two-window ChatGPT behavior.
- Preserve the unrelated modified `Neon-Meter/AGENTS.md` file without staging or editing it.

---

### Task 1: Add Session availability to the shared host payload

**Files:**
- Modify: `tests/payload-builder.test.mjs`
- Modify: `src/core/FirmwarePayload.mjs`

**Interfaces:**
- Consumes: `buildFirmwarePayload(input)` with optional `input.sessionEnabled`.
- Produces: compact `se: boolean`, defaulting to `true` unless `sessionEnabled === false`.

- [ ] **Step 1: Write the failing payload tests**

Add `sessionEnabled: false` to the existing explicit payload fixture and expect
`se: false`. In the defaults test, assert that an omitted value produces
`se: true`:

```js
assert.deepEqual(payload, {
    p: 'claude',
    title: 'Claude Code',
    se: false,
    s: 100,
    sl: 'Today',
    sr: 54,
    w: 0,
    wl: 'Monthly',
    wr: 1200,
    st: 'ok',
    detail: 'usage synced',
    ok: true
})

assert.equal(payload.se, true)
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/payload-builder.test.mjs`

Expected: FAIL because `se` is not emitted.

- [ ] **Step 3: Emit the compact field**

Extend the input and return JSDoc with `sessionEnabled?: boolean` and
`se: boolean`, then add this field after `title`:

```js
se: input.sessionEnabled !== false,
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/payload-builder.test.mjs`

Expected: all payload-builder tests PASS.

### Task 2: Classify ChatGPT windows by semantics and duration

**Files:**
- Modify: `tests/chatgpt-provider.test.mjs`
- Modify: `src/providers/ChatGptUsageProvider.mjs`

**Interfaces:**
- Consumes: loose ChatGPT `/backend-api/wham/usage` JSON.
- Produces: correct Session/Weekly firmware fields and `se` from `parseChatGptUsagePayload(raw, now)`.

- [ ] **Step 1: Write the disabled-Session regression test**

Add a test matching the local response shape:

```js
test('parseChatGptUsagePayload keeps a lone seven-day primary window in Weekly', () => {
    const payload = parseChatGptUsagePayload(
        {
            rate_limit: {
                allowed: true,
                limit_reached: false,
                primary_window: {
                    used_percent: 52,
                    limit_window_seconds: 604800,
                    reset_after_seconds: 476467,
                    reset_at: 1784487611
                },
                secondary_window: null
            }
        },
        new Date('2026-07-14T06:39:05Z')
    )

    assert.equal(payload.se, false)
    assert.equal(payload.s, 0)
    assert.equal(payload.sr, -1)
    assert.equal(payload.w, 52)
    assert.equal(payload.wr, 7942)
    assert.equal(payload.detail, '7d 52%')
    assert.equal(payload.ok, true)
})
```

- [ ] **Step 2: Write enabled and ambiguous-window tests**

Add exact-duration fields to the normal two-window fixture and assert
`payload.se === true`. Add this safety test:

```js
test('parseChatGptUsagePayload rejects a lone positional window without a duration', () => {
    const payload = parseChatGptUsagePayload({
        rate_limit: {
            primary_window: { used_percent: 52, reset_at: 1784487611 },
            secondary_window: null
        }
    })

    assert.equal(payload.ok, false)
    assert.match(payload.detail, /not recognized/)
})
```

- [ ] **Step 3: Run the provider tests and verify RED**

Run: `node --test tests/chatgpt-provider.test.mjs`

Expected: the seven-day primary window is incorrectly returned as Session and the ambiguous window is accepted.

- [ ] **Step 4: Implement duration-aware classification**

Add constants and helpers:

```js
const SESSION_WINDOW_SECONDS = 5 * 60 * 60
const WEEKLY_WINDOW_SECONDS = 7 * 24 * 60 * 60

function windowDurationSeconds(window) {
    if (!window) return null
    return numberFromKeys(window, ['limit_window_seconds', 'window_seconds'])
}

function durationMatches(window, kind) {
    const seconds = windowDurationSeconds(window)
    if (seconds === null) return null
    return kind === 'session'
        ? seconds === SESSION_WINDOW_SECONDS
        : seconds === WEEKLY_WINDOW_SECONDS
}
```

Replace the classifier with duration-aware scoring and a bounded legacy
fallback:

```js
function findQuotaWindow(raw, kind) {
    if (!raw || typeof raw !== 'object') return null
    const source = /** @type {Record<string, unknown>} */ (raw)
    const explicitKeys =
        kind === 'session'
            ? ['five_hour', 'five_hour_limit', 'session']
            : ['weekly', 'weekly_limit', 'week']

    for (const key of explicitKeys) {
        const value = objectValue(source[key])
        if (value && durationMatches(value, kind) !== false) return value
    }

    const candidates = collectObjects(source, '')
        .map((candidate) => ({
            ...candidate,
            score: quotaScore(candidate.path, candidate.value, kind)
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score)

    return candidates[0]?.value || legacyPositionalWindow(source, kind)
}

function quotaScore(path, value, kind) {
    const text = (path + ' ' + Object.keys(value).join(' ')).toLowerCase()
    if (percentFromWindow(value) === null) return 0

    const durationMatch = durationMatches(value, kind)
    if (durationMatch === false) return 0
    const semanticScore =
        kind === 'session'
            ? scoreTerms(text, ['five', '5h', '5_hour', 'session'])
            : scoreTerms(text, ['week', 'weekly', '7d', '7_day'])
    return (durationMatch === true ? 100 : 0) + semanticScore
}

function legacyPositionalWindow(source, kind) {
    const container = objectValue(source.rate_limit) || source
    const primary = objectValue(container.primary_window)
    const secondary = objectValue(container.secondary_window)
    if (!primary || !secondary) return null
    if (
        windowDurationSeconds(primary) !== null ||
        windowDurationSeconds(secondary) !== null
    ) {
        return null
    }
    return kind === 'session' ? primary : secondary
}

function objectValue(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : null
}
```

- [ ] **Step 5: Emit availability and conditional detail**

In `parseChatGptUsagePayload`:

```js
const sessionEnabled = sessionPercent !== null
const detail = sessionEnabled
    ? '5h ' + Math.round(currentPercent) + '% / 7d ' + Math.round(windowPercent) + '%'
    : '7d ' + Math.round(windowPercent) + '%'
```

Pass `sessionEnabled` and `detail` to `buildFirmwarePayload`.

- [ ] **Step 6: Run the provider and payload tests and verify GREEN**

Run: `node --test tests/chatgpt-provider.test.mjs tests/payload-builder.test.mjs`

Expected: all focused tests PASS.

### Task 3: Omit unavailable Session from the macOS status bar

**Files:**
- Modify: `tests/tray-quota-status.test.mjs`
- Modify: `src/electron/TrayQuotaStatus.mjs`

**Interfaces:**
- Consumes: provider payload with `se === false`.
- Produces: a Weekly-only gauge list, title, tooltip, and menu line.

- [ ] **Step 1: Write the Weekly-only tray regression test**

```js
test('buildTrayQuotaStatus omits Session when it is unavailable', () => {
    const summary = buildTrayQuotaStatus({
        providers: [{
            p: 'chatgpt',
            title: 'ChatGPT',
            se: false,
            s: 0,
            sl: 'Session',
            sr: -1,
            w: 52,
            wl: 'Weekly',
            wr: 7942,
            st: 'ok',
            detail: '7d 52%',
            ok: true
        }]
    })

    assert.equal(summary.title, 'W 48%')
    assert.deepEqual(summary.gauges, [{
        label: 'W',
        valueText: '48%',
        fillPercent: 48,
        color: '#ffd75e'
    }])
    assert.match(summary.tooltip, /ChatGPT: Weekly 48% \(5d 12h left\)/)
    assert.doesNotMatch(summary.tooltip, /Session/)
    assert.equal(summary.menuItems[1].label, 'ChatGPT: Weekly 48%')
})
```

- [ ] **Step 2: Run the tray test and verify RED**

Run: `node --test tests/tray-quota-status.test.mjs`

Expected: FAIL because the title, gauges, tooltip, and menu still contain Session.

- [ ] **Step 3: Filter Session from every tray representation**

Add:

```js
function sessionAvailable(provider) {
    return provider.se !== false
}
```

Use it in these exact paths:

```js
function providerUrgency(provider) {
    const values = [usedPercent(provider.w, provider.wr)]
    if (sessionAvailable(provider)) {
        values.push(usedPercent(provider.s, provider.sr))
    }
    return Math.max(...values)
}

function buildGauges(provider) {
    const gauges = []
    if (sessionAvailable(provider)) {
        gauges.push(buildGauge('S', provider, 's', 'sr'))
    }
    gauges.push(buildGauge('W', provider, 'w', 'wr'))
    return gauges
}
```

After the Weekly limit-reached branch in `menuLine`, return
`name + ': ' + windowPercent(provider, 'w', 'wr', 'Weekly')` when Session is
unavailable. Only evaluate the Session limit-reached branch when
`sessionAvailable(provider)` is true. In `tooltipLine`, return
`name + ': ' + windowDetail(provider, 'w', 'wr', 'Weekly')` when unavailable;
otherwise retain the existing two-window string.

- [ ] **Step 4: Run the tray test and verify GREEN**

Run: `node --test tests/tray-quota-status.test.mjs`

Expected: all tray tests PASS, including existing two-gauge image assertions.

### Task 4: Parse Session availability in the firmware model

**Files:**
- Modify: `/Users/afiedler/Documents/privat/Andrés_Werkstatt/Neon-Meter/tests/test_usage_model/test_main.cpp`
- Modify: `/Users/afiedler/Documents/privat/Andrés_Werkstatt/Neon-Meter/src/usage_model.h`
- Modify: `/Users/afiedler/Documents/privat/Andrés_Werkstatt/Neon-Meter/src/usage_model.cpp`
- Modify: `/Users/afiedler/Documents/privat/Andrés_Werkstatt/Neon-Meter/src/main.cpp`

**Interfaces:**
- Consumes: compact optional `se` boolean.
- Produces: `UsageData::sessionEnabled` and `usageRatePercent(const UsageData&)`.

- [ ] **Step 1: Write firmware model tests for explicit false and legacy default**

Add assertions that the existing legacy fixture has `sessionEnabled == true`,
then add:

```cpp
/** Verifies a missing Session remains absent while Weekly data is preserved. */
void testUsageParserKeepsOptionalSessionState(void) {
    UsageData data = {};

    TEST_ASSERT_TRUE(parseUsageJson(
        "{\"p\":\"chatgpt\",\"se\":false,\"s\":0,\"sr\":-1,"
        "\"w\":52,\"wl\":\"Weekly\",\"wr\":7942,\"detail\":\"7d 52%\",\"ok\":true}",
        &data));

    TEST_ASSERT_FALSE(data.sessionEnabled);
    TEST_ASSERT_EQUAL_FLOAT(52.0f, data.secondaryPct);
    TEST_ASSERT_EQUAL_FLOAT(52.0f, usageRatePercent(data));
}
```

Register the new test in `main()`.

- [ ] **Step 2: Run the firmware model test and verify RED**

Run: `PATH=$HOME/.platformio/penv/bin:$PATH pio test -e native -f test_usage_model`

Expected: compilation fails because `sessionEnabled` and `usageRatePercent` do not exist.

- [ ] **Step 3: Implement firmware parsing and rate selection**

Add `bool sessionEnabled;` to `UsageData`, parse it with:

```cpp
out->sessionEnabled = payload["se"] | true;
```

Declare and define:

```cpp
/** Returns the first available provider percentage for activity tracking. */
float usageRatePercent(const UsageData &data) {
    return data.sessionEnabled ? data.primaryPct : data.secondaryPct;
}
```

Replace `usage.primaryPct` in `applyUsageItem`'s `rateTracker.addSample` call
with `usageRatePercent(usage)`.

- [ ] **Step 4: Run the firmware model test and verify GREEN**

Run: `PATH=$HOME/.platformio/penv/bin:$PATH pio test -e native -f test_usage_model`

Expected: all usage-model tests PASS.

### Task 5: Hide and restore the Session panel in firmware

**Files:**
- Modify: `/Users/afiedler/Documents/privat/Andrés_Werkstatt/Neon-Meter/tests/test_ui_layout/test_main.cpp`
- Modify: `/Users/afiedler/Documents/privat/Andrés_Werkstatt/Neon-Meter/src/ui_layout.h`
- Modify: `/Users/afiedler/Documents/privat/Andrés_Werkstatt/Neon-Meter/src/ui.cpp`

**Interfaces:**
- Consumes: `UsageData::sessionEnabled`.
- Produces: hidden Session panel and Weekly-at-`kContentY` layout only when false.

- [ ] **Step 1: Write a failing layout test**

Add a pure layout helper assertion:

```cpp
/** Verifies Weekly occupies the first panel slot without Session. */
void testWeeklyMovesToFirstSlotWithoutSession(void) {
    TEST_ASSERT_EQUAL(UiLayout::kContentY, UiLayout::secondaryPanelY(false));
    TEST_ASSERT_EQUAL(UiLayout::kContentY + UiLayout::kPanelHeight + UiLayout::kPanelGap,
                      UiLayout::secondaryPanelY(true));
}
```

Register it in `main()`.

- [ ] **Step 2: Run the layout test and verify RED**

Run: `PATH=$HOME/.platformio/penv/bin:$PATH pio test -e native -f test_ui_layout`

Expected: compilation fails because `secondaryPanelY` does not exist.

- [ ] **Step 3: Add the layout helper**

In `ui_layout.h`:

```cpp
/** Returns the Weekly panel Y position for one- or two-window layouts. */
constexpr int secondaryPanelY(bool sessionEnabled) {
    return sessionEnabled ? kContentY + kPanelHeight + kPanelGap : kContentY;
}
```

- [ ] **Step 4: Retain panel containers and apply conditional visibility**

Add `primaryPanel` and `secondaryPanel` globals. Change `makeUsagePanel` to
return its panel. Assign both in `initUsageScreen`, using
`secondaryPanelY(true)` for the initial Weekly position.

At the start of `uiUpdate` after labels are assigned:

```cpp
if (data->sessionEnabled) {
    lv_obj_clear_flag(primaryPanel, LV_OBJ_FLAG_HIDDEN);
} else {
    lv_obj_add_flag(primaryPanel, LV_OBJ_FLAG_HIDDEN);
}
lv_obj_set_y(secondaryPanel, secondaryPanelY(data->sessionEnabled));
```

Continue updating primary children while hidden so they are current if Session
returns on a later payload.

- [ ] **Step 5: Run the layout test and verify GREEN**

Run: `PATH=$HOME/.platformio/penv/bin:$PATH pio test -e native -f test_ui_layout`

Expected: all layout tests PASS.

### Task 6: Synchronize host and firmware protocol documentation

**Files:**
- Modify: `docs/ble-protocol.md`
- Modify: `docs/providers.md`
- Modify: `specs/host-daemon.md`
- Modify: `/Users/afiedler/Documents/privat/Andrés_Werkstatt/Neon-Meter/docs/protocol.md`

**Interfaces:**
- Consumes: implemented `se` contract.
- Produces: matching host and firmware documentation.

- [ ] **Step 1: Document the additive field and current one-window example**

Add `se` to payload tables/examples with this meaning:

```markdown
| `se` | boolean | Whether a real Session window is available. Missing means `true`; `false` hides Session everywhere. |
```

Add a Weekly-only ChatGPT example with `se: false`, `s: 0`, `sr: -1`, real
Weekly fields, and `detail: "7d 52%"`. State that the host classifies exact
`18000`-second and `604800`-second windows by duration rather than position.

- [ ] **Step 2: Check synchronized documentation**

Run:

```bash
rg -n 'se|604800|Session window' docs/ble-protocol.md docs/providers.md specs/host-daemon.md ../Neon-Meter/docs/protocol.md
```

Expected: both repositories describe the same `se` semantics and duration mapping.

### Task 7: Full verification and scoped commits

**Files:**
- Verify every file from Tasks 1-6.
- Do not stage `/Users/afiedler/Documents/privat/Andrés_Werkstatt/Neon-Meter/AGENTS.md`.

**Interfaces:**
- Consumes: completed host and firmware changes.
- Produces: verified commits in each local repository.

- [ ] **Step 1: Run host verification**

Run:

```bash
npm test
npm run check:format
```

Expected: all host tests PASS and Prettier reports all matched files use formatting.

- [ ] **Step 2: Run firmware verification**

Run:

```bash
npm test
npm run build
```

Expected: all native Unity test environments PASS and the CoreS3 firmware build exits 0.

- [ ] **Step 3: Review both diffs and file sizes**

Run:

```bash
git diff --check
find src tests -type f \( -name '*.mjs' -o -name '*.cpp' -o -name '*.h' \) -print0 | xargs -0 wc -l | sort -n | tail
git -C ../Neon-Meter diff --check
find ../Neon-Meter/src ../Neon-Meter/tests -type f \( -name '*.cpp' -o -name '*.h' \) -print0 | xargs -0 wc -l | sort -n | tail
```

Expected: no whitespace errors and no touched source/test file exceeds 1000 lines.

- [ ] **Step 4: Commit the host implementation**

Stage only the host plan, tests, source, docs, and spec changes, then commit:

```bash
git add -f docs/superpowers/plans/2026-07-14-optional-chatgpt-session-window.md
git add tests/payload-builder.test.mjs tests/chatgpt-provider.test.mjs tests/tray-quota-status.test.mjs src/core/FirmwarePayload.mjs src/providers/ChatGptUsageProvider.mjs src/electron/TrayQuotaStatus.mjs docs/ble-protocol.md docs/providers.md specs/host-daemon.md
git commit -m "fix: support optional ChatGPT session window"
```

- [ ] **Step 5: Commit the firmware implementation without the user edit**

```bash
git -C ../Neon-Meter add tests/test_usage_model/test_main.cpp tests/test_ui_layout/test_main.cpp src/usage_model.h src/usage_model.cpp src/main.cpp src/ui_layout.h src/ui.cpp docs/protocol.md
git -C ../Neon-Meter commit -m "fix: hide unavailable session window"
```

Expected: the commit succeeds and `git -C ../Neon-Meter status --short` still lists only `M AGENTS.md`.
