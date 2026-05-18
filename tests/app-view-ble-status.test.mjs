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

test('AppView resolves a selected BLE device from the chooser', async () => {
    const document = createFakeDocument()
    const view = new AppView(document)

    const choice = view.chooseBleDevice([
        {
            id: 'meter-left',
            name: 'Neon Meter Left',
            rssi: -42
        },
        {
            id: 'meter-right',
            name: 'Neon Meter Right'
        }
    ])

    const list = document.node('#bleDeviceList')
    assert.equal(document.node('#bleDeviceDialog').open, true)
    assert.equal(list.children.length, 2)
    assert.match(list.children[0].textContent, /Neon Meter Left/)
    assert.match(list.children[0].textContent, /meter-left/)
    assert.match(list.children[0].textContent, /RSSI: -42 dBm/)
    assert.match(list.children[1].textContent, /RSSI unavailable/)

    list.children[1].click()

    assert.deepEqual(await choice, {
        id: 'meter-right',
        name: 'Neon Meter Right'
    })
    assert.equal(document.node('#bleDeviceDialog').open, false)
})

test('AppView rejects BLE device chooser cancellation', async () => {
    const document = createFakeDocument()
    const view = new AppView(document)

    const choice = view.chooseBleDevice([
        {
            id: 'meter-left',
            name: 'Neon Meter Left'
        }
    ])

    document.node('#bleDeviceCancelButton').click()

    await assert.rejects(choice, /BLE device selection cancelled/)
    assert.equal(document.node('#bleDeviceDialog').open, false)
})

test('AppView renders firmware status and binds installer actions', () => {
    const document = createFakeDocument()
    const view = new AppView(document)
    const calls = []

    view.bindFirmwareInstallPrepare(() => calls.push('prepare'))
    view.bindFirmwareRecheck(() => calls.push('recheck'))
    view.bindFirmwareInstallerClosed(() => calls.push('closed'))
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
            connected: true,
            connecting: false,
            deviceName: 'Neon Meter USB',
            supported: true
        },
        firmware: {
            connectedVersion: '1.0.0',
            latestVersion: '1.0.1',
            chipFamily: 'ESP32-S3',
            updateAvailable: true,
            installerReady: false,
            checking: false,
            status: 'Update available',
            error: ''
        },
        sync: {
            running: false,
            status: 'Ready',
            error: '',
            lastSync: ''
        },
        payload: null
    })

    assert.equal(
        document.node('#firmwareConnectedVersion').textContent,
        'v1.0.0'
    )
    assert.equal(document.node('#firmwareLatestVersion').textContent, 'v1.0.1')
    assert.equal(
        document.node('#firmwareStatus').textContent,
        'Update available'
    )
    assert.equal(document.node('#firmwareChipFamily').textContent, 'ESP32-S3')
    assert.equal(document.node('#firmwarePrepareButton').disabled, false)

    document.node('#firmwarePrepareButton').click()
    document.node('#firmwareRecheckButton').click()
    document.dispatchEvent({
        type: 'closed',
        target: document.createElement('ewt-install-dialog')
    })

    assert.deepEqual(calls, ['prepare', 'recheck', 'closed'])
})

test('AppView disables installer preparation while firmware status checks', () => {
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
            connecting: false,
            deviceName: '',
            supported: true
        },
        firmware: {
            connectedVersion: '',
            latestVersion: '',
            chipFamily: '',
            updateAvailable: false,
            installerReady: false,
            checking: true,
            status: 'Checking firmware release',
            error: ''
        },
        sync: {
            running: false,
            status: 'Ready',
            error: '',
            lastSync: ''
        },
        payload: null
    })

    assert.equal(document.node('#firmwarePrepareButton').disabled, true)
    assert.equal(
        document.node('#firmwareStatus').textContent,
        'Checking firmware release'
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
        '#syncButton',
        '#firmwareConnectedVersion',
        '#firmwareLatestVersion',
        '#firmwareStatus',
        '#firmwareChipFamily',
        '#firmwareError',
        '#firmwarePrepareButton',
        '#firmwareRecheckButton',
        '#bleDeviceDialog',
        '#bleDeviceList',
        '#bleDeviceCancelButton'
    ])
}

/**
 * Minimal querySelector-backed document for render-only AppView tests.
 */
class FakeDocument {
    #nodes
    #listeners = new Map()

    /**
     * @param {string[]} selectors
     */
    constructor(selectors) {
        this.#nodes = new Map(
            selectors.map((selector) => [
                selector,
                new FakeElement({ document: this })
            ])
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

    /**
     * Creates a fake DOM element.
     * @param {string} tagName
     * @returns {FakeElement}
     */
    createElement(tagName) {
        return new FakeElement({ document: this, tagName })
    }

    addEventListener(type, callback) {
        const listeners = this.#listeners.get(type) || []
        listeners.push(callback)
        this.#listeners.set(type, listeners)
    }

    dispatchEvent(event) {
        for (const callback of this.#listeners.get(event.type) || []) {
            callback(event)
        }
    }
}

/**
 * Minimal mutable element state used by AppView render.
 */
class FakeElement {
    #listeners = new Map()
    #document

    textContent = ''
    value = ''
    checked = false
    disabled = false
    hidden = true
    open = false
    children = []
    className = ''
    type = ''

    constructor(options = {}) {
        this.#document = options.document
        this.tagName = String(options.tagName || '').toUpperCase()
        this.localName = String(options.tagName || '').toLowerCase()
    }

    append(...children) {
        this.children.push(...children)
        this.textContent = this.children
            .map((child) => child.textContent)
            .join(' ')
    }

    replaceChildren(...children) {
        this.children = children
        this.textContent = this.children
            .map((child) => child.textContent)
            .join(' ')
    }

    addEventListener(type, callback) {
        const listeners = this.#listeners.get(type) || []
        listeners.push(callback)
        this.#listeners.set(type, listeners)
    }

    removeEventListener(type, callback) {
        const listeners = this.#listeners.get(type) || []
        this.#listeners.set(
            type,
            listeners.filter((listener) => listener !== callback)
        )
    }

    click() {
        for (const callback of this.#listeners.get('click') || []) {
            callback({ preventDefault() {} })
        }
    }

    showModal() {
        this.open = true
    }

    close() {
        this.open = false
    }

    setAttribute(name, value) {
        this[name] = value
    }

    getAttribute(name) {
        return this[name]
    }

    removeAttribute(name) {
        if (name === 'open') this.open = false
        else delete this[name]
    }
}
