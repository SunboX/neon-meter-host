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
 * @param {{ deviceNamePrefix?: string, deviceNamePrefixes?: string[], timeoutMs?: number, timers?: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'>, chooseDevice?: (devices: Array<{ id: string, name: string, rssi?: number }>) => Promise<object | string | null> | object | string | null }} options
 * @returns {(event: { preventDefault: () => void }, deviceList: Array<{ deviceName?: string, deviceId?: string }>, callback: (deviceId: string) => void) => void}
 */
export function createBluetoothDeviceSelector(options = {}) {
    const deviceNamePrefixes = deviceNamePrefixesFromOptions(options)
    const timeoutMs = Number.isFinite(options.timeoutMs)
        ? options.timeoutMs
        : DEFAULT_SCAN_TIMEOUT_MS
    const timers = options.timers || globalThis
    const chooseDevice = options.chooseDevice
    let pendingCallback = null
    let timeoutHandle = null

    return function selectBluetoothDevice(event, deviceList, callback) {
        event.preventDefault()

        const devices = findSelectableDevices(deviceList, deviceNamePrefixes)
        if (devices.length === 1 && devices[0]?.deviceId) {
            clearPending()
            callback(devices[0].deviceId)
            return
        }
        if (devices.length > 1 && typeof chooseDevice === 'function') {
            clearPending()
            void chooseDevice(devices.map(deviceCandidate))
                .then((selected) => callback(selectedDeviceId(selected)))
                .catch(() => callback(''))
            return
        }
        if (devices.length > 0 && devices[0]?.deviceId) {
            clearPending()
            callback(devices[0].deviceId)
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
 * Returns Neon Meter devices if visible, otherwise all visible BLE devices so
 * alternate firmware names can still be tested.
 * @param {Array<{ deviceName?: string, deviceId?: string }>} deviceList
 * @param {string[]} deviceNamePrefixes
 * @returns {Array<{ deviceName?: string, deviceId?: string, rssi?: number }>}
 */
function findSelectableDevices(deviceList, deviceNamePrefixes) {
    const devices = Array.isArray(deviceList) ? deviceList : []
    const matchingDevices = devices.filter((item) =>
        matchesDeviceName(item, deviceNamePrefixes)
    )
    return matchingDevices.length > 0 ? matchingDevices : devices
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

/**
 * Returns non-secret metadata for the selection UI.
 * @param {{ deviceName?: string, deviceId?: string, rssi?: number }} device
 * @returns {{ id: string, name: string, rssi?: number }}
 */
function deviceCandidate(device) {
    const rssi = Number(device.rssi)
    return {
        id: String(device.deviceId || ''),
        name: String(device.deviceName || 'Unnamed BLE device'),
        ...(Number.isFinite(rssi) ? { rssi } : {})
    }
}

/**
 * Returns a selected Electron Bluetooth device id.
 * @param {unknown} selected
 * @returns {string}
 */
function selectedDeviceId(selected) {
    if (typeof selected === 'string') return selected
    if (!selected || typeof selected !== 'object') return ''
    return String(selected.id || selected.deviceId || '')
}
