import assert from 'node:assert/strict'
import test from 'node:test'
import {
    compareSemver,
    fetchLatestFirmwareRelease,
    normalizeFirmwareManifest
} from '../src/firmware/FirmwareReleaseClient.mjs'

test('normalizeFirmwareManifest extracts version and absolute image URL', () => {
    const release = normalizeFirmwareManifest(
        {
            name: 'Neon Meter',
            version: '1.0.1',
            builds: [
                {
                    chipFamily: 'ESP32-S3',
                    parts: [
                        {
                            path: 'firmware/neon-meter.factory.bin',
                            offset: 0
                        }
                    ]
                }
            ]
        },
        'https://sunbox.github.io/neon-meter/manifest.json'
    )

    assert.deepEqual(release, {
        name: 'Neon Meter',
        version: '1.0.1',
        manifestUrl: 'https://sunbox.github.io/neon-meter/manifest.json',
        chipFamily: 'ESP32-S3',
        imageUrl:
            'https://sunbox.github.io/neon-meter/firmware/neon-meter.factory.bin'
    })
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
                                parts: [{ path: 'firmware/current.bin' }]
                            }
                        ]
                    }
                }
            }
        }
    })

    assert.deepEqual(calls, ['https://example.test/manifest.json'])
    assert.equal(release.version, '1.0.2')
    assert.equal(release.chipFamily, 'ESP32-S3')
    assert.equal(release.imageUrl, 'https://example.test/firmware/current.bin')
})
