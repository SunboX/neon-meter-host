export const AI_METER_NAME_PREFIX = 'AI Meter'
export const NEON_METER_NAME_PREFIX = 'Neon Meter'
export const DEFAULT_DEVICE_NAME_PREFIXES = [
    NEON_METER_NAME_PREFIX,
    AI_METER_NAME_PREFIX
]
export const DEFAULT_SCAN_TIMEOUT_MS = 15000

/**
 * Creates a Web Bluetooth device selector for Electron's scan callback flow.
 * Electron can emit the selector event before any devices have been found, so
 * empty scans must wait briefly instead of cancelling the chooser immediately.
 * @param {{ deviceNamePrefix?: string, deviceNamePrefixes?: string[], timeoutMs?: number, timers?: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'> }} options
 * @returns {(event: { preventDefault: () => void }, deviceList: Array<{ deviceName?: string, deviceId?: string }>, callback: (deviceId: string) => void) => void}
 */
export function createBluetoothDeviceSelector(options = {}) {
    const deviceNamePrefixes = deviceNamePrefixesFromOptions(options)
    const timeoutMs = Number.isFinite(options.timeoutMs)
        ? options.timeoutMs
        : DEFAULT_SCAN_TIMEOUT_MS
    const timers = options.timers || globalThis
    let pendingCallback = null
    let timeoutHandle = null

    return function selectBluetoothDevice(event, deviceList, callback) {
        event.preventDefault()

        const device = findDevice(deviceList, deviceNamePrefixes)
        if (device?.deviceId) {
            clearPending()
            callback(device.deviceId)
            return
        }

        pendingCallback = callback
        if (!timeoutHandle) {
            timeoutHandle = timers.setTimeout(cancelPending, timeoutMs)
        }
    }

    function cancelPending() {
        const callback = pendingCallback
        clearPending()
        if (callback) callback('')
    }

    function clearPending() {
        if (timeoutHandle) {
            timers.clearTimeout(timeoutHandle)
        }
        pendingCallback = null
        timeoutHandle = null
    }
}

/**
 * Chooses a Neon Meter device if visible, otherwise falls back to the first
 * visible BLE device so alternate firmware names can still be tested.
 * @param {Array<{ deviceName?: string, deviceId?: string }>} deviceList
 * @param {string[]} deviceNamePrefixes
 * @returns {{ deviceName?: string, deviceId?: string } | undefined}
 */
function findDevice(deviceList, deviceNamePrefixes) {
    const devices = Array.isArray(deviceList) ? deviceList : []
    return (
        devices.find((item) => matchesDeviceName(item, deviceNamePrefixes)) ||
        devices[0]
    )
}

/**
 * Returns selector name prefixes from options.
 * @param {{ deviceNamePrefix?: string, deviceNamePrefixes?: string[] }} options
 * @returns {string[]}
 */
function deviceNamePrefixesFromOptions(options) {
    if (Array.isArray(options.deviceNamePrefixes)) {
        return options.deviceNamePrefixes.map(String).filter(Boolean)
    }
    if (options.deviceNamePrefix) return [String(options.deviceNamePrefix)]
    return DEFAULT_DEVICE_NAME_PREFIXES
}

/**
 * Checks whether a visible BLE device has a known app prefix.
 * @param {{ deviceName?: string }} device
 * @param {string[]} deviceNamePrefixes
 * @returns {boolean}
 */
function matchesDeviceName(device, deviceNamePrefixes) {
    const deviceName = String(device.deviceName || '')
    return deviceNamePrefixes.some((prefix) => deviceName.startsWith(prefix))
}
