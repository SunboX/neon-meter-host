/**
 * USB-first device client that falls back to BLE when no USB meter answers.
 */
export class PreferredAiMeterClient extends EventTarget {
    #usbClient
    #bleClient
    #activeClient = null
    #disconnectingClient = null

    /**
     * @param {{ usbClient: EventTarget & { isSupported: () => boolean, connect: () => Promise<object>, disconnect: () => void | Promise<void>, writePayload: (payload: object) => Promise<void> }, bleClient: EventTarget & { isSupported: () => boolean, connect: () => Promise<object>, connectSelected?: (device: object) => Promise<object>, connectRemembered?: (device: object) => Promise<object | null>, disconnect: () => void | Promise<void>, writePayload: (payload: object) => Promise<void> } }} dependencies
     */
    constructor(dependencies) {
        super()
        this.#usbClient = dependencies.usbClient
        this.#bleClient = dependencies.bleClient
        this.#forwardClientEvents(this.#usbClient)
        this.#forwardClientEvents(this.#bleClient)
    }

    /**
     * Returns whether at least one native transport is available.
     * @returns {boolean}
     */
    isSupported() {
        return this.#usbClient.isSupported() || this.#bleClient.isSupported()
    }

    /**
     * Returns true because USB can be discovered without remembered BLE data.
     * @returns {boolean}
     */
    canConnectWithoutRemembered() {
        return this.#usbClient.isSupported()
    }

    /**
     * Connects USB first, then falls back to a normal BLE scan.
     * @returns {Promise<object>}
     */
    async connect() {
        const usbDevice = await this.#tryUsbConnect()
        if (usbDevice) return usbDevice
        const bleDevice = await this.#bleClient.connect()
        if (bleDevice?.selectionRequired) {
            return withTransport(bleDevice, 'ble')
        }
        this.#activeClient = this.#bleClient
        return withTransport(bleDevice, 'ble')
    }

    /**
     * Connects to a selected BLE device after manual selection.
     * @param {{ id?: string, name?: string }} device
     * @returns {Promise<object>}
     */
    async connectSelected(device) {
        if (typeof this.#bleClient.connectSelected !== 'function') {
            throw new Error('BLE device selection is not supported')
        }
        const bleDevice = await this.#bleClient.connectSelected(device)
        this.#activeClient = this.#bleClient
        return withTransport(bleDevice, 'ble')
    }

    /**
     * Connects USB first, then falls back to a remembered BLE device.
     * @param {{ id?: string, name?: string }} rememberedDevice
     * @returns {Promise<object | null>}
     */
    async connectRemembered(rememberedDevice = {}) {
        const usbDevice = await this.#tryUsbConnect()
        if (usbDevice) return usbDevice
        if (!rememberedDevice.id && !rememberedDevice.name) return null
        if (typeof this.#bleClient.connectRemembered !== 'function') return null
        const bleDevice =
            await this.#bleClient.connectRemembered(rememberedDevice)
        if (!bleDevice) return null
        this.#activeClient = this.#bleClient
        return withTransport(bleDevice, 'ble')
    }

    /**
     * Disconnects the active transport.
     * @returns {Promise<void>}
     */
    disconnect() {
        const activeClient = this.#activeClient
        if (!activeClient) return Promise.resolve()
        this.#disconnectingClient = activeClient
        this.#activeClient = null
        return Promise.resolve(activeClient.disconnect()).finally(() => {
            if (this.#disconnectingClient === activeClient) {
                this.#disconnectingClient = null
            }
        })
    }

    /**
     * Writes a provider bundle to the active transport.
     * @param {object} payload
     * @returns {Promise<void>}
     */
    async writePayload(payload) {
        if (!this.#activeClient) {
            throw new Error('Neon Meter is not connected')
        }
        await this.#activeClient.writePayload(payload)
    }

    /**
     * Attempts a USB connection without surfacing absence as an error.
     * @returns {Promise<object | null>}
     */
    async #tryUsbConnect() {
        if (!this.#usbClient.isSupported()) return null
        try {
            const device = await this.#usbClient.connect()
            const previousClient = this.#activeClient
            this.#activeClient = this.#usbClient
            if (previousClient && previousClient !== this.#usbClient) {
                previousClient.disconnect()
            }
            return withTransport(device, 'usb')
        } catch (_error) {
            return null
        }
    }

    /**
     * Re-emits events from the active underlying transport.
     * @param {EventTarget} client
     * @returns {void}
     */
    #forwardClientEvents(client) {
        for (const eventName of ['ack', 'refresh-requested', 'disconnected']) {
            client.addEventListener(eventName, (event) => {
                const isActive = client === this.#activeClient
                const isDisconnecting = client === this.#disconnectingClient
                if (!isActive && !isDisconnecting) return
                if (eventName === 'disconnected') {
                    if (isActive) this.#activeClient = null
                    if (isDisconnecting) this.#disconnectingClient = null
                }
                this.dispatchEvent(
                    new CustomEvent(eventName, {
                        detail: event.detail ?? null
                    })
                )
            })
        }
    }
}

/**
 * Adds a transport label without changing existing device metadata.
 * @param {object} device
 * @param {string} transport
 * @returns {object}
 */
function withTransport(device, transport) {
    return {
        ...(device || {}),
        transport
    }
}
