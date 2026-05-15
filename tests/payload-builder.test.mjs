import test from 'node:test'
import assert from 'node:assert/strict'
import {
    buildFirmwarePayload,
    minutesUntilEndOfDay,
    minutesUntilEndOfMonth
} from '../src/core/FirmwarePayload.mjs'

test('buildFirmwarePayload clamps percentages and emits compact firmware fields', () => {
    const payload = buildFirmwarePayload({
        provider: 'claude',
        title: 'Claude Code',
        currentPercent: 137,
        currentLabel: 'Today',
        currentResetMinutes: 54,
        windowPercent: -4,
        windowLabel: 'Monthly',
        windowResetMinutes: 1200,
        status: 'ok',
        detail: 'usage synced',
        ok: true
    })

    assert.deepEqual(payload, {
        p: 'claude',
        title: 'Claude Code',
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
})

test('buildFirmwarePayload falls back to provider defaults and limits detail text', () => {
    const payload = buildFirmwarePayload({
        provider: 'chatgpt',
        currentPercent: 45.7,
        windowPercent: 10.2,
        detail: 'a'.repeat(90)
    })

    assert.equal(payload.title, 'ChatGPT')
    assert.equal(payload.sl, 'Current')
    assert.equal(payload.wl, 'Weekly')
    assert.equal(payload.s, 46)
    assert.equal(payload.w, 10)
    assert.equal(payload.detail.length, 48)
})

test('reset helpers return minutes until local day and month boundaries', () => {
    const now = new Date(2026, 4, 15, 10, 30, 0, 0)

    assert.equal(minutesUntilEndOfDay(now), 810)
    assert.equal(minutesUntilEndOfMonth(now), 23850)
})
