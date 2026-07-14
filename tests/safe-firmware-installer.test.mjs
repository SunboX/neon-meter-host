import assert from 'node:assert/strict'
import test from 'node:test'
import { SafeFirmwareInstaller } from '../src/firmware/SafeFirmwareInstaller.mjs'

test('SafeFirmwareInstaller flashes split parts without erasing NVS', async () => {
    const calls = []
    const port = { id: 'cores3' }
    const installer = new SafeFirmwareInstaller({
        serial: { requestPort: async () => port },
        loadFlash:
            async () =>
            async (...args) => {
                calls.push(args)
                args[0]({ state: 'finished', details: { percentage: 100 } })
            }
    })
    const progress = []

    const result = await installer.install(releaseFixture(), {
        factory: false,
        onProgress: (state) => progress.push(state)
    })

    assert.equal(result.state, 'finished')
    assert.equal(calls.length, 1)
    assert.equal(calls[0][1], port)
    assert.equal(calls[0][2], 'https://example.test/manifest.json')
    assert.deepEqual(calls[0][3], {
        name: 'Neon Meter',
        version: '1.0.7',
        builds: [
            {
                chipFamily: 'ESP32-S3',
                parts: releaseFixture().parts
            }
        ]
    })
    assert.equal(calls[0][4], false)
    assert.deepEqual(progress, [
        { state: 'finished', details: { percentage: 100 } }
    ])
})

test('SafeFirmwareInstaller factory reinstall erases before merged image', async () => {
    const calls = []
    const installer = new SafeFirmwareInstaller({
        serial: { requestPort: async () => ({ id: 'cores3' }) },
        loadFlash:
            async () =>
            async (...args) => {
                calls.push(args)
                args[0]({ state: 'finished' })
            }
    })

    await installer.install(releaseFixture(), { factory: true })

    assert.deepEqual(calls[0][3].builds[0].parts, [
        {
            path: 'https://example.test/firmware/factory.bin',
            offset: 0
        }
    ])
    assert.equal(calls[0][4], true)
})

test('SafeFirmwareInstaller rejects a non-finished flash state', async () => {
    const installer = new SafeFirmwareInstaller({
        serial: { requestPort: async () => ({ id: 'cores3' }) },
        loadFlash: async () => async (onProgress) => {
            onProgress({ state: 'error', message: 'Serial write failed' })
        }
    })

    await assert.rejects(
        installer.install(releaseFixture()),
        /Serial write failed/
    )
})

test('SafeFirmwareInstaller rejects when Web Serial is unavailable', async () => {
    const installer = new SafeFirmwareInstaller({
        serial: null,
        loadFlash: async () => async () => {}
    })

    await assert.rejects(
        installer.install(releaseFixture()),
        /Web Serial is not available/
    )
})

function releaseFixture() {
    return {
        name: 'Neon Meter',
        version: '1.0.7',
        manifestUrl: 'https://example.test/manifest.json',
        chipFamily: 'ESP32-S3',
        parts: [
            { path: 'https://example.test/firmware/bootloader.bin', offset: 0 },
            {
                path: 'https://example.test/firmware/partitions.bin',
                offset: 32768
            },
            {
                path: 'https://example.test/firmware/boot_app0.bin',
                offset: 57344
            },
            {
                path: 'https://example.test/firmware/firmware.bin',
                offset: 65536
            }
        ],
        imageUrl: 'https://example.test/firmware/firmware.bin',
        factoryImageUrl: 'https://example.test/firmware/factory.bin'
    }
}
