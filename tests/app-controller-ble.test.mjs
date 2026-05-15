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

    async connect() {
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
