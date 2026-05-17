import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const SERVICE_UUID = normalizeUuid('41494d45-7465-7220-0000-000000000001')
const RX_CHAR_UUID = normalizeUuid('41494d45-7465-7220-0000-000000000002')
const TX_CHAR_UUID = normalizeUuid('41494d45-7465-7220-0000-000000000003')
const REFRESH_CHAR_UUID = normalizeUuid('41494d45-7465-7220-0000-000000000004')
const DEVICE_NAME_PREFIXES = ['Neon Meter', 'AI Meter']

/**
 * Main-process BLE client backed by native Noble bindings.
 */
export class NativeNobleAiMeterClient extends EventTarget {
    #noble
    #loadError = null
    #timers
    #scanTimeoutMs
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
     * @param {{ noble?: object, timers?: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'>, scanTimeoutMs?: number, discoveryAttempts?: number, discoveryRetryDelayMs?: number }} [options]
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
     * @returns {Promise<{ id: string, name: string, connected: boolean }>}
     */
    async connect() {
        const peripheral = await this.#findPeripheral({})
        if (!peripheral) throw new Error('No Neon Meter BLE device found')
        return this.#connectPeripheral(peripheral)
    }

    /**
     * Scans for and connects to a remembered Neon Meter device.
     * @param {{ id?: string, name?: string }} rememberedDevice
     * @returns {Promise<{ id: string, name: string, connected: boolean } | null>}
     */
    async connectRemembered(rememberedDevice = {}) {
        const peripheral = await this.#findPeripheral(rememberedDevice)
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
        if (!this.#noble) {
            throw new Error(
                'Native BLE is not available' +
                    (this.#loadError ? ': ' + this.#loadError.message : '')
            )
        }

        await this.#noble.waitForPoweredOnAsync(10000)

        let timeoutId = null
        let settled = false
        let scanning = false

        return new Promise((resolve, reject) => {
            const cleanup = async (result, error = null) => {
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
                resolve(result)
            }

            const onDiscover = (peripheral) => {
                if (matchesPeripheral(peripheral, rememberedDevice)) {
                    void cleanup(peripheral)
                }
            }

            timeoutId = this.#timers.setTimeout(() => {
                void cleanup(null)
            }, this.#scanTimeoutMs)

            this.#noble.on('discover', onDiscover)
            scanning = true
            this.#noble.startScanningAsync([], false).catch((error) => {
                void cleanup(null, error)
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

        await peripheral.connectAsync()
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

        return {
            id: String(peripheral.id || peripheral.address || ''),
            name: peripheralName(peripheral),
            connected: true
        }
    }

    /**
     * Discovers all required Neon Meter characteristics while the link is up.
     * @param {object} peripheral
     * @returns {Promise<{ rx: object | null, tx: object | null, refresh: object | null }>}
     */
    async #discoverAiMeterHandles(peripheral) {
        // Some native Noble bindings can miss custom 128-bit services when
        // discovery is filtered. The first pass keeps discovery tight; retries
        // are fully unfiltered and tolerate slow GATT table availability.
        let handles = findAiMeterCharacteristics([])
        let lastError = null
        for (let attempt = 0; attempt < this.#discoveryAttempts; attempt += 1) {
            const characteristicUuids =
                attempt === 0
                    ? [RX_CHAR_UUID, TX_CHAR_UUID, REFRESH_CHAR_UUID]
                    : []
            try {
                const result =
                    await peripheral.discoverSomeServicesAndCharacteristicsAsync(
                        [],
                        characteristicUuids
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
        refresh: findCharacteristic(characteristics, REFRESH_CHAR_UUID)
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
 * Normalizes UUID strings for Noble.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeUuid(value) {
    return String(value || '')
        .toLowerCase()
        .replaceAll('-', '')
}
