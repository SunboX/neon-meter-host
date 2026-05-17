import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { NativeUsbSerialAiMeterClient } from '../src/usb/NativeUsbSerialAiMeterClient.mjs'

test('NativeUsbSerialAiMeterClient connects with hello and writes payload frames', async () => {
    const serialportModule = createFakeSerialportModule([
        {
            path: '/dev/cu.usbmodem101',
            manufacturer: 'Espressif',
            hello: '{"type":"hello","protocol":"neon-meter-usb","version":1,"device":"Neon Meter"}\n'
        }
    ])
    const client = new NativeUsbSerialAiMeterClient({
        serialportModule,
        probeTimeoutMs: 20
    })

    const device = await client.connect()
    const port = serialportModule.instances[0]
    await client.writePayload({ rotationSeconds: 30, providers: [] })

    assert.deepEqual(device, {
        id: '/dev/cu.usbmodem101',
        name: 'Neon Meter USB',
        connected: true,
        transport: 'usb'
    })
    assert.equal(
        port.writes[0],
        '{"type":"hello","protocol":"neon-meter-usb","version":1}\n'
    )
    assert.equal(
        port.writes.at(-1),
        '{"type":"payload","payload":{"rotationSeconds":30,"providers":[]}}\n'
    )
})

test('NativeUsbSerialAiMeterClient waits for a boot-delayed hello by default', async () => {
    const serialportModule = createFakeSerialportModule([
        {
            path: '/dev/cu.usbmodem101',
            manufacturer: 'Espressif',
            hello: '{"type":"hello","protocol":"neon-meter-usb","version":1,"device":"Neon Meter"}\n',
            helloDelayMs: 1500
        }
    ])
    const client = new NativeUsbSerialAiMeterClient({
        serialportModule
    })

    const device = await client.connect()
    const port = serialportModule.instances[0]

    assert.equal(device.connected, true)
    assert.deepEqual(port.setCalls, [{ dtr: true, rts: false }])
})

test('NativeUsbSerialAiMeterClient skips unrelated serial ports before probing', async () => {
    const serialportModule = createFakeSerialportModule([
        {
            path: '/dev/cu.debug-console',
            manufacturer: 'Debug Adapter',
            hello: 'debug ready\n'
        }
    ])
    const client = new NativeUsbSerialAiMeterClient({
        serialportModule,
        probeTimeoutMs: 5
    })

    await assert.rejects(
        () => client.connect(),
        /No Neon Meter USB device found/
    )
    assert.equal(serialportModule.instances.length, 0)
})

test('NativeUsbSerialAiMeterClient ignores likely USB ports without protocol hello', async () => {
    const serialportModule = createFakeSerialportModule([
        {
            path: '/dev/cu.usbserial-debug',
            manufacturer: 'Debug Adapter',
            hello: 'debug ready\n'
        }
    ])
    const client = new NativeUsbSerialAiMeterClient({
        serialportModule,
        probeTimeoutMs: 5
    })

    await assert.rejects(
        () => client.connect(),
        /No Neon Meter USB device found/
    )
    assert.equal(serialportModule.instances[0].closed, true)
})

test('NativeUsbSerialAiMeterClient forwards ack refresh and disconnect events', async () => {
    const serialportModule = createFakeSerialportModule([
        {
            path: '/dev/cu.usbmodem101',
            manufacturer: 'Espressif',
            hello: '{"type":"hello","protocol":"neon-meter-usb","version":1,"device":"Neon Meter"}\n'
        }
    ])
    const client = new NativeUsbSerialAiMeterClient({
        serialportModule,
        probeTimeoutMs: 20
    })
    const events = []
    client.addEventListener('ack', (event) => events.push(event.detail))
    client.addEventListener('refresh-requested', () =>
        events.push({ refresh: true })
    )
    client.addEventListener('disconnected', () =>
        events.push({ disconnected: true })
    )

    await client.connect()
    const port = serialportModule.instances[0]
    port.emit(
        'data',
        Buffer.from(
            'log line\n{"type":"ack","ack":true}\n{"type":"refresh-requested"}\n'
        )
    )
    port.emit('close')

    assert.deepEqual(events, [
        {
            raw: '{"type":"ack","ack":true}',
            json: { type: 'ack', ack: true }
        },
        { refresh: true },
        { disconnected: true }
    ])
})

test('NativeUsbSerialAiMeterClient sends and stops heartbeat frames', async () => {
    const timers = new FakeTimers()
    const serialportModule = createFakeSerialportModule([
        {
            path: '/dev/cu.usbmodem101',
            manufacturer: 'Espressif',
            hello: '{"type":"hello","protocol":"neon-meter-usb","version":1,"device":"Neon Meter"}\n'
        }
    ])
    const client = new NativeUsbSerialAiMeterClient({
        serialportModule,
        timers,
        probeTimeoutMs: 20
    })

    await client.connect()
    const port = serialportModule.instances[0]

    await timers.runInterval()
    assert.equal(
        port.writes.at(-1),
        '{"type":"ping","protocol":"neon-meter-usb","version":1}\n'
    )

    client.disconnect()
    const writeCount = port.writes.length
    await timers.runInterval()

    assert.equal(port.writes.length, writeCount)
})

function createFakeSerialportModule(fixtures) {
    const fixtureByPath = new Map(
        fixtures.map((fixture) => [fixture.path, fixture])
    )

    class FakeSerialPort extends EventEmitter {
        static async list() {
            return fixtures.map((fixture) => ({
                path: fixture.path,
                manufacturer: fixture.manufacturer,
                vendorId: fixture.vendorId,
                productId: fixture.productId
            }))
        }

        constructor(options) {
            super()
            this.path = options.path
            this.fixture = fixtureByPath.get(options.path) || {}
            this.writes = []
            this.closed = false
            module.instances.push(this)
        }

        open(callback) {
            queueMicrotask(() => {
                callback(null)
                if (this.fixture.hello) {
                    setTimeout(
                        () =>
                            this.emit('data', Buffer.from(this.fixture.hello)),
                        this.fixture.helloDelayMs || 0
                    )
                }
            })
        }

        set(options, callback) {
            this.setCalls = this.setCalls || []
            this.setCalls.push(options)
            queueMicrotask(() => callback?.(null))
        }

        write(data, callback) {
            this.writes.push(Buffer.from(data).toString('utf8'))
            queueMicrotask(() => callback?.(null))
        }

        close(callback) {
            this.closed = true
            queueMicrotask(() => callback?.(null))
        }
    }

    const module = {
        SerialPort: FakeSerialPort,
        instances: []
    }
    return module
}

class FakeTimers {
    #nextId = 1
    #intervals = new Map()

    setTimeout(callback, delay) {
        return setTimeout(callback, delay)
    }

    clearTimeout(id) {
        clearTimeout(id)
    }

    setInterval(callback, _delay) {
        const id = this.#nextId
        this.#nextId += 1
        this.#intervals.set(id, callback)
        return id
    }

    clearInterval(id) {
        this.#intervals.delete(id)
    }

    async runInterval() {
        const callback = this.#intervals.values().next().value
        if (callback) await callback()
    }
}
