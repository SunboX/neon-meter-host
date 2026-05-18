import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
    NativeNobleAiMeterClient,
    nobleBindingTypeForPlatform
} from '../src/ble/NativeNobleAiMeterClient.mjs'

test('nobleBindingTypeForPlatform uses desktop-native bindings', () => {
    assert.equal(nobleBindingTypeForPlatform('darwin'), 'mac')
    assert.equal(nobleBindingTypeForPlatform('win32'), 'win')
    assert.equal(nobleBindingTypeForPlatform('linux'), 'hci')
    assert.equal(nobleBindingTypeForPlatform('freebsd'), 'hci')
    assert.equal(
        nobleBindingTypeForPlatform('linux', { NOBLE_BINDINGS: 'dbus' }),
        'dbus'
    )
})

test('NativeNobleAiMeterClient connects to a remembered device by scanning', async () => {
    const rx = new FakeCharacteristic('41494d45746572200000000000000002')
    const metadata = new FakeCharacteristic(
        '41494d45746572200000000000000005',
        '{"firmwareVersion":"1.0.1","chipFamily":"ESP32-S3"}'
    )
    const noble = new FakeNoble({
        peripherals: [
            new FakePeripheral({
                id: 'native-1',
                name: 'Neon Meter',
                characteristics: [
                    rx,
                    new FakeCharacteristic('41494d45746572200000000000000003'),
                    new FakeCharacteristic('41494d45746572200000000000000004'),
                    metadata
                ]
            })
        ]
    })
    const client = new NativeNobleAiMeterClient({
        noble,
        scanTimeoutMs: 50,
        discoveryRetryDelayMs: 0
    })

    const device = await client.connectRemembered({
        name: 'Neon Meter'
    })
    await client.writePayload({ hello: 'native' })

    assert.deepEqual(device, {
        id: 'native-1',
        name: 'Neon Meter',
        connected: true,
        firmwareVersion: '1.0.1',
        chipFamily: 'ESP32-S3'
    })
    assert.equal(noble.startRequests.length, 1)
    assert.equal(noble.stopRequests, 1)
    assert.equal(rx.lastWrite.toString('utf8'), '{"hello":"native"}')
    assert.equal(rx.lastWriteWithoutResponse, false)
})

test('NativeNobleAiMeterClient reconnects when the remembered BLE id changed', async () => {
    const noble = new FakeNoble({
        peripherals: [
            new FakePeripheral({
                id: 'native-new-id',
                name: '',
                serviceUuids: ['41494d45-7465-7220-0000-000000000001']
            })
        ]
    })
    const client = new NativeNobleAiMeterClient({
        noble,
        scanTimeoutMs: 50,
        discoveryRetryDelayMs: 0
    })

    const device = await client.connectRemembered({
        id: 'native-old-id',
        name: 'Neon Meter Old'
    })

    assert.deepEqual(device, {
        id: 'native-new-id',
        name: 'Neon Meter',
        connected: true
    })
})

test('NativeNobleAiMeterClient does not auto-connect an ambiguous remembered device', async () => {
    const noble = new FakeNoble({
        peripherals: [
            new FakePeripheral({
                id: 'meter-left',
                name: 'Neon Meter Left'
            }),
            new FakePeripheral({
                id: 'meter-right',
                name: 'Neon Meter Right'
            })
        ]
    })
    const client = new NativeNobleAiMeterClient({
        noble,
        scanTimeoutMs: 5,
        discoveryRetryDelayMs: 0
    })

    const device = await client.connectRemembered({
        id: 'remembered-missing',
        name: 'Neon Meter Desk'
    })

    assert.equal(device, null)
})

test('NativeNobleAiMeterClient avoids filtered service discovery for native bindings', async () => {
    const peripheral = new FakePeripheral({
        id: 'native-filtered',
        name: 'Neon Meter',
        rejectFilteredServiceDiscovery: true
    })
    const noble = new FakeNoble({ peripherals: [peripheral] })
    const client = new NativeNobleAiMeterClient({
        noble,
        scanTimeoutMs: 50,
        discoveryRetryDelayMs: 0
    })

    const device = await client.connect()

    assert.deepEqual(device, {
        id: 'native-filtered',
        name: 'Neon Meter',
        connected: true
    })
    assert.deepEqual(peripheral.discoveryRequests, [
        {
            serviceUuids: [],
            characteristicUuids: [
                '41494d45746572200000000000000002',
                '41494d45746572200000000000000003',
                '41494d45746572200000000000000004',
                '41494d45746572200000000000000005'
            ]
        }
    ])
})

