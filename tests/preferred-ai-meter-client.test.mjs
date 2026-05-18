import assert from 'node:assert/strict'
import test from 'node:test'
import { PreferredAiMeterClient } from '../src/transport/PreferredAiMeterClient.mjs'

test('PreferredAiMeterClient connects USB before BLE', async () => {
    const usbClient = new FakeDeviceClient({
        device: {
            id: 'usb:/dev/cu.usbmodem101',
            name: 'Neon Meter USB',
            connected: true,
            transport: 'usb'
        }
    })
    const bleClient = new FakeDeviceClient({
        device: {
            id: 'ble-1',
            name: 'Neon Meter BLE',
            connected: true,
            transport: 'ble'
        }
    })
    const client = new PreferredAiMeterClient({ usbClient, bleClient })

    const device = await client.connect()
    await client.writePayload({ hello: 'usb' })

    assert.equal(device.transport, 'usb')
    assert.equal(usbClient.connectCalls, 1)
    assert.equal(bleClient.connectCalls, 0)
    assert.deepEqual(usbClient.payloads, [{ hello: 'usb' }])
})

test('PreferredAiMeterClient falls back to BLE when USB is absent', async () => {
    const usbClient = new FakeDeviceClient({
        connectError: new Error('No Neon Meter USB device found')
    })
    const bleClient = new FakeDeviceClient({
        device: {
            id: 'ble-1',
            name: 'Neon Meter BLE',
            connected: true,
            transport: 'ble'
        }
    })
    const client = new PreferredAiMeterClient({ usbClient, bleClient })

    const device = await client.connect()
    await client.writePayload({ hello: 'ble' })

    assert.equal(device.transport, 'ble')
    assert.equal(usbClient.connectCalls, 1)
    assert.equal(bleClient.connectCalls, 1)
    assert.deepEqual(bleClient.payloads, [{ hello: 'ble' }])
})

test('PreferredAiMeterClient forwards BLE selection and connects the selected device', async () => {
    const usbClient = new FakeDeviceClient({
        connectError: new Error('No Neon Meter USB device found')
    })
    const bleClient = new FakeDeviceClient({
        device: {
            connected: false,
            selectionRequired: true,
            devices: [
                {
                    id: 'ble-left',
                    name: 'Neon Meter Left',
                    rssi: -40
                },
                {
                    id: 'ble-right',
                    name: 'Neon Meter Right',
                    rssi: -70
                }
            ]
        },
        selectedDevice: {
            id: 'ble-right',
            name: 'Neon Meter Right',
            connected: true
        }
    })
    const client = new PreferredAiMeterClient({ usbClient, bleClient })

    const selection = await client.connect()
    const device = await client.connectSelected({ id: 'ble-right' })
    await client.writePayload({ hello: 'selected' })

    assert.deepEqual(selection, {
        connected: false,
        selectionRequired: true,
        devices: [
            {
                id: 'ble-left',
                name: 'Neon Meter Left',
                rssi: -40
            },
            {
                id: 'ble-right',
                name: 'Neon Meter Right',
                rssi: -70
            }
        ],
        transport: 'ble'
    })
    assert.equal(device.transport, 'ble')
    assert.deepEqual(bleClient.selectedCalls, [{ id: 'ble-right' }])
    assert.deepEqual(bleClient.payloads, [{ hello: 'selected' }])
})

test('PreferredAiMeterClient can auto-connect USB without remembered BLE metadata', async () => {
    const usbClient = new FakeDeviceClient({
        device: {
            id: 'usb:/dev/cu.usbmodem101',
            name: 'Neon Meter USB',
            connected: true,
            transport: 'usb'
        }
    })
    const bleClient = new FakeDeviceClient({
        rememberedDevice: {
            id: 'ble-1',
            name: 'Neon Meter BLE',
            connected: true,
            transport: 'ble'
        }
    })
    const client = new PreferredAiMeterClient({ usbClient, bleClient })

    const device = await client.connectRemembered({})

    assert.equal(client.canConnectWithoutRemembered(), true)
    assert.equal(device.transport, 'usb')
    assert.equal(usbClient.connectCalls, 1)
    assert.equal(bleClient.rememberedCalls.length, 0)
})

test('PreferredAiMeterClient disconnects BLE when a later USB probe succeeds', async () => {
    const usbClient = new FakeDeviceClient({
        connectResults: [
            new Error('No Neon Meter USB device found'),
            {
                id: 'usb:/dev/cu.usbmodem101',
                name: 'Neon Meter USB',
                connected: true,
                transport: 'usb'
            }
        ]
    })
    const bleClient = new FakeDeviceClient({
        device: {
            id: 'ble-1',
            name: 'Neon Meter BLE',
            connected: true,
            transport: 'ble'
        }
    })
    const client = new PreferredAiMeterClient({ usbClient, bleClient })

    const bleDevice = await client.connect()
    const usbDevice = await client.connectRemembered({})

    assert.equal(bleDevice.transport, 'ble')
    assert.equal(usbDevice.transport, 'usb')
    assert.equal(bleClient.disconnected, true)
    assert.equal(usbClient.connectCalls, 2)
})

class FakeDeviceClient extends EventTarget {
    connectCalls = 0
    rememberedCalls = []
    selectedCalls = []
    payloads = []
    disconnected = false

    constructor(options = {}) {
        super()
        this.options = options
    }

    isSupported() {
        return this.options.supported !== false
    }

    async connect() {
        this.connectCalls += 1
        if (Array.isArray(this.options.connectResults)) {
            const result = this.options.connectResults.shift()
            if (result instanceof Error) throw result
            return result
        }
        if (this.options.connectError) throw this.options.connectError
        return this.options.device
    }

    async connectRemembered(device) {
        this.rememberedCalls.push(device)
        return this.options.rememberedDevice || null
    }

    async connectSelected(device) {
        this.selectedCalls.push(device)
        return this.options.selectedDevice || null
    }

    disconnect() {
        this.disconnected = true
    }

    async writePayload(payload) {
        this.payloads.push(payload)
    }
}
