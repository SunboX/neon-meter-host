import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const SERVICE_UUID = normalizeUuid('41494d45-7465-7220-0000-000000000001')
const RX_CHAR_UUID = normalizeUuid('41494d45-7465-7220-0000-000000000002')
const TX_CHAR_UUID = normalizeUuid('41494d45-7465-7220-0000-000000000003')
const REFRESH_CHAR_UUID = normalizeUuid('41494d45-7465-7220-0000-000000000004')
const METADATA_CHAR_UUID = normalizeUuid('41494d45-7465-7220-0000-000000000005')
const DEVICE_NAME_PREFIXES = ['Neon Meter', 'AI Meter']

/** Error raised when the operating system leaves a BLE connection pending. */
export class BleConnectionTimeoutError extends Error {
    /**
     * @param {object} peripheral
     */
    constructor(peripheral) {
        super('Neon Meter BLE connection timed out')
        this.name = 'BleConnectionTimeoutError'
        this.code = 'BLE_CONNECTION_TIMEOUT'
        this.deviceId = String(peripheral?.id || peripheral?.address || '')
        this.deviceName = peripheralName(peripheral)
    }
}

/**
 * Main-process BLE client backed by native Noble bindings.
 */
export class NativeNobleAiMeterClient extends EventTarget {
    #noble
    #loadError = null
    #timers
    #scanTimeoutMs
    #connectTimeoutMs
    #discoveryAttempts
    #discoveryRetryDelayMs
    #peripheral = null
    #rx = null
    #tx = null
    #refresh = null
    #peripheralDisconnectHandler = null
    #txDataHandler = null
    #refreshDataHandler = null

