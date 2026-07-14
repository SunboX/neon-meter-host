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

test('AppController repairs pairing after two BLE timeouts for the same device', async () => {
    const state = new AppState()
    const view = new FakeView()
    const bridge = new FakeBridge({
        loadSettings: {
            autoSync: false,
            rememberedBleDeviceId: 'stale-meter',
            rememberedBleDeviceName: 'Neon Meter'
        }
    })
    const bleClient = new FakeBleClient({
        rememberedDevices: [
            bleTimeoutError('stale-meter'),
            bleTimeoutError('stale-meter')
        ],
        repairResult: { accepted: true }
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

    assert.equal(bleClient.repairCalls, 0)
    assert.equal(timers.pendingCount, 1)
    assert.equal(
        state.getSnapshot().sync.status,
        'Retrying Neon Meter Bluetooth'
    )

    await timers.runNext()
    await flushMicrotasks()

    assert.equal(bleClient.repairCalls, 1)
    assert.equal(timers.pendingCount, 1)
    assert.equal(state.getSnapshot().ble.repairing, true)
    assert.equal(state.getSnapshot().sync.status, 'Repairing Bluetooth pairing')

    controller.dispose()
})

test('AppController stops reconnecting when automatic BLE repair needs USB', async () => {
    const state = new AppState()
    const view = new FakeView()
    const bridge = new FakeBridge({
        loadSettings: {
            autoSync: false,
            rememberedBleDeviceId: 'stale-meter',
            rememberedBleDeviceName: 'Neon Meter'
        }
    })
    const bleClient = new FakeBleClient({
        rememberedDevices: [
            bleTimeoutError('stale-meter'),
            bleTimeoutError('stale-meter')
        ],
        repairResult: { accepted: false, reason: 'usb-unavailable' }
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
    await timers.runNext()
    await flushMicrotasks()

    const snapshot = state.getSnapshot()
    assert.equal(bleClient.repairCalls, 1)
    assert.equal(timers.pendingCount, 0)
    assert.equal(snapshot.ble.repairing, false)
    assert.equal(snapshot.ble.repairRequired, true)
    assert.match(snapshot.sync.error, /Connect Neon Meter by USB/)
    assert.match(snapshot.sync.error, /forget the old Neon Meter entry/)

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

test('AppController safely installs firmware and verifies after USB reconnect', async () => {
    const timers = new FakeTimers()
    const state = new AppState({
        ble: {
            connected: true,
            supported: true,
            deviceName: 'Neon Meter USB'
        }
    })
    const view = new FakeView()
    const release = firmwareReleaseFixture()
    const bridge = new FakeBridge({ latestFirmwareRelease: release })
    const firmwareInstaller = new FakeFirmwareInstaller({
        progress: [
            {
                state: 'writing',
                message: 'Writing progress: 42%',
                details: { percentage: 42 }
            },
            {
                state: 'finished',
                message: 'Installation complete',
                details: { percentage: 100 }
            }
        ]
    })
    const bleClient = new FakeBleClient({
        canConnectWithoutRemembered: true,
        rememberedDevices: [
            {
                name: 'Neon Meter USB',
                connected: true,
                transport: 'usb',
                firmwareVersion: '1.0.7',
                chipFamily: 'ESP32-S3'
            },
            {
                name: 'Neon Meter USB',
                connected: true,
                transport: 'usb',
                firmwareVersion: '1.0.7',
                chipFamily: 'ESP32-S3'
            }
        ]
    })
    const controller = new AppController({
        state,
        view,
        bridge,
        bleClient,
        firmwareInstaller,
        timers,
        usbAutoConnectDelayMs: 25
    })

    await controller.init()
    await view.installFirmware()

    assert.equal(bleClient.disconnectedByUser, true)
    assert.equal(firmwareInstaller.calls.length, 1)
    assert.equal(firmwareInstaller.calls[0].release, release)
    assert.equal(firmwareInstaller.calls[0].factory, false)
    assert.equal(state.getSnapshot().firmware.installing, false)
    assert.equal(state.getSnapshot().firmware.installProgress, 100)
    assert.equal(state.getSnapshot().firmware.verificationPending, '1.0.7')
    assert.equal(
        state.getSnapshot().firmware.status,
        'Reconnecting Neon Meter over USB'
    )
    assert.doesNotMatch(state.getSnapshot().firmware.status, /verified/i)
    assert.deepEqual(timers.pendingDelays, [25])

    await timers.runNext()
    await flushMicrotasks()

    assert.equal(state.getSnapshot().firmware.verificationPending, '')
    assert.equal(
        state.getSnapshot().firmware.status,
        'Firmware v1.0.7 verified'
    )
})

test('AppController factory reinstall always requests an erasing flash', async () => {
    const state = new AppState({
        ble: {
            connected: true,
            supported: true,
            deviceName: 'Neon Meter USB'
        }
    })
    const view = new FakeView()
    const bridge = new FakeBridge({
        latestFirmwareRelease: firmwareReleaseFixture()
    })
    const bleClient = new FakeBleClient()
    const firmwareInstaller = new FakeFirmwareInstaller()
    const controller = new AppController({
        state,
        view,
        bridge,
        bleClient,
        firmwareInstaller
    })

    await controller.init()
    await view.factoryInstallFirmware()

    assert.equal(firmwareInstaller.calls.length, 1)
    assert.equal(firmwareInstaller.calls[0].factory, true)
    assert.equal(state.getSnapshot().firmware.installMode, 'factory')
})

test('AppController reports both versions when firmware verification fails', async () => {
    const state = new AppState({
        firmware: {
            latestVersion: '1.0.7',
            verificationPending: '1.0.7'
        }
    })
    const view = new FakeView()
    const bridge = new FakeBridge({})
    const bleClient = new FakeBleClient({
        manualDevice: {
            id: 'usb-1',
            name: 'Neon Meter USB',
            connected: true,
            transport: 'usb',
            firmwareVersion: '1.0.6',
            chipFamily: 'ESP32-S3'
        }
    })
    const controller = new AppController({ state, view, bridge, bleClient })

    await controller.init()
    await view.connect()

    assert.equal(
        state.getSnapshot().firmware.status,
        'Firmware verification failed'
    )
    assert.match(state.getSnapshot().firmware.error, /v1\.0\.7/)
    assert.match(state.getSnapshot().firmware.error, /v1\.0\.6/)
    assert.equal(state.getSnapshot().firmware.verificationPending, '1.0.7')
})

test('AppController restores USB probing after firmware installation failure', async () => {
    const timers = new FakeTimers()
    const state = new AppState({
        ble: {
            connected: true,
            supported: true,
            deviceName: 'Neon Meter USB'
        }
    })
    const view = new FakeView()
    const bridge = new FakeBridge({
        latestFirmwareRelease: firmwareReleaseFixture()
    })
    const bleClient = new FakeBleClient({
        canConnectWithoutRemembered: true
    })
    const firmwareInstaller = new FakeFirmwareInstaller({
        error: new Error('Serial selection cancelled')
    })
    const controller = new AppController({
        state,
        view,
        bridge,
        bleClient,
        firmwareInstaller,
        timers,
        usbAutoConnectDelayMs: 25
    })

    await controller.init()
    await view.installFirmware()

    assert.equal(state.getSnapshot().firmware.installing, false)
    assert.equal(
        state.getSnapshot().firmware.status,
        'Firmware installation failed'
    )
    assert.match(state.getSnapshot().firmware.error, /selection cancelled/i)
    assert.deepEqual(timers.pendingDelays, [25])
})

class FakeView {
    #connectCallback = async () => {}
    #disconnectCallback = async () => {}
    #firmwareInstallCallback = async () => {}
    #firmwareFactoryCallback = async () => {}
    #firmwareRecheckCallback = async () => {}
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

    bindFirmwareInstall(callback) {
        this.#firmwareInstallCallback = callback
    }

    bindFirmwareFactoryInstall(callback) {
        this.#firmwareFactoryCallback = callback
    }

    bindFirmwareRecheck(callback) {
        this.#firmwareRecheckCallback = callback
    }

    closeSettingsDialog() {}

    openSettingsDialog() {}

    async connect() {
        await this.#connectCallback()
    }

    async disconnect() {
        await this.#disconnectCallback()
    }

    async installFirmware() {
        await this.#firmwareInstallCallback()
    }

    async factoryInstallFirmware() {
        await this.#firmwareFactoryCallback()
    }

    async recheckFirmware() {
        await this.#firmwareRecheckCallback()
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

class FakeFirmwareInstaller {
    calls = []

    constructor(options = {}) {
        this.options = options
    }

    async install(release, options) {
        this.calls.push({
            release,
            factory: Boolean(options.factory)
        })
        for (const state of this.options.progress || [
            { state: 'finished', details: { percentage: 100 } }
        ]) {
            options.onProgress?.(state)
        }
        if (this.options.error) throw this.options.error
        return { state: 'finished' }
    }
}

class FakeBleClient extends EventTarget {
    payloads = []
    rememberedConnectRequests = []
    disconnectedByUser = false
    repairCalls = 0

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
            const result = this.options.rememberedDevices.shift()
            if (result instanceof Error) throw result
            return result || null
        }
        return this.options.rememberedDevice || null
    }

    disconnect() {
        this.disconnectedByUser = true
        if (this.options.disconnectPromise) {
            return this.options.disconnectPromise.then(() =>
                this.emitDisconnected()
            )
        }
        this.emitDisconnected()
    }

    async writePayload(payload) {
        this.payloads.push(payload)
    }

    async repairBlePairing() {
        this.repairCalls += 1
        return (
            this.options.repairResult || {
                accepted: false,
                reason: 'usb-unavailable'
            }
        )
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

function bleTimeoutError(deviceId) {
    const error = new Error('Neon Meter BLE connection timed out')
    error.code = 'BLE_CONNECTION_TIMEOUT'
    error.deviceId = deviceId
    error.deviceName = 'Neon Meter'
    return error
}

function firmwareReleaseFixture() {
    return {
        name: 'Neon Meter',
        version: '1.0.7',
        manifestUrl: 'https://example.test/manifest.json',
        chipFamily: 'ESP32-S3',
        parts: [
            { path: 'https://example.test/bootloader.bin', offset: 0 },
            { path: 'https://example.test/partitions.bin', offset: 32768 },
            { path: 'https://example.test/boot_app0.bin', offset: 57344 },
            { path: 'https://example.test/firmware.bin', offset: 65536 }
        ],
        imageUrl: 'https://example.test/firmware.bin',
        factoryImageUrl: 'https://example.test/factory.bin'
    }
}
