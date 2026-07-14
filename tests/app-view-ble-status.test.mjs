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

test('AppView shows BLE repair guidance only when pairing repair is required', () => {
    const document = createFakeDocument()
    const view = new AppView(document)
    const calls = []
    const snapshot = {
        provider: 'auto',
        locale: 'en',
        settings: {
            autoSync: false,
            autoConnectBle: true,
            startAtLogin: false,
            startHidden: false,
            syncIntervalMinutes: 5,
            rotationSeconds: 30,
            rememberedBleDeviceName: 'Neon Meter'
        },
        ble: {
            connected: false,
            connecting: false,
            deviceName: '',
            supported: true,
            repairRequired: true,
            repairing: false
        },
        sync: {
            running: false,
            status: 'Bluetooth pairing repair required',
            error: '',
            lastSync: ''
        },
        payload: null
    }

    view.bindOpenBluetoothSettings(() => calls.push('open-settings'))
    view.render(snapshot)

    assert.equal(document.node('#bleRepairPanel').hidden, false)
    assert.match(document.node('#bleRepairMessage').textContent, /connect USB/i)
    assert.match(
        document.node('#bleRepairMessage').textContent,
        /forget the old Neon Meter entry/i
    )
    document.node('#openBluetoothSettingsButton').click()
    assert.deepEqual(calls, ['open-settings'])

    view.render({
        ...snapshot,
        ble: { ...snapshot.ble, repairRequired: false }
    })
    assert.equal(document.node('#bleRepairPanel').hidden, true)
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

test('AppView renders safe firmware progress and binds ordinary actions', () => {
    const document = createFakeDocument()
    const view = new AppView(document)
    const calls = []

    view.bindFirmwareInstall(() => calls.push('safe-install'))
    view.bindFirmwareRecheck(() => calls.push('recheck'))
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
            checking: false,
            installing: true,
            installProgress: 42,
            installMode: 'safe',
            status: 'Writing progress: 42%',
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
        'Writing progress: 42%'
    )
    assert.equal(document.node('#firmwareChipFamily').textContent, 'ESP32-S3')
    assert.equal(document.node('#firmwareInstallProgressPanel').hidden, false)
    assert.equal(document.node('#firmwareInstallProgress').value, '42')
    assert.equal(
        document.node('#firmwareInstallProgressText').textContent,
        '42%'
    )
    assert.equal(document.node('#firmwareInstallButton').disabled, true)
    assert.equal(document.node('#firmwareFactoryButton').disabled, true)

    view.render({
        ...firmwareSnapshot(),
        firmware: {
            ...firmwareSnapshot().firmware,
            installing: false,
            installProgress: 100
        }
    })
    document.node('#firmwareInstallButton').click()
    document.node('#firmwareRecheckButton').click()

    assert.deepEqual(calls, ['safe-install', 'recheck'])
})

test('AppView confirms that factory reinstall erases pairing data', async () => {
    const document = createFakeDocument()
    const view = new AppView(document)
    const calls = []

    view.bindFirmwareFactoryInstall(() => calls.push('factory-install'))
    view.render(firmwareSnapshot())
    document.node('#firmwareFactoryButton').click()

    assert.equal(document.node('#firmwareFactoryDialog').open, true)
    assert.deepEqual(calls, [])
    document.node('#firmwareFactoryConfirmButton').click()
    await flushMicrotasks()
    assert.equal(document.node('#firmwareFactoryDialog').open, false)
    assert.deepEqual(calls, ['factory-install'])
})

test('AppView disables both installers while release metadata is checking', () => {
    const document = createFakeDocument()
    const view = new AppView(document)
    const snapshot = firmwareSnapshot()
    view.render({
        ...snapshot,
        firmware: {
            ...snapshot.firmware,
            checking: true,
            status: 'Checking firmware release'
        }
    })

    assert.equal(document.node('#firmwareInstallButton').disabled, true)
    assert.equal(document.node('#firmwareFactoryButton').disabled, true)
})

function firmwareSnapshot() {
    return {
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
            connectedVersion: '1.0.6',
            latestVersion: '1.0.7',
            chipFamily: 'ESP32-S3',
            updateAvailable: true,
            checking: false,
            installing: false,
            installProgress: 0,
            installMode: '',
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
    }
}

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
        '#bleRepairPanel',
        '#bleRepairMessage',
        '#openBluetoothSettingsButton',
        '#firmwareConnectedVersion',
        '#firmwareLatestVersion',
        '#firmwareStatus',
        '#firmwareChipFamily',
        '#firmwareError',
        '#firmwareRecheckButton',
        '#firmwareInstallButton',
        '#firmwareFactoryButton',
        '#firmwareInstallProgressPanel',
        '#firmwareInstallProgress',
        '#firmwareInstallProgressText',
        '#firmwareFactoryDialog',
        '#firmwareFactoryConfirmButton',
        '#firmwareFactoryCancelButton',
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
    defaultClicks = 0

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
        let defaultPrevented = false
        let stopped = false
        const event = {
            preventDefault() {
                defaultPrevented = true
            },
            stopPropagation() {},
            stopImmediatePropagation() {
                stopped = true
            }
        }
        for (const callback of this.#listeners.get('click') || []) {
            callback(event)
            if (stopped) break
        }
        if (!defaultPrevented) this.defaultClicks += 1
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

async function flushMicrotasks() {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
}
