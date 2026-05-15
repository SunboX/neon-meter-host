import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFirmwarePayload } from '../src/core/FirmwarePayload.mjs'
import { buildProviderBundlePayload } from '../src/core/ProviderBundle.mjs'

test('buildProviderBundlePayload wraps one or two provider payloads', () => {
    const claude = buildFirmwarePayload({
        provider: 'claude',
        title: 'Claude Code',
        currentPercent: 22
    })
    const chatgpt = buildFirmwarePayload({
        provider: 'chatgpt',
        title: 'ChatGPT',
        currentPercent: 44
    })

    const bundle = buildProviderBundlePayload([claude, chatgpt], {
        rotationSeconds: 30
    })

    assert.equal(bundle.providers.length, 2)
    assert.equal(bundle.rotationSeconds, 30)
    assert.equal(bundle.providers[0].p, 'claude')
    assert.equal(bundle.providers[1].p, 'chatgpt')
})

test('buildProviderBundlePayload falls back to a no-auth error payload', () => {
    const bundle = buildProviderBundlePayload([], {
        rotationSeconds: 0
    })

    assert.equal(bundle.providers.length, 1)
    assert.equal(bundle.providers[0].p, 'host')
    assert.equal(bundle.providers[0].ok, false)
    assert.match(bundle.providers[0].detail, /No local auth/)
    assert.equal(bundle.rotationSeconds, 30)
})
