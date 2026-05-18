import assert from 'node:assert/strict'
import test from 'node:test'
import { registerNativeBleIpc } from '../src/electron/NativeBleIpc.mjs'

test('registerNativeBleIpc exposes native BLE handlers', async () => {
    const ipcMain = new FakeIpcMain()
    const bleClient = new FakeBleClient()

    registerNativeBleIpc({
        ipcMain,
        bleClient,
        getWebContents: () => []
    })

    const event = {}
    ipcMain.listeners.get('ble:is-supported')(event)
    assert.equal(event.returnValue, true)
    assert.deepEqual(await ipcMain.handlers.get('ble:connect')(), {
        id: 'native-1',
        name: 'Neon Meter',
        connected: true
    })
    assert.deepEqual(
        await ipcMain.handlers.get('ble:connect-remembered')(
            {},
            {
                id: 'native-2'
            }
        ),
        {
            id: 'native-2',
            name: 'Neon Meter',
            connected: true
        }
    )
    assert.deepEqual(
        await ipcMain.handlers.get('ble:connect-selected')(
            {},
            {
                id: 'native-3'
            }
        ),
        {
            id: 'native-3',
            name: 'Neon Meter',
            connected: true
        }
    )
    await ipcMain.handlers.get('ble:write-payload')({}, { hello: 'native' })
    await ipcMain.handlers.get('ble:disconnect')()

    assert.deepEqual(bleClient.calls, [
        ['connect'],
        ['connectRemembered', { id: 'native-2' }],
        ['connectSelected', { id: 'native-3' }],
        ['writePayload', { hello: 'native' }],
        ['disconnect']
    ])
})

test('registerNativeBleIpc forwards native BLE events to renderer windows', () => {
    const ipcMain = new FakeIpcMain()
    const bleClient = new FakeBleClient()
    const first = new FakeWebContents()
    const second = new FakeWebContents()

    registerNativeBleIpc({
        ipcMain,
        bleClient,
        getWebContents: () => [first, second]
    })

    bleClient.dispatchEvent(
        new CustomEvent('ack', {
            detail: { raw: 'ack' }
        })
    )
    bleClient.dispatchEvent(new CustomEvent('disconnected'))

    assert.deepEqual(first.messages, [
        ['ble:event', { type: 'ack', detail: { raw: 'ack' } }],
        ['ble:event', { type: 'disconnected', detail: null }]
    ])
    assert.deepEqual(second.messages, first.messages)
})

class FakeIpcMain {
    handlers = new Map()
    listeners = new Map()

    handle(channel, callback) {
        this.handlers.set(channel, callback)
    }

    on(channel, callback) {
        this.listeners.set(channel, callback)
    }
}

class FakeBleClient extends EventTarget {
    calls = []

    isSupported() {
        return true
    }

    async connect() {
        this.calls.push(['connect'])
        return {
            id: 'native-1',
            name: 'Neon Meter',
            connected: true
        }
    }

    async connectRemembered(device) {
        this.calls.push(['connectRemembered', device])
        return {
            id: device.id,
            name: 'Neon Meter',
            connected: true
        }
    }

    async connectSelected(device) {
        this.calls.push(['connectSelected', device])
        return {
            id: device.id,
            name: 'Neon Meter',
            connected: true
        }
    }

    disconnect() {
        this.calls.push(['disconnect'])
    }

    async writePayload(payload) {
        this.calls.push(['writePayload', payload])
    }
}

class FakeWebContents {
    messages = []

    send(channel, payload) {
        this.messages.push([channel, payload])
    }
}
