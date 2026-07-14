import assert from 'node:assert/strict'
import test from 'node:test'
import { IpcBleClient } from '../src/ble/IpcBleClient.mjs'

test('IpcBleClient delegates BLE operations to the preload bridge', async () => {
    const bridge = new FakeBridge()
    const client = new IpcBleClient({ bridge })

    assert.equal(client.isSupported(), true)
    assert.deepEqual(await client.connectRemembered({ id: 'device-1' }), {
        id: 'device-1',
        name: 'Neon Meter',
        connected: true
    })
    assert.deepEqual(await client.repairBlePairing(), { accepted: true })
    await client.writePayload({ hello: 'ipc' })
    client.disconnect()

    assert.deepEqual(bridge.calls, [
        ['connectRemembered', { id: 'device-1' }],
        ['repairBlePairing'],
        ['writePayload', { hello: 'ipc' }],
        ['disconnect']
    ])
})

test('IpcBleClient asks the renderer to choose among multiple native devices', async () => {
    const bridge = new FakeBridge({
        manualDevice: {
            connected: false,
            selectionRequired: true,
            devices: [
                {
                    id: 'device-left',
                    name: 'Neon Meter Left',
                    rssi: -44
                },
                {
                    id: 'device-right',
                    name: 'Neon Meter Right'
                }
            ],
            transport: 'ble'
        },
        selectedDevice: {
            id: 'device-right',
            name: 'Neon Meter Right',
            connected: true,
            transport: 'ble'
        }
    })
    const client = new IpcBleClient({ bridge })
    const chooserCalls = []

    const device = await client.connect({
        selectDevice: async (devices) => {
            chooserCalls.push(devices)
            return { id: 'device-right' }
        }
    })

    assert.deepEqual(chooserCalls, [
        [
            {
                id: 'device-left',
                name: 'Neon Meter Left',
                rssi: -44
            },
            {
                id: 'device-right',
                name: 'Neon Meter Right'
            }
        ]
    ])
    assert.deepEqual(device, {
        id: 'device-right',
        name: 'Neon Meter Right',
        connected: true,
        transport: 'ble'
    })
    assert.deepEqual(bridge.calls, [
        ['connect'],
        ['connectSelected', { id: 'device-right' }]
    ])
})

test('IpcBleClient re-emits native BLE events', () => {
    const bridge = new FakeBridge()
    const client = new IpcBleClient({ bridge })
    const events = []
    client.addEventListener('ack', (event) => events.push(event.detail))
    client.addEventListener('disconnected', () =>
        events.push({ disconnected: true })
    )

    bridge.emitBleEvent({
        type: 'ack',
        detail: { raw: 'ack' }
    })
    bridge.emitBleEvent({
        type: 'disconnected'
    })

    assert.deepEqual(events, [{ raw: 'ack' }, { disconnected: true }])
})

test('IpcBleClient restores typed native connection errors', async () => {
    const bridge = new FakeBridge({
        rememberedDevice: {
            operationError: {
                code: 'BLE_CONNECTION_TIMEOUT',
                message: 'Neon Meter BLE connection timed out',
                deviceId: 'stale-meter',
                deviceName: 'Neon Meter'
            }
        }
    })
    const client = new IpcBleClient({ bridge })

    await assert.rejects(
        () => client.connectRemembered({ id: 'stale-meter' }),
        (error) => {
            assert.equal(error.code, 'BLE_CONNECTION_TIMEOUT')
            assert.equal(error.message, 'Neon Meter BLE connection timed out')
            assert.equal(error.deviceId, 'stale-meter')
            assert.equal(error.deviceName, 'Neon Meter')
            return true
        }
    )
})

class FakeBridge {
    calls = []
    listener = null

    constructor(options = {}) {
        this.options = options
    }

    isBleSupported() {
        return true
    }

    async bleConnect() {
        this.calls.push(['connect'])
        if (this.options.manualDevice) return this.options.manualDevice
        return {
            id: 'device-1',
            name: 'Neon Meter',
            connected: true
        }
    }

    async bleConnectSelected(device) {
        this.calls.push(['connectSelected', device])
        return this.options.selectedDevice
    }

    async bleConnectRemembered(device) {
        this.calls.push(['connectRemembered', device])
        if (this.options.rememberedDevice) {
            return this.options.rememberedDevice
        }
        return {
            id: device.id || 'device-1',
            name: 'Neon Meter',
            connected: true
        }
    }

    async bleDisconnect() {
        this.calls.push(['disconnect'])
    }

    async bleWritePayload(payload) {
        this.calls.push(['writePayload', payload])
    }

    async bleRepairPairing() {
        this.calls.push(['repairBlePairing'])
        return { accepted: true }
    }

    onBleEvent(listener) {
        this.listener = listener
        return () => {
            this.listener = null
        }
    }

    emitBleEvent(payload) {
        this.listener?.(payload)
    }
}
