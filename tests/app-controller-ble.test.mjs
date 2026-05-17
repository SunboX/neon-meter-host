import assert from 'node:assert/strict'
import test from 'node:test'
import { AppController } from '../src/AppController.mjs'
import { AppState } from '../src/core/AppState.mjs'

test('AppController auto-connects a remembered BLE device on startup', async () => {
    const state = new AppState()
    const view = new FakeView()
    const bridge = new FakeBridge({
        loadSettings: {
            autoSync: false,
            rememberedBleDeviceId: 'device-1',
            rememberedBleDeviceName: 'AI Meter CoreS3'
        }
    })
    const bleClient = new FakeBleClient({
        rememberedDevice: {
            id: 'device-1',
            name: 'AI Meter CoreS3',
            connected: true
        }
    })
    const controller = new AppController({
        state,
        view,
        bridge,
        bleClient
    })

    await controller.init()
    await flushMicrotasks()

    assert.deepEqual(bleClient.rememberedConnectRequests, [
        {
            id: 'device-1',
            name: 'AI Meter CoreS3'
        }
    ])
    assert.equal(state.getSnapshot().ble.connected, true)
    assert.equal(state.getSnapshot().ble.deviceName, 'AI Meter CoreS3')
    assert.deepEqual(bleClient.payloads, [
        {
            rotationSeconds: 30,
            providers: []
        }
    ])

    controller.dispose()
})

test('AppController auto-connects USB-capable clients without remembered BLE metadata', async () => {
    const state = new AppState()
    const view = new FakeView()
    const bridge = new FakeBridge({ loadSettings: { autoSync: false } })
    const bleClient = new FakeBleClient({
        canConnectWithoutRemembered: true,
        rememberedDevice: {
            id: 'usb:/dev/cu.usbmodem101',
            name: 'Neon Meter USB',
            connected: true,
            transport: 'usb'
        }
    })
    const controller = new AppController({
        state,
        view,
        bridge,
        bleClient
    })

    await controller.init()
    await flushMicrotasks()

    assert.deepEqual(bleClient.rememberedConnectRequests, [
        {
            id: '',
            name: ''
        }
    ])
    assert.equal(state.getSnapshot().ble.connected, true)
    assert.equal(state.getSnapshot().ble.deviceName, 'Neon Meter USB')
    assert.deepEqual(bleClient.payloads, [
        {
            rotationSeconds: 30,
            providers: []
        }
    ])

    controller.dispose()
})

test('AppController persists BLE device metadata after manual connect', async () => {
    const state = new AppState()
    const view = new FakeView()
    const bridge = new FakeBridge({ loadSettings: { autoSync: false } })
    const bleClient = new FakeBleClient({
        manualDevice: {
            id: 'device-2',
            name: 'AI Meter Lab',
            connected: true
        }
    })
    const controller = new AppController({
        state,
        view,
        bridge,
        bleClient
    })

    await controller.init()
    await view.connect()

    assert.equal(bridge.savedSettings.at(-1).rememberedBleDeviceId, 'device-2')
    assert.equal(
        bridge.savedSettings.at(-1).rememberedBleDeviceName,
        'AI Meter Lab'
    )
    assert.equal(state.getSnapshot().settings.rememberedBleDeviceId, 'device-2')
    assert.equal(
        state.getSnapshot().settings.rememberedBleDeviceName,
        'AI Meter Lab'
    )

    controller.dispose()
})

test('AppController exposes manual BLE connection progress', async () => {
    const pendingConnection = createDeferred()
    const state = new AppState()
    const view = new FakeView()
    const bridge = new FakeBridge({ loadSettings: { autoSync: false } })
    const bleClient = new FakeBleClient({
        manualDevicePromise: pendingConnection.promise
    })
    const controller = new AppController({
        state,
        view,
        bridge,
        bleClient
    })

    await controller.init()
    const connectPromise = view.connect()
    await flushMicrotasks()

    assert.equal(state.getSnapshot().ble.connecting, true)
    assert.equal(state.getSnapshot().sync.status, 'Connecting Neon Meter')

    pendingConnection.resolve({
        id: 'device-7',
        name: 'AI Meter Pending',
        connected: true
    })
    await connectPromise

    assert.equal(state.getSnapshot().ble.connecting, false)
    assert.equal(state.getSnapshot().ble.connected, true)
    assert.equal(state.getSnapshot().ble.deviceName, 'AI Meter Pending')

    controller.dispose()
})