    /**
     * @param {{ noble?: object, timers?: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'>, scanTimeoutMs?: number, connectTimeoutMs?: number, discoveryAttempts?: number, discoveryRetryDelayMs?: number }} [options]
     */
    constructor(options = {}) {
        super()
        const loaded = options.noble
            ? { noble: options.noble, error: null }
            : loadNoble()
        this.#noble = loaded.noble
        this.#loadError = loaded.error
        const timers = options.timers || {}
        this.#timers = {
            setTimeout: timers.setTimeout
                ? timers.setTimeout.bind(timers)
                : globalThis.setTimeout.bind(globalThis),
            clearTimeout: timers.clearTimeout
                ? timers.clearTimeout.bind(timers)
                : globalThis.clearTimeout.bind(globalThis)
        }
        this.#scanTimeoutMs = Number(options.scanTimeoutMs) || 10000
        const connectTimeoutMs = Number(options.connectTimeoutMs ?? 15000)
        this.#connectTimeoutMs =
            Number.isFinite(connectTimeoutMs) && connectTimeoutMs > 0
                ? connectTimeoutMs
                : 15000
        const discoveryAttempts = Number(options.discoveryAttempts ?? 4)
        this.#discoveryAttempts =
            Number.isFinite(discoveryAttempts) && discoveryAttempts > 0
                ? Math.floor(discoveryAttempts)
                : 4
        const discoveryRetryDelayMs = Number(
            options.discoveryRetryDelayMs ?? 250
        )
        this.#discoveryRetryDelayMs =
            Number.isFinite(discoveryRetryDelayMs) && discoveryRetryDelayMs >= 0
                ? discoveryRetryDelayMs
                : 250
    }

    /**
     * Returns whether native BLE bindings loaded.
     * @returns {boolean}
     */
    isSupported() {
        return Boolean(this.#noble)
    }

    /**
     * Scans for and connects to a Neon Meter device.
     * @returns {Promise<{ id: string, name: string, connected: boolean } | { connected: false, selectionRequired: true, devices: Array<{ id: string, name: string, rssi?: number }> }>}
     */
    async connect() {
        const peripherals = await this.#findAiMeterPeripherals()
        if (peripherals.length === 0) {
            throw new Error('No Neon Meter BLE device found')
        }
        if (peripherals.length === 1) {
            return this.#connectPeripheral(peripherals[0])
        }
        return {
            connected: false,
            selectionRequired: true,
            devices: peripherals.map(peripheralCandidate)
        }
    }

    /**
     * Scans for and connects to a selected Neon Meter device.
     * @param {{ id?: string, name?: string }} selectedDevice
     * @returns {Promise<{ id: string, name: string, connected: boolean, firmwareVersion?: string, chipFamily?: string }>}
     */
    async connectSelected(selectedDevice = {}) {
        const peripheral = await this.#findSelectedPeripheral(selectedDevice)
        if (!peripheral) {
            throw new Error('Selected Neon Meter BLE device not found')
        }
        return this.#connectPeripheral(peripheral)
    }

    /**
     * Scans for and connects to a remembered Neon Meter device.
     * @param {{ id?: string, name?: string }} rememberedDevice
     * @returns {Promise<{ id: string, name: string, connected: boolean } | null>}
     */
    async connectRemembered(rememberedDevice = {}) {
        const peripheral =
            await this.#findRememberedPeripheral(rememberedDevice)
        return peripheral ? this.#connectPeripheral(peripheral) : null
    }

    /**
     * Disconnects the current native BLE peripheral.
     * @returns {void}
     */
    disconnect() {
        const peripheral = this.#peripheral
        this.#handleDisconnect()
        if (typeof peripheral?.disconnectAsync === 'function') {
            void peripheral.disconnectAsync().catch(() => {})
        }
    }

    /**
     * Writes a firmware payload to the RX characteristic.
     * @param {object} payload
     * @returns {Promise<void>}
     */
    async writePayload(payload) {
        if (!this.#rx) throw new Error('Neon Meter is not connected')
        await this.#rx.writeAsync(
            Buffer.from(JSON.stringify(payload), 'utf8'),
            false
        )
    }

    /**
     * Finds a matching peripheral through a bounded scan.
     * @param {{ id?: string, name?: string }} rememberedDevice
     * @returns {Promise<object | null>}
     */
    async #findPeripheral(rememberedDevice) {
        const peripherals = await this.#scanPeripherals({
            matches: (peripheral) =>
                matchesPeripheral(peripheral, rememberedDevice),
            stopOnFirst: true
        })
        return peripherals[0] || null
    }

    /**
     * Finds a remembered peripheral without selecting the wrong visible meter.
     * @param {{ id?: string, name?: string }} rememberedDevice
     * @returns {Promise<object | null>}
     */
    async #findRememberedPeripheral(rememberedDevice) {
        const rememberedId = String(rememberedDevice?.id || '')
        const rememberedName = String(rememberedDevice?.name || '')
        if (!rememberedId && !rememberedName) return this.#findPeripheral({})

        const remembered = {
            id: rememberedId,
            name: rememberedName
        }
        const peripherals = await this.#scanPeripherals({
            matches: isAiMeterPeripheral,
            stopWhen: (peripheral) =>
                matchesSelectedPeripheral(peripheral, remembered)
        })
        const exactPeripheral = peripherals.find((peripheral) =>
            matchesSelectedPeripheral(peripheral, remembered)
        )
        if (exactPeripheral) return exactPeripheral

        return peripherals.length === 1 ? peripherals[0] : null
    }

    /**
     * Finds all visible Neon Meter peripherals through a bounded scan.
     * @returns {Promise<object[]>}
     */
    async #findAiMeterPeripherals() {
        return this.#scanPeripherals({
            matches: isAiMeterPeripheral,
            stopOnFirst: false
        })
    }

    /**
     * Finds a selected peripheral through a bounded scan.
     * @param {{ id?: string, name?: string }} selectedDevice
     * @returns {Promise<object | null>}
     */
    async #findSelectedPeripheral(selectedDevice) {
        const selectedId = String(selectedDevice?.id || '')
        const selectedName = String(selectedDevice?.name || '')
        if (!selectedId && !selectedName) return null
        const peripherals = await this.#scanPeripherals({
            matches: (peripheral) =>
                matchesSelectedPeripheral(peripheral, {
                    id: selectedId,
                    name: selectedName
                }),
            stopOnFirst: true
        })
        return peripherals[0] || null
    }

    /**
     * Scans native BLE peripherals.
     * @param {{ matches: (peripheral: object) => boolean, stopOnFirst?: boolean, stopWhen?: (peripheral: object, peripherals: object[]) => boolean }} options
     * @returns {Promise<object[]>}
     */
    async #scanPeripherals(options) {
        if (!this.#noble) {
            throw new Error(
                'Native BLE is not available' +
                    (this.#loadError ? ': ' + this.#loadError.message : '')
            )
        }

        await this.#noble.waitForPoweredOnAsync(10000)

        const peripherals = []
        const knownPeripheralIds = new Set()
        let timeoutId = null
        let settled = false
        let scanning = false

        return new Promise((resolve, reject) => {
            const cleanup = async (error = null) => {
                if (settled) return
                settled = true
                if (timeoutId) this.#timers.clearTimeout(timeoutId)
                this.#noble.removeListener?.('discover', onDiscover)
                try {
                    if (scanning) await this.#noble.stopScanningAsync()
                } catch (_error) {
                    // Stopping an already-stopped scan is harmless.
                }
                if (error) {
                    reject(error)
                    return
                }
                resolve(peripherals)
            }

            const onDiscover = (peripheral) => {
                if (!options.matches(peripheral)) return
                const knownId = peripheralKnownId(peripheral)
                if (knownId && knownPeripheralIds.has(knownId)) return
                if (knownId) knownPeripheralIds.add(knownId)
                peripherals.push(peripheral)
                if (
                    options.stopOnFirst ||
                    options.stopWhen?.(peripheral, peripherals)
                ) {
                    void cleanup()
                }
            }

            timeoutId = this.#timers.setTimeout(() => {
                void cleanup()
            }, this.#scanTimeoutMs)

            this.#noble.on('discover', onDiscover)
            scanning = true
            this.#noble.startScanningAsync([], false).catch((error) => {
                void cleanup(error)
            })
        })
    }

    /**
     * Opens GATT characteristics for a native peripheral.
     * @param {object} peripheral
     * @returns {Promise<{ id: string, name: string, connected: boolean }>}
     */
    async #connectPeripheral(peripheral) {
        this.#clearHandles()
        this.#peripheral = peripheral
        this.#peripheralDisconnectHandler = () => this.#handleDisconnect()
        peripheral.on?.('disconnect', this.#peripheralDisconnectHandler)

        let connectTimeoutId = null
        try {
            await Promise.race([
                peripheral.connectAsync(),
                new Promise((_resolve, reject) => {
                    connectTimeoutId = this.#timers.setTimeout(() => {
                        reject(new BleConnectionTimeoutError(peripheral))
                    }, this.#connectTimeoutMs)
                })
            ])
        } catch (error) {
            this.#clearHandles()
            if (
                error?.code === 'BLE_CONNECTION_TIMEOUT' &&
                typeof peripheral?.disconnectAsync === 'function'
            ) {
                await peripheral.disconnectAsync().catch(() => {})
            }
            throw error
        } finally {
            if (connectTimeoutId !== null) {
                this.#timers.clearTimeout(connectTimeoutId)
            }
        }
        const handles = await this.#discoverAiMeterHandles(peripheral)

        this.#rx = handles.rx
        this.#tx = handles.tx
        this.#refresh = handles.refresh

        if (!this.#rx || !this.#tx || !this.#refresh) {
            this.disconnect()
            const missing = missingAiMeterCharacteristicNames(handles)
            throw new Error(
                'Neon Meter BLE service is incomplete' +
                    (missing.length ? ': missing ' + missing.join(', ') : '')
            )
        }

        this.#txDataHandler = (data) => this.#emitJson('ack', data)
        this.#refreshDataHandler = () => {
            this.dispatchEvent(new CustomEvent('refresh-requested'))
        }
        await this.#tx.subscribeAsync()
        this.#tx.on?.('data', this.#txDataHandler)
        await this.#refresh.subscribeAsync()
        this.#refresh.on?.('data', this.#refreshDataHandler)
        const metadata = await readMetadataCharacteristic(handles.metadata)

        return {
            id: String(peripheral.id || peripheral.address || ''),
            name: peripheralName(peripheral),
            connected: true,
            ...metadata
        }
    }

    /**
     * Discovers all required Neon Meter characteristics while the link is up.
     * @param {object} peripheral
     * @returns {Promise<{ rx: object | null, tx: object | null, refresh: object | null, metadata: object | null }>}
     */
    async #discoverAiMeterHandles(peripheral) {
        // Some native Noble bindings can miss custom 128-bit services when
        // discovery is filtered. The first pass keeps discovery tight; retries
        // are fully unfiltered and tolerate slow GATT table availability.
        let handles = findAiMeterCharacteristics([])
        let lastError = null
        for (let attempt = 0; attempt < this.#discoveryAttempts; attempt += 1) {
            const metadataAwareCharacteristicUuids =
                attempt === 0
                    ? [
                          RX_CHAR_UUID,
                          TX_CHAR_UUID,
                          REFRESH_CHAR_UUID,
                          METADATA_CHAR_UUID
                      ]
                    : []
            try {
                const result =
                    await peripheral.discoverSomeServicesAndCharacteristicsAsync(
                        [],
                        metadataAwareCharacteristicUuids
                    )
                handles = findAiMeterCharacteristics(
                    result?.characteristics || []
                )
                if (handles.rx && handles.tx && handles.refresh) {
                    return handles
                }
            } catch (error) {
                lastError = error
            }

            if (attempt < this.#discoveryAttempts - 1) {
                await this.#delay(this.#discoveryRetryDelayMs)
            }
        }

        if (lastError && !handles.rx && !handles.tx && !handles.refresh) {
            throw lastError
        }
        return handles
    }

    /**
     * Waits before retrying native discovery.
     * @param {number} ms
     * @returns {Promise<void>}
     */
    async #delay(ms) {
        if (ms <= 0) return
        await new Promise((resolve) => {
            this.#timers.setTimeout(resolve, ms)
        })
    }

    /**
     * Emits parsed JSON notification details.
     * @param {string} eventName
     * @param {Buffer | Uint8Array | string} data
     * @returns {void}
     */
    #emitJson(eventName, data) {
        const text = Buffer.isBuffer(data)
            ? data.toString('utf8')
            : String(data || '')
        let detail = { raw: text }
        try {
            detail = { ...detail, json: JSON.parse(text) }
        } catch (_error) {
            // Raw firmware notifications are still useful when they are not JSON.
        }
        this.dispatchEvent(new CustomEvent(eventName, { detail }))
    }

    /**
     * Handles an unexpected or explicit disconnect.
     * @returns {void}
     */
    #handleDisconnect() {
        const wasConnected = Boolean(this.#peripheral || this.#rx)
        this.#clearHandles()
        if (wasConnected) {
            this.dispatchEvent(new CustomEvent('disconnected'))
        }
    }

    /**
     * Removes native object listeners and handles.
     * @returns {void}
     */
    #clearHandles() {
        if (this.#peripheral && this.#peripheralDisconnectHandler) {
            this.#peripheral.removeListener?.(
                'disconnect',
                this.#peripheralDisconnectHandler
            )
        }
        if (this.#tx && this.#txDataHandler) {
            this.#tx.removeListener?.('data', this.#txDataHandler)
        }
        if (this.#refresh && this.#refreshDataHandler) {
            this.#refresh.removeListener?.('data', this.#refreshDataHandler)
        }
        this.#peripheral = null
        this.#rx = null
        this.#tx = null
        this.#refresh = null
        this.#peripheralDisconnectHandler = null
        this.#txDataHandler = null
        this.#refreshDataHandler = null
    }
}

