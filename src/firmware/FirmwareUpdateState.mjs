/** Returns user-facing firmware status text. */
export function firmwareStatus(state) {
    if (!state.latestVersion) return 'Firmware release not checked'
    if (!state.connected) return 'Connect a device to check firmware'
    if (!state.connectedVersion) return 'Connected firmware version unknown'
    return state.updateAvailable ? 'Update available' : 'Firmware up to date'
}

/** Returns a clamped integer percentage from an ESP Web Tools state. */
export function firmwareProgressPercentage(state) {
    const percentage = Math.floor(Number(state?.details?.percentage) || 0)
    return Math.max(0, Math.min(100, percentage))
}