test('AppController skips remembered BLE auto-connect when disabled', async () => {
    const state = new AppState()
    const view = new FakeView()
    const bridge = new FakeBridge({
        loadSettings: {
            autoSync: false,
            autoConnectBle: false,
            rememberedBleDeviceId: 'device-1',
            rememberedBleDeviceName: 'AI Meter CoreS3'
        }
    })
    const bleClient = new FakeBleClient({
        rememberedDevice: {
            id: 'device-1',
            name: 'AI Meter CoreS3',
            connected: true
        }
    })
    const controller = new AppController({
        state,
        view,
        bridge,
        bleClient
    })

    await controller.init()
    await flushMicrotasks()

    assert.deepEqual(bleClient.rememberedConnectRequests, [])
    assert.equal(state.getSnapshot().ble.connected, false)
    assert.deepEqual(bleClient.payloads, [])

    controller.dispose()
})

test('AppController binds browser global timers by default', async () => {
    const originalSetTimeout = globalThis.setTimeout
    const originalClearTimeout = globalThis.clearTimeout
    const originalSetInterval = globalThis.setInterval
    const originalClearInterval = globalThis.clearInterval
    const calls = []
    let controller = null

    globalThis.setTimeout = function (_callback, delay) {
        assert.equal(this, globalThis)
        calls.push(['setTimeout', delay])
        return 1001
    }
    globalThis.clearTimeout = function (id) {
        assert.equal(this, globalThis)
        calls.push(['clearTimeout', id])
    }
    globalThis.setInterval = function (_callback, delay) {
        assert.equal(this, globalThis)
        calls.push(['setInterval', delay])
        return 1002
    }
    globalThis.clearInterval = function (id) {
        assert.equal(this, globalThis)
        calls.push(['clearInterval', id])
    }

    try {
        const state = new AppState()
        const view = new FakeView()
        const bridge = new FakeBridge({
            loadSettings: {
                autoSync: true,
                autoConnectBle: false,
                syncIntervalMinutes: 5
            }
        })
        const bleClient = new FakeBleClient()
        controller = new AppController({
            state,
            view,
            bridge,
            bleClient
        })

        await controller.init()

        assert.deepEqual(calls[0], ['setInterval', 300000])
    } finally {
        controller?.dispose()
        globalThis.setTimeout = originalSetTimeout
        globalThis.clearTimeout = originalClearTimeout
        globalThis.setInterval = originalSetInterval
        globalThis.clearInterval = originalClearInterval
    }
})

test('AppController retries remembered BLE startup auto-connect when unavailable', async () => {
    const state = new AppState()
    const view = new FakeView()
    const bridge = new FakeBridge({
        loadSettings: {
            autoSync: false,
            rememberedBleDeviceId: 'device-5',
            rememberedBleDeviceName: 'AI Meter Shelf'
        }
    })
    const bleClient = new FakeBleClient({
        rememberedDevices: [
            null,
            {
                id: 'device-5',
                name: 'AI Meter Shelf',
                connected: true
            }
        ]
    })
    const timers = new FakeTimers()
    const controller = new AppController({
        state,
        view,
        bridge,
        bleClient,
        timers
    })

    await controller.init()
    await flushMicrotasks()

    assert.equal(state.getSnapshot().ble.connected, false)
    assert.equal(timers.pendingCount, 1)

    await timers.runNext()

    assert.deepEqual(bleClient.rememberedConnectRequests, [
        {
            id: 'device-5',
            name: 'AI Meter Shelf'
        },
        {
            id: 'device-5',
            name: 'AI Meter Shelf'
        }
    ])
    assert.equal(state.getSnapshot().ble.connected, true)
    assert.equal(state.getSnapshot().ble.deviceName, 'AI Meter Shelf')
    assert.equal(timers.pendingCount, 0)

    controller.dispose()
})

