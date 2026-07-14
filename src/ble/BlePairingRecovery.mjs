/** Tracks repeated BLE timeouts and normalizes USB-assisted repair outcomes. */
export class BlePairingRecovery {
    #timeoutCounts = new Map()
    #lastManualSelectionKey = ''

    /**
     * Counts a timeout for its advertised or remembered device identity.
     * @param {unknown} error
     * @param {{ id?: string, name?: string }} rememberedDevice
     * @returns {number}
     */
    recordTimeout(error, rememberedDevice = {}) {
        const key = String(
            error?.deviceId ||
                rememberedDevice.id ||
                error?.deviceName ||
                rememberedDevice.name ||
                'neon-meter'
        )
        const attempts = (this.#timeoutCounts.get(key) || 0) + 1
        this.#timeoutCounts.set(key, attempts)
        return attempts
    }

    /**
     * Clears prior counts when the operator chooses a different device.
     * @param {unknown} selected
     * @returns {void}
     */
    noteManualSelection(selected) {
        const selectionKey = bleDeviceKey(selected)
        if (
            selectionKey &&
            this.#lastManualSelectionKey &&
            selectionKey !== this.#lastManualSelectionKey
        ) {
            this.#timeoutCounts.clear()
        }
        if (selectionKey) this.#lastManualSelectionKey = selectionKey
    }

    /**
     * Invokes optional USB-assisted repair and normalizes unavailable failures.
     * @param {{ repairBlePairing?: () => Promise<object> }} client
     * @returns {Promise<{ accepted: boolean, reason?: string }>}
     */
    async repair(client) {
        if (typeof client?.repairBlePairing !== 'function') {
            return { accepted: false, reason: 'usb-unavailable' }
        }
        try {
            return await client.repairBlePairing()
        } catch (_error) {
            return { accepted: false, reason: 'usb-unavailable' }
        }
    }

    /**
     * Returns targeted operator guidance for a failed automatic repair.
     * @param {string} reason
     * @returns {string}
     */
    fallbackMessage(reason) {
        return reason === 'unsupported'
            ? 'Connect Neon Meter by USB and update its firmware, or forget the old Neon Meter entry in macOS Bluetooth Settings.'
            : 'Connect Neon Meter by USB to repair automatically, or forget the old Neon Meter entry in macOS Bluetooth Settings.'
    }

    /** Clears all timeout and manual-selection tracking. */
    reset() {
        this.#timeoutCounts.clear()
        this.#lastManualSelectionKey = ''
    }
}

/**
 * Returns a stable key for a manually selected BLE device.
 * @param {unknown} selected
 * @returns {string}
 */
function bleDeviceKey(selected) {
    if (typeof selected === 'string') return selected
    if (!selected || typeof selected !== 'object') return ''
    return String(selected.id || selected.name || '')
}