test('NativeNobleAiMeterClient asks for selection when multiple meters are found', async () => {
    const noble = new FakeNoble({
        peripherals: [
            new FakePeripheral({
                id: 'meter-left',
                name: 'Neon Meter Left',
                rssi: -42
            }),
            new FakePeripheral({
                id: 'meter-right',
                name: 'Neon Meter Right',
                rssi: -67
            })
        ]
    })
    const client = new NativeNobleAiMeterClient({
        noble,
        scanTimeoutMs: 5,
        discoveryRetryDelayMs: 0
    })

    const result = await client.connect()

    assert.deepEqual(result, {
        connected: false,
        selectionRequired: true,
        devices: [
            {
                id: 'meter-left',
                name: 'Neon Meter Left',
                rssi: -42
            },
            {
                id: 'meter-right',
                name: 'Neon Meter Right',
                rssi: -67
            }
        ]
    })
})

test('NativeNobleAiMeterClient connects a selected meter by id', async () => {
    const noble = new FakeNoble({
        peripherals: [
            new FakePeripheral({
                id: 'meter-left',
                name: 'Neon Meter Left'
            }),
            new FakePeripheral({
                id: 'meter-right',
                name: 'Neon Meter Right'
            })
        ]
    })
    const client = new NativeNobleAiMeterClient({
        noble,
        scanTimeoutMs: 5,
        discoveryRetryDelayMs: 0
    })

    const device = await client.connectSelected({ id: 'meter-right' })

    assert.deepEqual(device, {
        id: 'meter-right',
        name: 'Neon Meter Right',
        connected: true
    })
})

test('NativeNobleAiMeterClient retries unfiltered discovery when characteristics are incomplete', async () => {
    const rx = new FakeCharacteristic('41494d45746572200000000000000002')
    const tx = new FakeCharacteristic('41494d45746572200000000000000003')
    const refresh = new FakeCharacteristic('41494d45746572200000000000000004')
    const peripheral = new FakePeripheral({
        id: 'native-incomplete-filter',
        name: 'Neon Meter',
        characteristics: [rx, tx, refresh],
        filteredCharacteristics: [rx, tx]
    })
    const noble = new FakeNoble({ peripherals: [peripheral] })
    const client = new NativeNobleAiMeterClient({
        noble,
        scanTimeoutMs: 50,
        discoveryRetryDelayMs: 0
    })

    const device = await client.connect()

    assert.deepEqual(device, {
        id: 'native-incomplete-filter',
        name: 'Neon Meter',
        connected: true
    })
    assert.deepEqual(peripheral.discoveryRequests, [
        {
            serviceUuids: [],
            characteristicUuids: [
                '41494d45746572200000000000000002',
                '41494d45746572200000000000000003',
                '41494d45746572200000000000000004',
                '41494d45746572200000000000000005'
            ]
        },
        {
            serviceUuids: [],
            characteristicUuids: []
        }
    ])
})

test('NativeNobleAiMeterClient retries GATT discovery while the link is connected', async () => {
    const rx = new FakeCharacteristic('41494d45746572200000000000000002')
    const tx = new FakeCharacteristic('41494d45746572200000000000000003')
    const refresh = new FakeCharacteristic('41494d45746572200000000000000004')
    const peripheral = new FakePeripheral({
        id: 'native-slow-gatt',
        name: 'Neon Meter',
        discoveryResults: [[rx], [rx, tx], [rx, tx, refresh]]
    })
    const noble = new FakeNoble({ peripherals: [peripheral] })
    const client = new NativeNobleAiMeterClient({
        noble,
        scanTimeoutMs: 50,
        discoveryRetryDelayMs: 0
    })

    const device = await client.connect()

    assert.deepEqual(device, {
        id: 'native-slow-gatt',
        name: 'Neon Meter',
        connected: true
    })
    assert.deepEqual(peripheral.discoveryRequests, [
        {
            serviceUuids: [],
            characteristicUuids: [
                '41494d45746572200000000000000002',
                '41494d45746572200000000000000003',
                '41494d45746572200000000000000004',
                '41494d45746572200000000000000005'
            ]
        },
        {
            serviceUuids: [],
            characteristicUuids: []
        },
        {
            serviceUuids: [],
            characteristicUuids: []
        }
    ])
})