test('AppController reconnects a remembered BLE device after connection loss', async () => {
    const state = new AppState()
    const view = new FakeView()
    const bridge = new FakeBridge({ loadSettings: { autoSync: false } })
    const bleClient = new FakeBleClient({
        manualDevice: {
            id: 'device-3',
            name: 'AI Meter Desk',
            connected: true
        },
        rememberedDevices: [
            null,
            {
                id: 'device-3',
                name: 'AI Meter Desk',
                connected: true
            }
        ]
    })
    const timers = new FakeTimers()
    const controller = new AppController({
        state,
        view,
        bridge,
        bleClient,
        timers
    })

    await controller.init()
    await view.connect()
    bleClient.emitDisconnected()

    assert.equal(state.getSnapshot().ble.connected, false)
    assert.equal(timers.pendingCount, 1)

    await timers.runNext()
    assert.equal(state.getSnapshot().ble.connected, false)
    assert.equal(timers.pendingCount, 1)

    await timers.runNext()
    assert.deepEqual(bleClient.rememberedConnectRequests.slice(-2), [
        {
            id: 'device-3',
            name: 'AI Meter Desk'
        },
        {
            id: 'device-3',
            name: 'AI Meter Desk'
        }
    ])
    assert.equal(state.getSnapshot().ble.connected, true)
    assert.equal(state.getSnapshot().ble.deviceName, 'AI Meter Desk')
    assert.equal(timers.pendingCount, 0)

    controller.dispose()
})

test('AppController upgrades an active BLE connection when USB appears later', async () => {
    const state = new AppState()
    const view = new FakeView()
    const bridge = new FakeBridge({
        loadSettings: {
            autoSync: false,
            rememberedBleDeviceId: 'device-6',
            rememberedBleDeviceName: 'AI Meter Wall'
        }
    })
    const bleClient = new FakeBleClient({
        canConnectWithoutRemembered: true,
        rememberedDevices: [
            {
                id: 'device-6',
                name: 'AI Meter Wall',
                connected: true,
                transport: 'ble'
            },
            {
                id: 'usb:/dev/cu.usbmodem101',
                name: 'Neon Meter USB',
                connected: true,
                transport: 'usb'
            }
        ]
    })
    const timers = new FakeTimers()
    const controller = new AppController({
        state,
        view,
        bridge,
        bleClient,
        timers
    })

    await controller.init()
    await flushMicrotasks()

    assert.equal(state.getSnapshot().ble.connected, true)
    assert.equal(state.getSnapshot().ble.deviceName, 'AI Meter Wall')
    assert.equal(timers.pendingCount, 1)

    await timers.runNext()

    assert.deepEqual(bleClient.rememberedConnectRequests, [
        {
            id: 'device-6',
            name: 'AI Meter Wall'
        },
        {
            id: '',
            name: ''
        }
    ])
    assert.equal(state.getSnapshot().ble.connected, true)
    assert.equal(state.getSnapshot().ble.deviceName, 'Neon Meter USB')
    assert.equal(timers.pendingCount, 0)

    controller.dispose()
})

test('AppController keeps probing USB after manual BLE disconnect', async () => {
    const state = new AppState()
    const view = new FakeView()
    const bridge = new FakeBridge({
        loadSettings: {
            autoSync: false,
            rememberedBleDeviceId: 'device-8',
            rememberedBleDeviceName: 'AI Meter Sideboard'
        }
    })
    const bleClient = new FakeBleClient({
        canConnectWithoutRemembered: true,
        rememberedDevices: [
            {
                id: 'device-8',
                name: 'AI Meter Sideboard',
                connected: true,
                transport: 'ble'
            },
            {
                id: 'usb:/dev/cu.usbmodem101',
                name: 'Neon Meter USB',
                connected: true,
                transport: 'usb'
            }
        ]
    })
    const timers = new FakeTimers()
    const controller = new AppController({
        state,
        view,
        bridge,
        bleClient,
        timers
    })

    await controller.init()
    await flushMicrotasks()
    await view.disconnect()

    assert.equal(state.getSnapshot().ble.connected, false)
    assert.equal(timers.pendingCount, 1)

    await timers.runNext()

    assert.deepEqual(bleClient.rememberedConnectRequests, [
        {
            id: 'device-8',
            name: 'AI Meter Sideboard'
        },
        {
            id: '',
            name: ''
        }
    ])
    assert.equal(state.getSnapshot().ble.connected, true)
    assert.equal(state.getSnapshot().ble.deviceName, 'Neon Meter USB')

    controller.dispose()
})