/**
 * Loads Noble without making tests import native bindings.
 * @returns {{ noble: object | null, error: Error | null }}
 */
function loadNoble() {
    try {
        const nobleModule = require('@stoprocent/noble')
        const bindingType = nobleBindingTypeForPlatform(
            process.platform,
            process.env
        )
        return {
            noble:
                typeof nobleModule.withBindings === 'function'
                    ? nobleModule.withBindings(bindingType)
                    : nobleModule,
            error: null
        }
    } catch (error) {
        return {
            noble: null,
            error: error instanceof Error ? error : new Error(String(error))
        }
    }
}

/**
 * Chooses the Noble binding to use for this platform.
 * @param {NodeJS.Platform | string} platform
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function nobleBindingTypeForPlatform(platform, env = process.env) {
    const requested = String(env.NOBLE_BINDINGS || '').toLowerCase()
    if (['dbus', 'hci', 'mac', 'win'].includes(requested)) return requested
    if (platform === 'darwin') return 'mac'
    if (platform === 'win32') return 'win'
    if (platform === 'linux' || platform === 'freebsd') return 'hci'
    return 'default'
}

/**
 * Checks whether a scanned peripheral is the requested Neon Meter device.
 * @param {object} peripheral
 * @param {{ id?: string, name?: string }} rememberedDevice
 * @returns {boolean}
 */