test('NativeNobleAiMeterClient returns null when no matching device is found', async () => {
    const noble = new FakeNoble({
        peripherals: [
            new FakePeripheral({
                id: 'other-1',
                name: 'Other Device'
            })
        ]
    })
    const client = new NativeNobleAiMeterClient({
        noble,
        scanTimeoutMs: 5
    })

    assert.equal(
        await client.connectRemembered({
            name: 'Neon Meter'
        }),
        null
    )
    assert.equal(noble.stopRequests, 1)
})

test('NativeNobleAiMeterClient forwards notifications and disconnects', async () => {
    const tx = new FakeCharacteristic('41494d45746572200000000000000003')
    const refresh = new FakeCharacteristic('41494d45746572200000000000000004')
    const peripheral = new FakePeripheral({
        id: 'native-2',
        name: 'Neon Meter',
        characteristics: [
            new FakeCharacteristic('41494d45746572200000000000000002'),
            tx,
            refresh
        ]
    })
    const noble = new FakeNoble({ peripherals: [peripheral] })
    const client = new NativeNobleAiMeterClient({
        noble,
        scanTimeoutMs: 50
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
    tx.emit('data', Buffer.from('{"ok":true}', 'utf8'), true)
    refresh.emit('data', Buffer.from('refresh', 'utf8'), true)
    peripheral.emit('disconnect', 'link lost')

    assert.deepEqual(events, [
        {
            raw: '{"ok":true}',
            json: { ok: true }
        },
        { refresh: true },
        { disconnected: true }
    ])
})

class FakeNoble extends EventEmitter {
    startRequests = []
    stopRequests = 0

    constructor(options = {}) {
        super()
        this.options = options
    }

    async waitForPoweredOnAsync() {}

    async startScanningAsync(serviceUUIDs, allowDuplicates) {
        this.startRequests.push({ serviceUUIDs, allowDuplicates })
        for (const peripheral of this.options.peripherals || []) {
            queueMicrotask(() => this.emit('discover', peripheral))
        }
    }

    async stopScanningAsync() {
        this.stopRequests += 1
    }
}

class FakePeripheral extends EventEmitter {
    constructor(options = {}) {
        super()
        this.id = options.id || 'fake-id'
        this.address = options.address || ''
        this.rssi = options.rssi
        this.advertisement = {
            localName: options.name || '',
            serviceUuids: options.serviceUuids || []
        }
        this.rejectFilteredServiceDiscovery =
            options.rejectFilteredServiceDiscovery || false
        this.discoveryRequests = []
        this.characteristics = options.characteristics || [
            new FakeCharacteristic('41494d45746572200000000000000002'),
            new FakeCharacteristic('41494d45746572200000000000000003'),
            new FakeCharacteristic('41494d45746572200000000000000004')
        ]
        this.filteredCharacteristics =
            options.filteredCharacteristics || this.characteristics
        this.discoveryResults = options.discoveryResults || null
    }

    async connectAsync() {}

    async disconnectAsync() {
        this.emit('disconnect', 'local')
    }

    async discoverSomeServicesAndCharacteristicsAsync(
        serviceUuids = [],
        characteristicUuids = []
    ) {
        this.discoveryRequests.push({ serviceUuids, characteristicUuids })
        if (this.rejectFilteredServiceDiscovery && serviceUuids.length > 0) {
            throw new Error('Could not find all requested services')
        }
        if (this.discoveryResults) {
            return {
                services: [],
                characteristics:
                    this.discoveryResults.shift() || this.characteristics
            }
        }
        return {
            services: [],
            characteristics:
                characteristicUuids.length > 0
                    ? this.filteredCharacteristics
                    : this.characteristics
        }
    }
}

class FakeCharacteristic extends EventEmitter {
    constructor(uuid, value = '') {
        super()
        this.uuid = uuid
        this.value = value
        this.lastWrite = null
        this.lastWriteWithoutResponse = null
        this.subscribed = false
    }

    async readAsync() {
        return Buffer.from(this.value, 'utf8')
    }

    async subscribeAsync() {
        this.subscribed = true
    }

    async writeAsync(data, withoutResponse) {
        this.lastWrite = data
        this.lastWriteWithoutResponse = withoutResponse
    }
}
