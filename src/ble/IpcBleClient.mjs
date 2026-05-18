/**
 * Renderer-side client that delegates to Electron main-process device transport.
 */
export class IpcBleClient extends EventTarget {
    #bridge
    #unsubscribe = null

    /**
     * @param {{ bridge: object }} options
     */
    constructor(options) {
        super()
        this.#bridge = options.bridge
        if (typeof this.#bridge.onBleEvent === 'function') {
            this.#unsubscribe = this.#bridge.onBleEvent((event) =>
                this.#emitBridgeEvent(event)
            )
        }
    }

    /**
     * Returns whether a native device transport is available in the main process.
     * @returns {boolean}
     */
    isSupported() {
        return Boolean(this.#bridge.isBleSupported?.())
    }

    /**
     * Returns whether native USB can auto-connect without BLE metadata.
     * @returns {boolean}
     */
    canConnectWithoutRemembered() {
        return Boolean(this.#bridge.canConnectWithoutRemembered?.())
    }

    /**
     * Connects to a visible Neon Meter device.
     * @param {{ selectDevice?: (devices: Array<{ id: string, name: string, rssi?: number }>) => Promise<object | string | null> | object | string | null }} [options]
     * @returns {Promise<{ id?: string, name: string, connected: boolean }>}
     */
    async connect(options = {}) {
        const device = await this.#bridge.bleConnect()
        if (!device?.selectionRequired) return device
        if (typeof options.selectDevice !== 'function') {
            throw new Error('BLE device selection is required')
        }

        const selected = await options.selectDevice(device.devices || [])
        const selectedDevice = normalizeSelectedDevice(selected)
        if (!selectedDevice) {
            throw new Error('BLE device selection cancelled')
        }
        return this.#bridge.bleConnectSelected(selectedDevice)
    }

    /**
     * Connects to a remembered Neon Meter device without a renderer gesture.
     * @param {{ id?: string, name?: string }} device
     * @returns {Promise<{ id?: string, name: string, connected: boolean } | null>}
     */
    connectRemembered(device) {
        return this.#bridge.bleConnectRemembered(device)
    }

    /**
     * Disconnects the native device transport.
     * @returns {void}
     */
    disconnect() {
        void this.#bridge.bleDisconnect()
    }

    /**
     * Writes a firmware payload over the native device transport.
     * @param {object} payload
     * @returns {Promise<void>}
     */
    writePayload(payload) {
        return this.#bridge.bleWritePayload(payload)
    }

    /**
     * Stops receiving forwarded native device events.
     * @returns {void}
     */
    destroy() {
        this.#unsubscribe?.()
        this.#unsubscribe = null
    }

    /**
     * Re-emits an IPC event payload as a DOM event.
     * @param {{ type?: string, detail?: unknown }} event
     * @returns {void}
     */
    #emitBridgeEvent(event) {
        const type = String(event?.type || '')
        if (!type) return
        this.dispatchEvent(
            new CustomEvent(type, {
                detail: event.detail ?? null
            })
        )
    }
}

/**
 * Returns selected BLE device metadata.
 * @param {unknown} selected
 * @returns {{ id?: string, name?: string } | null}
 */
function normalizeSelectedDevice(selected) {
    if (typeof selected === 'string') {
        return selected ? { id: selected } : null
    }
    if (!selected || typeof selected !== 'object') return null
    const id = String(selected.id || '')
    const name = String(selected.name || '')
    if (!id && !name) return null
    return {
        ...(id ? { id } : {}),
        ...(name ? { name } : {})
    }
}
