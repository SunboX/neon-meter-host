import assert from 'node:assert/strict'
import test from 'node:test'
import { AppView } from '../src/ui/AppView.mjs'

test('AppView disables BLE connect and shows loader while connecting', () => {
    const document = createFakeDocument()
    const view = new AppView(document)

    view.render({
        provider: 'auto',
        locale: 'en',
        settings: {
            autoSync: true,
            autoConnectBle: true,
            startAtLogin: false,
            startHidden: false,
            syncIntervalMinutes: 5,
            rotationSeconds: 30,
            rememberedBleDeviceName: ''
        },
        ble: {
            connected: false,
            connecting: true,
            deviceName: '',
            supported: true
        },
        sync: {
            running: false,
            status: 'Connecting Neon Meter',
            error: '',
            lastSync: ''
        },
        payload: null
    })

    assert.equal(document.node('#connectButton').disabled, true)
    assert.equal(document.node('#disconnectButton').disabled, true)
    assert.equal(document.node('#syncButton').disabled, true)
    assert.equal(document.node('#syncLoader').hidden, false)
    assert.equal(
        document.node('#syncStatus').textContent,
        'Connecting Neon Meter'
    )
})

/**
 * Creates a minimal document with all nodes AppView writes during render.
 * @returns {FakeDocument}
 */
function createFakeDocument() {
    return new FakeDocument([
        '#bleState',
        '#bleDevice',
        '#syncStatus',
        '#syncLoader',
        '#syncError',
        '#lastSync',
        '#payloadPreview',
        '#localeSelect',
        '#autoSyncInput',
        '#startAtLoginInput',
        '#startHiddenInput',
        '#autoConnectBleInput',
        '#syncIntervalInput',
        '#rotationSecondsInput',
        '#providerSummary',
        '#daemonSummary',
        '#bleAutomationSummary',
        '#connectButton',
        '#disconnectButton',
        '#syncButton'
    ])
}

/**
 * Minimal querySelector-backed document for render-only AppView tests.
 */
class FakeDocument {
    #nodes

    /**
     * @param {string[]} selectors
     */
    constructor(selectors) {
        this.#nodes = new Map(
            selectors.map((selector) => [selector, new FakeElement()])
        )
    }

    /**
     * Returns a fake element for a selector.
     * @param {string} selector
     * @returns {FakeElement | null}
     */
    querySelector(selector) {
        return this.#nodes.get(selector) || null
    }

    /**
     * Returns an existing fake element and fails if it is missing.
     * @param {string} selector
     * @returns {FakeElement}
     */
    node(selector) {
        const node = this.querySelector(selector)
        assert.ok(node, 'Missing fake node ' + selector)
        return node
    }
}

/**
 * Minimal mutable element state used by AppView render.
 */
class FakeElement {
    textContent = ''
    value = ''
    checked = false
    disabled = false
    hidden = true
}
