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
    await client.writePayload({ hello: 'ipc' })
    client.disconnect()

    assert.deepEqual(bridge.calls, [
        ['connectRemembered', { id: 'device-1' }],
        ['writePayload', { hello: 'ipc' }],
        ['disconnect']
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

class FakeBridge {
    calls = []
    listener = null

    isBleSupported() {
        return true
    }

    async bleConnect() {
        this.calls.push(['connect'])
        return {
            id: 'device-1',
            name: 'Neon Meter',
            connected: true
        }
    }

    async bleConnectRemembered(device) {
        this.calls.push(['connectRemembered', device])
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
