import assert from 'node:assert/strict'
import test from 'node:test'
import { WebBluetoothAiMeterClient } from '../src/ble/WebBluetoothAiMeterClient.mjs'

test('WebBluetoothAiMeterClient reconnects to a remembered granted device', async () => {
    const rx = new FakeCharacteristic()
    const bluetooth = {
        async getDevices() {
            return [
                createFakeDevice({
                    id: 'device-1',
                    name: 'AI Meter CoreS3',
                    rx
                })
            ]
        },
        async requestDevice() {
            throw new Error(
                'requestDevice should not open for remembered devices'
            )
        }
    }
    const client = new WebBluetoothAiMeterClient({ bluetooth })

    const device = await client.connectRemembered({
        id: 'device-1',
        name: 'AI Meter CoreS3'
    })
    await client.writePayload({ hello: 'meter' })

    assert.deepEqual(device, {
        id: 'device-1',
        name: 'AI Meter CoreS3',
        connected: true
    })
    assert.equal(new TextDecoder().decode(rx.lastWrite), '{"hello":"meter"}')
})

test('WebBluetoothAiMeterClient allows the renamed Neon Meter device', async () => {
    const rx = new FakeCharacteristic()
    let requestOptions = null
    const bluetooth = {
        async requestDevice(options) {
            requestOptions = options
            return createFakeDevice({
                id: 'device-neon',
                name: 'Neon Meter',
                rx
            })
        }
    }
    const client = new WebBluetoothAiMeterClient({ bluetooth })

    const device = await client.connect()

    assert.deepEqual(requestOptions.filters, [
        { namePrefix: 'Neon Meter' },
        { namePrefix: 'AI Meter' }
    ])
    assert.deepEqual(device, {
        id: 'device-neon',
        name: 'Neon Meter',
        connected: true
    })
})

test('WebBluetoothAiMeterClient returns null when no remembered device is granted', async () => {
    const client = new WebBluetoothAiMeterClient({
        bluetooth: {
            async getDevices() {
                return []
            }
        }
    })

    assert.equal(
        await client.connectRemembered({
            id: 'missing',
            name: 'AI Meter CoreS3'
        }),
        null
    )
})

class FakeCharacteristic extends EventTarget {
    lastWrite = null

    async startNotifications() {}

    async writeValueWithResponse(value) {
        this.lastWrite = value
    }
}

function createFakeDevice({ id, name, rx }) {
    const tx = new FakeCharacteristic()
    const refresh = new FakeCharacteristic()
    const service = {
        async getCharacteristic(uuid) {
            if (uuid.endsWith('2')) return rx
            if (uuid.endsWith('3')) return tx
            if (uuid.endsWith('4')) return refresh
            throw new Error('Unknown characteristic ' + uuid)
        }
    }
    const server = {
        async getPrimaryService() {
            return service
        }
    }
    return {
        id,
        name,
        addEventListener() {},
        gatt: {
            connected: false,
            async connect() {
                this.connected = true
                return server
            },
            disconnect() {
                this.connected = false
            }
        }
    }
}