function matchesPeripheral(peripheral, rememberedDevice = {}) {
    const rememberedId = String(rememberedDevice.id || '')
    const rememberedName = String(rememberedDevice.name || '')
    const peripheralIds = [
        peripheral?.id,
        peripheral?.uuid,
        peripheral?.address
    ].map((value) => String(value || ''))
    const localName = advertisedName(peripheral)

    if (rememberedId && peripheralIds.includes(rememberedId)) return true
    if (rememberedName && localName === rememberedName) return true

    return isAiMeterPeripheral(peripheral)
}

/**
 * Checks whether a scanned peripheral matches an explicitly selected device.
 * @param {object} peripheral
 * @param {{ id?: string, name?: string }} selectedDevice
 * @returns {boolean}
 */
function matchesSelectedPeripheral(peripheral, selectedDevice = {}) {
    const selectedId = String(selectedDevice.id || '')
    const selectedName = String(selectedDevice.name || '')
    const peripheralIds = [
        peripheral?.id,
        peripheral?.uuid,
        peripheral?.address
    ].map((value) => String(value || ''))
    const localName = advertisedName(peripheral)

    if (selectedId && peripheralIds.includes(selectedId)) return true
    return Boolean(selectedName && localName === selectedName)
}

/**
 * Checks whether a peripheral advertises Neon Meter identity.
 * @param {object} peripheral
 * @returns {boolean}
 */