test('AppController does not reconnect after manual BLE disconnect', async () => {
    const state = new AppState()
    const view = new FakeView()
    const bridge = new FakeBridge({ loadSettings: { autoSync: false } })
    const bleClient = new FakeBleClient({
        manualDevice: {
            id: 'device-4',
            name: 'AI Meter Bench',
            connected: true
        },
        rememberedDevice: {
            id: 'device-4',
            name: 'AI Meter Bench',
            connected: true
        }
    })
    const timers = new FakeTimers()
    const controller = new AppController({
        state,
        view,
        bridge,
        bleClient,
        timers
    })

    await controller.init()
    await view.connect()
    await view.disconnect()

    assert.equal(state.getSnapshot().ble.connected, false)
    assert.equal(timers.pendingCount, 0)
    assert.deepEqual(bleClient.rememberedConnectRequests, [])

    controller.dispose()
})

class FakeView {
    #connectCallback = async () => {}
    #disconnectCallback = async () => {}

    render(_snapshot) {}

    setVersion(_version) {}

    bindConnect(callback) {
        this.#connectCallback = callback
    }

    bindDisconnect(callback) {
        this.#disconnectCallback = callback
    }

    bindSyncNow(_callback) {}

    bindSettingsOpen(_callback) {}

    bindSettingsCancel(_callback) {}

    bindSettingsSave(_callback) {}

    closeSettingsDialog() {}

    openSettingsDialog() {}

    async connect() {
        await this.#connectCallback()
    }

    async disconnect() {
        await this.#disconnectCallback()
    }
}

class FakeBridge {
    savedSettings = []

    constructor(options) {
        this.options = options
    }

    async getAppMeta() {
        return {
            version: '0.1.0',
            credentialStatus: {
                claude: { configured: false, source: 'none' },
                chatgpt: { configured: false, source: 'none' }
            }
        }
    }

    async loadSettings() {
        return this.options.loadSettings || {}
    }

    async saveSettings(settings) {
        this.savedSettings.push(settings)
        return settings
    }

    async fetchProviderBundle(settings) {
        return {
            rotationSeconds: settings?.rotationSeconds || 30,
            providers: []
        }
    }
}

class FakeBleClient extends EventTarget {
    payloads = []
    rememberedConnectRequests = []
    disconnectedByUser = false

    constructor(options = {}) {
        super()
        this.options = options
    }

    isSupported() {
        return true
    }

    canConnectWithoutRemembered() {
        return Boolean(this.options.canConnectWithoutRemembered)
    }

    async connect() {
        if (this.options.manualConnectError)
            throw this.options.manualConnectError
        if (this.options.manualDevicePromise) {
            return this.options.manualDevicePromise
        }
        return this.options.manualDevice
    }

    async connectRemembered(device) {
        this.rememberedConnectRequests.push({
            id: device.id,
            name: device.name
        })
        if (Array.isArray(this.options.rememberedDevices)) {
            return this.options.rememberedDevices.shift() || null
        }
        return this.options.rememberedDevice || null
    }

    disconnect() {
        this.disconnectedByUser = true
        this.emitDisconnected()
    }

    async writePayload(payload) {
        this.payloads.push(payload)
    }

    emitDisconnected() {
        this.dispatchEvent(new CustomEvent('disconnected'))
    }
}

class FakeTimers {
    #nextId = 1
    #timeouts = new Map()

    get pendingCount() {
        return this.#timeouts.size
    }

    setTimeout(callback, _delay) {
        const id = this.#nextId
        this.#nextId += 1
        this.#timeouts.set(id, callback)
        return id
    }

    clearTimeout(id) {
        this.#timeouts.delete(id)
    }

    async runNext() {
        const [id, callback] = this.#timeouts.entries().next().value || []
        if (!id) return
        this.#timeouts.delete(id)
        await callback()
    }
}

async function flushMicrotasks() {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
}

function createDeferred() {
    let resolve = () => {}
    let reject = () => {}
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })

    return { promise, resolve, reject }
}
