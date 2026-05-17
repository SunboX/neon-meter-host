import assert from 'node:assert/strict'
import test from 'node:test'
import { AppState } from '../src/core/AppState.mjs'

/**
 * Verifies default state values are applied.
 */
test('AppState initializes with defaults', () => {
    const state = new AppState()
    const snapshot = state.getSnapshot()

    assert.equal(snapshot.provider, 'auto')
    assert.equal(snapshot.ble.connected, false)
    assert.equal(snapshot.ble.connecting, false)
    assert.equal(snapshot.sync.running, false)
    assert.equal(snapshot.locale, 'en')
})

/**
 * Verifies patch operations update both supported fields.
 */
test('AppState.patch updates multiple fields', () => {
    const state = new AppState({ provider: 'auto', locale: 'en' })
    const snapshot = state.patch({ provider: 'auto', locale: 'de' })

    assert.equal(snapshot.provider, 'auto')
    assert.equal(snapshot.locale, 'de')
})

/**
 * Verifies subscribers are notified on updates.
 */
test('AppState.subscribe receives updates', () => {
    const state = new AppState({ provider: 'auto' })
    const received = []

    const unsubscribe = state.subscribe((snapshot) => {
        received.push(snapshot.provider)
    })

    state.setValue('provider', 'auto')
    state.setValue('provider', 'auto')
    unsubscribe()
    state.setValue('provider', 'auto')

    assert.deepEqual(received, ['auto', 'auto', 'auto'])
})
