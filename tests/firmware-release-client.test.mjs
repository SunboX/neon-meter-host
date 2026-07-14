import assert from 'node:assert/strict'
import test from 'node:test'
import {
    compareSemver,
    fetchLatestFirmwareRelease,
    normalizeFirmwareManifest
} from '../src/firmware/FirmwareReleaseClient.mjs'

test('normalizeFirmwareManifest retains every safe part and factory image', () => {
    const release = normalizeFirmwareManifest(
        {
            name: 'Neon Meter',
            version: '1.0.7',
            builds: [
                {
                    chipFamily: 'ESP32-S3',
                    parts: [
                        {
                            path: 'firmware/bootloader.bin',
                            offset: 0
                        },
                        {
                            path: 'firmware/partitions.bin',
                            offset: 32768
                        },
                        {
                            path: 'firmware/boot_app0.bin',
                            offset: 57344
                        },
                        {
                            path: 'firmware/firmware.bin',
                            offset: 65536
                        }
                    ]
                }
            ],
            factory: {
                path: 'firmware/neon-meter.factory.bin',
                offset: 0
            }
        },
        'https://sunbox.github.io/neon-meter/manifest.json'
    )

    assert.deepEqual(release, {
        name: 'Neon Meter',
        version: '1.0.7',
        manifestUrl: 'https://sunbox.github.io/neon-meter/manifest.json',
        chipFamily: 'ESP32-S3',
        parts: [
            {
                path: 'https://sunbox.github.io/neon-meter/firmware/bootloader.bin',
                offset: 0
            },
            {
                path: 'https://sunbox.github.io/neon-meter/firmware/partitions.bin',
                offset: 32768
            },
            {
                path: 'https://sunbox.github.io/neon-meter/firmware/boot_app0.bin',
                offset: 57344
            },
            {
                path: 'https://sunbox.github.io/neon-meter/firmware/firmware.bin',
                offset: 65536
            }
        ],
        imageUrl: 'https://sunbox.github.io/neon-meter/firmware/firmware.bin',
        factoryImageUrl:
            'https://sunbox.github.io/neon-meter/firmware/neon-meter.factory.bin'
    })
})

test('normalizeFirmwareManifest rejects unsafe split-image offsets', () => {
    for (const [label, parts] of [
        ['missing', [{ path: 'firmware.bin' }]],
        [
            'duplicate',
            [
                { path: 'bootloader.bin', offset: 0 },
                { path: 'firmware.bin', offset: 0 }
            ]
        ],
        ['fractional', [{ path: 'firmware.bin', offset: 65536.5 }]],
        ['negative', [{ path: 'firmware.bin', offset: -1 }]],
        ['NVS overlap', [{ path: 'firmware.bin', offset: 36864 }]]
    ]) {
        assert.throws(
            () =>
                normalizeFirmwareManifest(
                    {
                        version: '1.0.7',
                        builds: [{ chipFamily: 'ESP32-S3', parts }],
                        factory: { path: 'factory.bin', offset: 0 }
                    },
                    'https://example.test/manifest.json'
                ),
            /offset/i,
            label
        )
    }
})

test('compareSemver compares release versions without v prefixes', () => {
    assert.equal(compareSemver('1.0.1', '1.0.0'), 1)
    assert.equal(compareSemver('v1.0.1', '1.0.1'), 0)
    assert.equal(compareSemver('1.0.0', '1.0.1'), -1)
    assert.equal(compareSemver('', '1.0.1'), -1)
})

test('fetchLatestFirmwareRelease reads manifest through injected fetch', async () => {
    const calls = []
    const release = await fetchLatestFirmwareRelease({
        manifestUrl: 'https://example.test/manifest.json',
        fetch: async (url) => {
            calls.push(url)
            return {
                ok: true,
                status: 200,
                async json() {
                    return {
                        name: 'Neon Meter',
                        version: '1.0.2',
                        builds: [
                            {
                                chipFamily: 'ESP32-S3',
                                parts: [
                                    {
                                        path: 'firmware/firmware.bin',
                                        offset: 65536
                                    }
                                ]
                            }
                        ],
                        factory: { path: 'firmware/factory.bin', offset: 0 }
                    }
                }
            }
        }
    })

    assert.deepEqual(calls, ['https://example.test/manifest.json'])
    assert.equal(release.version, '1.0.2')
    assert.equal(release.chipFamily, 'ESP32-S3')
    assert.equal(release.imageUrl, 'https://example.test/firmware/firmware.bin')
})
