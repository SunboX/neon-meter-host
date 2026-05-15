const DETAIL_LIMIT = 48

/**
 * Builds the compact JSON object expected by the CoreS3 firmware.
 * @param {{
 * provider?: string,
 * title?: string,
 * currentPercent?: number,
 * currentLabel?: string,
 * currentResetMinutes?: number,
 * windowPercent?: number,
 * windowLabel?: string,
 * windowResetMinutes?: number,
 * status?: string,
 * detail?: string,
 * ok?: boolean
 * }} input
 * @returns {{ p: string, title: string, s: number, sl: string, sr: number, w: number, wl: string, wr: number, st: string, detail: string, ok: boolean }}
 */
export function buildFirmwarePayload(input = {}) {
    const provider = normalizeText(input.provider, 'claude').toLowerCase()
    return {
        p: provider,
        title: normalizeText(input.title, defaultTitle(provider)),
        s: clampPercent(input.currentPercent),
        sl: normalizeText(input.currentLabel, 'Current'),
        sr: normalizeMinutes(input.currentResetMinutes),
        w: clampPercent(input.windowPercent),
        wl: normalizeText(input.windowLabel, 'Weekly'),
        wr: normalizeMinutes(input.windowResetMinutes),
        st: normalizeText(input.status, input.ok === false ? 'error' : 'ok'),
        detail: truncate(normalizeText(input.detail, ''), DETAIL_LIMIT),
        ok: input.ok !== false
    }
}

/**
 * Returns minutes until the next local midnight.
 * @param {Date} [now]
 * @returns {number}
 */
export function minutesUntilEndOfDay(now = new Date()) {
    const end = new Date(now)
    end.setHours(24, 0, 0, 0)
    return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 60000))
}

/**
 * Returns minutes until the first moment of the next local month.
 * @param {Date} [now]
 * @returns {number}
 */
export function minutesUntilEndOfMonth(now = new Date()) {
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0)
    return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 60000))
}

/**
 * Clamps a number to an integer percentage.
 * @param {number | undefined} value
 * @returns {number}
 */
export function clampPercent(value) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return 0
    return Math.min(100, Math.max(0, Math.round(parsed)))
}

/**
 * Formats a USD amount for compact display.
 * @param {number} value
 * @returns {string}
 */
export function formatUsd(value) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return '$0.00'
    return '$' + parsed.toFixed(2)
}

/**
 * Returns a display title for a provider key.
 * @param {string} provider
 * @returns {string}
 */
function defaultTitle(provider) {
    const titles = {
        host: 'Neon Meter',
        chatgpt: 'ChatGPT',
        claude: 'Claude Code'
    }
    return titles[provider] || 'Neon Meter'
}

/**
 * Normalizes short user-facing strings.
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function normalizeText(value, fallback) {
    const text = String(value ?? '').trim()
    return text || fallback
}

/**
 * Normalizes reset minute values for firmware payloads.
 * @param {unknown} value
 * @returns {number}
 */
function normalizeMinutes(value) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return -1
    return Math.max(-1, Math.round(parsed))
}

/**
 * Truncates a string to a maximum length.
 * @param {string} value
 * @param {number} maxLength
 * @returns {string}
 */
function truncate(value, maxLength) {
    if (value.length <= maxLength) return value
    return value.slice(0, maxLength)
}