function isAiMeterPeripheral(peripheral) {
    const localName = advertisedName(peripheral)
    return (
        DEVICE_NAME_PREFIXES.some((prefix) => localName.startsWith(prefix)) ||
        advertisedServices(peripheral).includes(SERVICE_UUID)
    )
}

/**
 * Returns the advertised local name without display fallback.
 * @param {object} peripheral
 * @returns {string}
 */
function advertisedName(peripheral) {
    return String(peripheral?.advertisement?.localName || '')
}

/**
 * Returns a peripheral display name.
 * @param {object} peripheral
 * @returns {string}
 */
function peripheralName(peripheral) {
    return String(peripheral?.advertisement?.localName || 'Neon Meter')
}

/**
 * Returns a stable local peripheral identifier when Noble exposes one.
 * @param {object} peripheral
 * @returns {string}
 */
function peripheralKnownId(peripheral) {
    return String(
        peripheral?.id || peripheral?.uuid || peripheral?.address || ''
    )
}

/**
 * Returns non-secret metadata for display in the device chooser.
 * @param {object} peripheral
 * @returns {{ id: string, name: string, rssi?: number }}
 */
function peripheralCandidate(peripheral) {
    const candidate = {
        id: peripheralKnownId(peripheral),
        name: peripheralName(peripheral)
    }
    const rssi = Number(peripheral?.rssi ?? peripheral?.advertisement?.rssi)
    if (Number.isFinite(rssi)) {
        candidate.rssi = rssi
    }
    return candidate
}

/**
 * Returns normalized advertised service UUIDs.
 * @param {object} peripheral
 * @returns {string[]}
 */
function advertisedServices(peripheral) {
    return (peripheral?.advertisement?.serviceUuids || []).map(normalizeUuid)
}

/**
 * Finds all Neon Meter GATT characteristics.
 * @param {object[]} characteristics
 * @returns {{ rx: object | null, tx: object | null, refresh: object | null }}
 */
function findAiMeterCharacteristics(characteristics) {
    return {
        rx: findCharacteristic(characteristics, RX_CHAR_UUID),
        tx: findCharacteristic(characteristics, TX_CHAR_UUID),
        refresh: findCharacteristic(characteristics, REFRESH_CHAR_UUID),
        metadata: findCharacteristic(characteristics, METADATA_CHAR_UUID)
    }
}

/**
 * Returns missing Neon Meter characteristic labels.
 * @param {{ rx: object | null, tx: object | null, refresh: object | null }} handles
 * @returns {string[]}
 */
function missingAiMeterCharacteristicNames(handles) {
    return [
        ['RX', handles.rx],
        ['TX', handles.tx],
        ['Refresh', handles.refresh]
    ]
        .filter(([, handle]) => !handle)
        .map(([name]) => name)
}

/**
 * Finds one GATT characteristic by UUID.
 * @param {object[]} characteristics
 * @param {string} uuid
 * @returns {object | null}
 */
function findCharacteristic(characteristics, uuid) {
    return (
        characteristics.find(
            (characteristic) => normalizeUuid(characteristic?.uuid) === uuid
        ) || null
    )
}

/**
 * Reads optional BLE firmware metadata from newer Neon Meter firmware.
 * @param {{ readAsync?: () => Promise<Buffer | Uint8Array | string> } | null} characteristic
 * @returns {Promise<{ firmwareVersion?: string, chipFamily?: string }>}
 */
async function readMetadataCharacteristic(characteristic) {
    if (typeof characteristic?.readAsync !== 'function') return {}
    try {
        const value = await characteristic.readAsync()
        const text = Buffer.isBuffer(value)
            ? value.toString('utf8')
            : String(value || '')
        return normalizeDeviceMetadata(JSON.parse(text))
    } catch (_error) {
        return {}
    }
}

/**
 * Returns non-secret firmware metadata from a BLE metadata payload.
 * @param {unknown} source
 * @returns {{ firmwareVersion?: string, chipFamily?: string }}
 */
function normalizeDeviceMetadata(source) {
    const metadata = source && typeof source === 'object' ? source : {}
    const firmwareVersion = String(metadata.firmwareVersion || '').trim()
    const chipFamily = String(metadata.chipFamily || '').trim()
    return {
        ...(firmwareVersion ? { firmwareVersion } : {}),
        ...(chipFamily ? { chipFamily } : {})
    }
}

/**
 * Normalizes UUID strings for Noble.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeUuid(value) {
    return String(value || '')
        .toLowerCase()
        .replaceAll('-', '')
}
