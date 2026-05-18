import assert from 'node:assert/strict'
import test from 'node:test'
import { createBluetoothDeviceSelector } from '../src/electron/BluetoothDeviceSelector.mjs'

test('Bluetooth selector waits when Electron scan has not found devices yet', () => {
    const callbacks = []
    const selector = createBluetoothDeviceSelector({
        timers: createFakeTimers(),
        timeoutMs: 1000
    })
    const event = createEvent()

    selector(event, [], (deviceId) => callbacks.push(deviceId))

    assert.equal(event.prevented, true)
    assert.deepEqual(callbacks, [])
})

test('Bluetooth selector chooses the first AI Meter device once discovered', () => {
    const callbacks = []
    const selector = createBluetoothDeviceSelector({
        timers: createFakeTimers(),
        timeoutMs: 1000
    })

    selector(createEvent(), [], (deviceId) => callbacks.push(deviceId))
    selector(
        createEvent(),
        [
            { deviceName: 'Other', deviceId: 'other-1' },
            { deviceName: 'AI Meter CoreS3', deviceId: 'ai-meter-1' }
        ],
        (deviceId) => callbacks.push(deviceId)
    )

    assert.deepEqual(callbacks, ['ai-meter-1'])
})

test('Bluetooth selector chooses a Neon Meter device before unrelated devices', () => {
    const callbacks = []
    const selector = createBluetoothDeviceSelector({
        timers: createFakeTimers(),
        timeoutMs: 1000
    })

    selector(
        createEvent(),
        [
            { deviceName: 'Other', deviceId: 'other-1' },
            { deviceName: 'Neon Meter', deviceId: 'neon-1' }
        ],
        (deviceId) => callbacks.push(deviceId)
    )

    assert.deepEqual(callbacks, ['neon-1'])
})

test('Bluetooth selector asks the chooser when multiple meters are discovered', async () => {
    const callbacks = []
    const chooserCalls = []
    const selector = createBluetoothDeviceSelector({
        timers: createFakeTimers(),
        timeoutMs: 1000,
        chooseDevice: async (devices) => {
            chooserCalls.push(devices)
            return { id: 'neon-2' }
        }
    })

    selector(
        createEvent(),
        [
            { deviceName: 'Neon Meter Left', deviceId: 'neon-1', rssi: -45 },
            { deviceName: 'Neon Meter Right', deviceId: 'neon-2' }
        ],
        (deviceId) => callbacks.push(deviceId)
    )
    await flushMicrotasks()

    assert.deepEqual(chooserCalls, [
        [
            {
                id: 'neon-1',
                name: 'Neon Meter Left',
                rssi: -45
            },
            {
                id: 'neon-2',
                name: 'Neon Meter Right'
            }
        ]
    ])
    assert.deepEqual(callbacks, ['neon-2'])
})

test('Bluetooth selector cancels only after the scan timeout expires', () => {
    const callbacks = []
    const timers = createFakeTimers()
    const selector = createBluetoothDeviceSelector({
        timers,
        timeoutMs: 1000
    })

    selector(createEvent(), [], (deviceId) => callbacks.push(deviceId))
    assert.deepEqual(callbacks, [])

    timers.tick(999)
    assert.deepEqual(callbacks, [])

    timers.tick(1)
    assert.deepEqual(callbacks, [''])
})

test('Bluetooth selector falls back to the first visible device', () => {
    const callbacks = []
    const selector = createBluetoothDeviceSelector({
        timers: createFakeTimers(),
        timeoutMs: 1000
    })

    selector(
        createEvent(),
        [{ deviceName: 'Unnamed BLE device', deviceId: 'visible-1' }],
        (deviceId) => callbacks.push(deviceId)
    )

    assert.deepEqual(callbacks, ['visible-1'])
})

/**
 * Creates a fake Electron event.
 * @returns {{ prevented: boolean, preventDefault: () => void }}
 */
function createEvent() {
    return {
        prevented: false,
        preventDefault() {
            this.prevented = true
        }
    }
}

async function flushMicrotasks() {
    await Promise.resolve()
    await Promise.resolve()
}

/**
 * Creates deterministic timer hooks.
 * @returns {{ setTimeout: (callback: () => void, delay: number) => object, clearTimeout: (handle: object) => void, tick: (ms: number) => void }}
 */
function createFakeTimers() {
    let now = 0
    const timeouts = new Set()

    return {
        setTimeout(callback, delay) {
            const handle = { callback, dueAt: now + delay, cleared: false }
            timeouts.add(handle)
            return handle
        },
        clearTimeout(handle) {
            handle.cleared = true
            timeouts.delete(handle)
        },
        tick(ms) {
            now += ms
            for (const handle of Array.from(timeouts)) {
                if (!handle.cleared && handle.dueAt <= now) {
                    timeouts.delete(handle)
                    handle.callback()
                }
            }
        }
    }
}
