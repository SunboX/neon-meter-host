const SERVICE_UUID = '41494d45-7465-7220-0000-000000000001'
const RX_CHAR_UUID = '41494d45-7465-7220-0000-000000000002'
const TX_CHAR_UUID = '41494d45-7465-7220-0000-000000000003'
const REFRESH_CHAR_UUID = '41494d45-7465-7220-0000-000000000004'
const DEVICE_NAME_PREFIXES = ['Neon Meter', 'AI Meter']

/**
 * Web Bluetooth client for the Neon Meter CoreS3 firmware.
 */
export class WebBluetoothAiMeterClient extends EventTarget {
    #bluetooth

    /** @type {BluetoothDevice | null} */
    #device = null

    /** @type {BluetoothRemoteGATTCharacteristic | null} */
    #rx = null

    /** @type {BluetoothRemoteGATTCharacteristic | null} */
    #tx = null

    /** @type {BluetoothRemoteGATTCharacteristic | null} */
    #refresh = null

    /**
     * @param {{ bluetooth?: Bluetooth }} [options]
     */
    constructor(options = {}) {
        super()
        this.#bluetooth = options.bluetooth || globalThis.navigator?.bluetooth
    }

    /**
     * Returns whether Web Bluetooth is available.
     * @returns {boolean}
     */
    isSupported() {
        return Boolean(this.#bluetooth)
    }

    /**
     * Prompts for and connects to a Neon Meter device.
     * @returns {Promise<{ name: string, connected: boolean }>}
     */
    async connect() {
        if (!this.isSupported()) {
            throw new Error(
                'Web Bluetooth is not available in this Electron runtime'
            )
        }

        const device = await this.#bluetooth.requestDevice({
            filters: DEVICE_NAME_PREFIXES.map((namePrefix) => ({
                namePrefix
            })),
            optionalServices: [SERVICE_UUID]
        })
        return this.#connectDevice(device)
    }

    /**
     * Connects to a previously granted BLE device without opening the chooser.
     * @param {{ id?: string, name?: string }} rememberedDevice
     * @returns {Promise<{ id: string, name: string, connected: boolean } | null>}
     */
    async connectRemembered(rememberedDevice = {}) {
        if (!this.isSupported()) {
            throw new Error(
                'Web Bluetooth is not available in this Electron runtime'
            )
        }
        if (typeof this.#bluetooth.getDevices !== 'function') return null

        const devices = await this.#bluetooth.getDevices()
        const device = findRememberedDevice(devices, rememberedDevice)
        return device ? this.#connectDevice(device) : null
    }

    /**
     * Disconnects the current BLE device.
     * @returns {void}
     */
    disconnect() {
        if (this.#device?.gatt?.connected) {
            this.#device.gatt.disconnect()
        }
        this.#handleDisconnect()
    }

    /**
     * Writes a firmware payload to the RX characteristic.
     * @param {object} payload
     * @returns {Promise<void>}
     */
    async writePayload(payload) {
        if (!this.#rx) throw new Error('Neon Meter is not connected')
        const encoded = new TextEncoder().encode(JSON.stringify(payload))
        if ('writeValueWithResponse' in this.#rx) {
            await this.#rx.writeValueWithResponse(encoded)
            return
        }
        await this.#rx.writeValue(encoded)
    }

    /**
     * Emits parsed notification JSON.
     * @param {string} eventName
     * @param {Event} event
     * @returns {void}
     */
    #emitJson(eventName, event) {
        const value = /** @type {BluetoothRemoteGATTCharacteristic} */ (
            event.target
        ).value
        const text = value ? new TextDecoder().decode(value) : ''
        let detail = { raw: text }
        try {
            detail = { ...detail, json: JSON.parse(text) }
        } catch (_error) {
            // The firmware normally sends JSON acknowledgements, but raw text is still useful.
        }
        this.dispatchEvent(new CustomEvent(eventName, { detail }))
    }

    /**
     * Clears local handles after a disconnect.
     * @returns {void}
     */
    #handleDisconnect() {
        this.#rx = null
        this.#tx = null
        this.#refresh = null
        this.dispatchEvent(new CustomEvent('disconnected'))
    }

    /**
     * Opens GATT characteristics for a Bluetooth device.
     * @param {BluetoothDevice} device
     * @returns {Promise<{ id: string, name: string, connected: boolean }>}
     */
    async #connectDevice(device) {
        this.#device = device
        this.#device.addEventListener('gattserverdisconnected', () =>
            this.#handleDisconnect()
        )

        const server = await this.#device.gatt.connect()
        const service = await server.getPrimaryService(SERVICE_UUID)
        this.#rx = await service.getCharacteristic(RX_CHAR_UUID)
        this.#tx = await service.getCharacteristic(TX_CHAR_UUID)
        this.#refresh = await service.getCharacteristic(REFRESH_CHAR_UUID)

        await this.#tx.startNotifications()
        this.#tx.addEventListener('characteristicvaluechanged', (event) =>
            this.#emitJson('ack', event)
        )

        await this.#refresh.startNotifications()
        this.#refresh.addEventListener('characteristicvaluechanged', () => {
            this.dispatchEvent(new CustomEvent('refresh-requested'))
        })

        return {
            id: this.#device.id || '',
            name: this.#device.name || 'Neon Meter',
            connected: true
        }
    }
}

/**
 * Finds a remembered Web Bluetooth device from the browser grant list.
 * @param {BluetoothDevice[]} devices
 * @param {{ id?: string, name?: string }} rememberedDevice
 * @returns {BluetoothDevice | null}
 */
function findRememberedDevice(devices, rememberedDevice) {
    const id = String(rememberedDevice?.id || '')
    const name = String(rememberedDevice?.name || '')
    if (!id && !name) return null

    return (
        devices.find((device) => id && device.id === id) ||
        devices.find((device) => name && device.name === name) ||
        null
    )
}
