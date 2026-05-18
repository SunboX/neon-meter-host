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

test('AppController lets the view choose among multiple BLE devices', async () => {
    const state = new AppState()
    const view = new FakeView({
        selectedBleDevice: {
            id: 'device-right',
            name: 'Neon Meter Right'
        }
    })
    const bridge = new FakeBridge({ loadSettings: { autoSync: false } })
    const bleClient = new FakeBleClient({
        selectionDevices: [
            {
                id: 'device-left',
                name: 'Neon Meter Left',
                rssi: -42
            },
            {
                id: 'device-right',
                name: 'Neon Meter Right',
                rssi: -66
            }
        ],
        selectedManualDevice: {
            id: 'device-right',
            name: 'Neon Meter Right',
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

    assert.deepEqual(view.bleDeviceChoiceRequests, [
        [
            {
                id: 'device-left',
                name: 'Neon Meter Left',
                rssi: -42
            },
            {
                id: 'device-right',
                name: 'Neon Meter Right',
                rssi: -66
            }
        ]
    ])
    assert.deepEqual(bleClient.selectedManualChoice, {
        id: 'device-right',
        name: 'Neon Meter Right'
    })
    assert.equal(
        bridge.savedSettings.at(-1).rememberedBleDeviceId,
        'device-right'
    )
    assert.equal(
        bridge.savedSettings.at(-1).rememberedBleDeviceName,
        'Neon Meter Right'
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

test('AppController refreshes and writes payload when a reset timer fires', async () => {
    const initialPayload = {
        rotationSeconds: 30,
        providers: [
            {
                p: 'chatgpt',
                title: 'ChatGPT',
                s: 100,
                sl: 'Session',
                sr: 1,
                w: 70,
                wl: 'Weekly',
                wr: 600,
                st: 'ok',
                detail: 'reset soon',
                ok: true
            }
        ]
    }
    const refreshedPayload = {
        rotationSeconds: 30,
        providers: [
            {
                p: 'chatgpt',
                title: 'ChatGPT',
                s: 0,
                sl: 'Session',
                sr: 300,
                w: 71,
                wl: 'Weekly',
                wr: 599,
                st: 'ok',
                detail: 'fresh reset data',
                ok: true
            }
        ]
    }
    const state = new AppState()
    const view = new FakeView()
    const bridge = new FakeBridge({
        loadSettings: { autoSync: false },
        providerBundles: [initialPayload, refreshedPayload]
    })
    const bleClient = new FakeBleClient({
        manualDevice: {
            id: 'device-9',
            name: 'AI Meter Reset',
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

    assert.deepEqual(bleClient.payloads, [initialPayload])
    assert.equal(timers.pendingCount, 1)
    assert.deepEqual(timers.pendingDelays, [60000])

    await timers.runNext()

    assert.deepEqual(bleClient.payloads, [initialPayload, refreshedPayload])
    assert.deepEqual(state.getSnapshot().payload, refreshedPayload)

    controller.dispose()
})

test('AppController compares connected firmware against latest release', async () => {
    const state = new AppState()
    const view = new FakeView()
    const bridge = new FakeBridge({
        latestFirmwareRelease: {
            version: '1.0.1',
            name: 'Neon Meter',
            manifestUrl: 'https://sunbox.github.io/neon-meter/manifest.json',
            chipFamily: 'ESP32-S3',
            imageUrl: 'https://sunbox.github.io/neon-meter/firmware.bin'
        }
    })
    const bleClient = new FakeBleClient({
        manualDevice: {
            id: 'usb-1',
            name: 'Neon Meter USB',
            connected: true,
            transport: 'usb',
            firmwareVersion: '1.0.0',
            chipFamily: 'ESP32-S3'
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

    const snapshot = state.getSnapshot()
    assert.equal(snapshot.firmware.latestVersion, '1.0.1')
    assert.equal(snapshot.firmware.connectedVersion, '1.0.0')
    assert.equal(snapshot.firmware.updateAvailable, true)
    assert.equal(snapshot.firmware.status, 'Update available')
})

test('AppController prepares installer by disconnecting the active transport', async () => {
    const state = new AppState({
        ble: {
            connected: true,
            supported: true,
            deviceName: 'Neon Meter USB'
        }
    })
    const view = new FakeView()
    const bridge = new FakeBridge({})
    const bleClient = new FakeBleClient()
    const controller = new AppController({
        state,
        view,
        bridge,
        bleClient
    })

    await controller.init()
    await view.prepareFirmwareInstall()

    assert.equal(bleClient.disconnectedByUser, true)
    assert.equal(state.getSnapshot().firmware.installerReady, true)
    assert.equal(state.getSnapshot().firmware.status, 'Installer ready')
})

test('AppController resumes USB probing after installer dialog closes', async () => {
    const timers = new FakeTimers()
    const state = new AppState({
        ble: {
            connected: true,
            supported: true,
            deviceName: 'Neon Meter USB'
        }
    })
    const view = new FakeView()
    const bridge = new FakeBridge({})
    const bleClient = new FakeBleClient({
        canConnectWithoutRemembered: true,
        rememberedDevices: [
            {
                name: 'Neon Meter USB',
                connected: true,
                transport: 'usb',
                firmwareVersion: '1.0.1',
                chipFamily: 'ESP32-S3'
            },
            {
                name: 'Neon Meter USB',
                connected: true,
                transport: 'usb',
                firmwareVersion: '1.0.1',
                chipFamily: 'ESP32-S3'
            }
        ]
    })
    const controller = new AppController({
        state,
        view,
        bridge,
        bleClient,
        timers,
        usbAutoConnectDelayMs: 25
    })

    await controller.init()
    await view.prepareFirmwareInstall()
    await view.closeFirmwareInstaller()

    assert.equal(state.getSnapshot().firmware.installerReady, false)
    assert.equal(
        state.getSnapshot().firmware.status,
        'Reconnecting Neon Meter over USB'
    )
    assert.deepEqual(timers.pendingDelays, [25])

    await timers.runNext()

    assert.deepEqual(bleClient.rememberedConnectRequests.at(-1), {
        id: '',
        name: ''
    })
    assert.equal(state.getSnapshot().ble.connected, true)
    assert.equal(state.getSnapshot().ble.deviceName, 'Neon Meter USB')
    assert.equal(state.getSnapshot().firmware.connectedVersion, '1.0.1')
})

test('AppController resumes USB probing after firmware serial selection is canceled', async () => {
    const timers = new FakeTimers()
    const state = new AppState({
        ble: {
            connected: false,
            supported: true,
            deviceName: ''
        },
        firmware: {
            installerReady: true,
            status: 'Installer ready'
        }
    })
    const view = new FakeView()
    const bridge = new FakeBridge({})
    const bleClient = new FakeBleClient({
        canConnectWithoutRemembered: true
    })
    const controller = new AppController({
        state,
        view,
        bridge,
        bleClient,
        timers,
        usbAutoConnectDelayMs: 25
    })

    await controller.init()
    bridge.emitFirmwareInstallerEvent({ type: 'serial-canceled' })

    assert.equal(state.getSnapshot().firmware.installerReady, false)
    assert.equal(
        state.getSnapshot().firmware.status,
        'Reconnecting Neon Meter over USB'
    )
    assert.deepEqual(timers.pendingDelays, [25])
})

class FakeView {
    #connectCallback = async () => {}
    #disconnectCallback = async () => {}
    #firmwarePrepareCallback = async () => {}
    #firmwareRecheckCallback = async () => {}
    #firmwareClosedCallback = async () => {}
    bleDeviceChoiceRequests = []

    constructor(options = {}) {
        this.options = options
    }

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

    bindFirmwareInstallPrepare(callback) {
        this.#firmwarePrepareCallback = callback
    }

    bindFirmwareRecheck(callback) {
        this.#firmwareRecheckCallback = callback
    }

    bindFirmwareInstallerClosed(callback) {
        this.#firmwareClosedCallback = callback
    }

    closeSettingsDialog() {}

    openSettingsDialog() {}

    async connect() {
        await this.#connectCallback()
    }

    async disconnect() {
        await this.#disconnectCallback()
    }

    async prepareFirmwareInstall() {
        await this.#firmwarePrepareCallback()
    }

    async recheckFirmware() {
        await this.#firmwareRecheckCallback()
    }

    async closeFirmwareInstaller() {
        await this.#firmwareClosedCallback({ reason: 'closed' })
    }

    async chooseBleDevice(devices) {
        this.bleDeviceChoiceRequests.push(devices)
        return this.options.selectedBleDevice || null
    }
}

class FakeBridge {
    savedSettings = []
    #firmwareInstallerEventCallback = null

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
        if (Array.isArray(this.options.providerBundles)) {
            return this.options.providerBundles.shift()
        }
        return {
            rotationSeconds: settings?.rotationSeconds || 30,
            providers: []
        }
    }

    async fetchLatestFirmwareRelease() {
        if (this.options.latestFirmwareError) {
            throw this.options.latestFirmwareError
        }
        return this.options.latestFirmwareRelease || null
    }

    onFirmwareInstallerEvent(callback) {
        this.#firmwareInstallerEventCallback = callback
        return () => {
            this.#firmwareInstallerEventCallback = null
        }
    }

    emitFirmwareInstallerEvent(event) {
        this.#firmwareInstallerEventCallback?.(event)
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
        if (this.options.selectionDevices) {
            const selected = await arguments[0]?.selectDevice(
                this.options.selectionDevices
            )
            this.selectedManualChoice = selected
            return this.options.selectedManualDevice
        }
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

    get pendingDelays() {
        return Array.from(this.#timeouts.values()).map((item) => item.delay)
    }

    setTimeout(callback, _delay) {
        const id = this.#nextId
        this.#nextId += 1
        this.#timeouts.set(id, { callback, delay: _delay })
        return id
    }

    clearTimeout(id) {
        this.#timeouts.delete(id)
    }

    async runNext() {
        const [id, timeout] = this.#timeouts.entries().next().value || []
        if (!id) return
        this.#timeouts.delete(id)
        await timeout.callback()
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
