import { buildFirmwarePayload } from '../core/FirmwarePayload.mjs'

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'

/**
 * Fetches ChatGPT/Codex quota metadata and maps it to the CoreS3 payload.
 */
export class ChatGptUsageProvider {
    /** @type {typeof fetch} */
    #fetch

    /** @type {string} */
    #accessToken

    /** @type {string} */
    #accountId

    /** @type {Date} */
    #now

    /**
     * @param {{ fetchImpl?: typeof fetch, accessToken?: string, accountId?: string, now?: Date }} options
     */
    constructor(options = {}) {
        this.#fetch = options.fetchImpl || globalThis.fetch
        this.#accessToken = String(options.accessToken || '').trim()
        this.#accountId = String(options.accountId || '').trim()
        this.#now = options.now || new Date()
    }

    /**
     * Fetches and maps the current ChatGPT usage payload.
     * @returns {Promise<ReturnType<typeof buildFirmwarePayload>>}
     */
    async fetchPayload() {
        if (!this.#accessToken) {
            return chatGptErrorPayload(
                'Codex auth was not found on this machine'
            )
        }

        try {
            const headers = {
                Authorization: 'Bearer ' + this.#accessToken,
                Accept: 'application/json'
            }
            if (this.#accountId) {
                headers['ChatGPT-Account-Id'] = this.#accountId
            }

            const response = await this.#fetch(USAGE_URL, { headers })
            if (!response.ok) {
                return chatGptErrorPayload(
                    'ChatGPT quota request failed: HTTP ' +
                        String(response.status)
                )
            }

            return parseChatGptUsagePayload(await response.json(), this.#now)
        } catch (error) {
            return chatGptErrorPayload(errorMessage(error))
        }
    }
}

/**
 * Extracts Codex auth credentials without exposing them to the renderer.
 * @param {unknown} raw
 * @returns {{ accessToken: string, accountId: string }}
 */
export function extractChatGptCredentials(raw) {
    if (!raw) return { accessToken: '', accountId: '' }
    if (typeof raw === 'string') {
        try {
            return extractChatGptCredentials(JSON.parse(raw))
        } catch (_error) {
            return { accessToken: raw.trim(), accountId: '' }
        }
    }
    if (typeof raw !== 'object') return { accessToken: '', accountId: '' }

    const source = /** @type {Record<string, unknown>} */ (raw)
    return {
        accessToken: firstString([
            nested(source, ['tokens', 'access_token']),
            nested(source, ['tokens', 'accessToken']),
            source.access_token,
            source.accessToken
        ]),
        accountId: firstString([
            nested(source, ['tokens', 'account_id']),
            nested(source, ['tokens', 'accountId']),
            source.account_id,
            source.accountId
        ])
    }
}

/**
 * Maps ChatGPT usage JSON to firmware payload fields.
 * @param {unknown} raw
 * @param {Date} [now]
 * @returns {ReturnType<typeof buildFirmwarePayload>}
 */
export function parseChatGptUsagePayload(raw, now = new Date()) {
    const sessionWindow = findQuotaWindow(raw, 'session')
    const weeklyWindow = findQuotaWindow(raw, 'weekly')
    const sessionPercent = percentFromWindow(sessionWindow)
    const weeklyPercent = percentFromWindow(weeklyWindow)

    if (sessionPercent === null && weeklyPercent === null) {
        return chatGptErrorPayload('ChatGPT quota response was not recognized')
    }

    const currentPercent = sessionPercent ?? 0
    const windowPercent = weeklyPercent ?? 0

    return buildFirmwarePayload({
        provider: 'chatgpt',
        title: 'ChatGPT',
        currentLabel: 'Session',
        currentPercent,
        currentResetMinutes: resetMinutes(resetFromWindow(sessionWindow), now),
        windowLabel: 'Weekly',
        windowPercent,
        windowResetMinutes: resetMinutes(resetFromWindow(weeklyWindow), now),
        status: 'ok',
        detail:
            '5h ' +
            Math.round(currentPercent) +
            '% / 7d ' +
            Math.round(windowPercent) +
            '%',
        ok: true
    })
}

/**
 * Finds the best quota window candidate in a loose API response.
 * @param {unknown} raw
 * @param {'session' | 'weekly'} kind
 * @returns {Record<string, unknown> | null}
 */
function findQuotaWindow(raw, kind) {
    if (!raw || typeof raw !== 'object') return null
    const source = /** @type {Record<string, unknown>} */ (raw)
    const explicitKeys =
        kind === 'session'
            ? ['five_hour', 'five_hour_limit', 'primary_window', 'session']
            : ['weekly', 'weekly_limit', 'secondary_window', 'week']

    for (const key of explicitKeys) {
        const value = source[key]
        if (value && typeof value === 'object') {
            return /** @type {Record<string, unknown>} */ (value)
        }
    }

    const candidates = collectObjects(source, '')
        .map((candidate) => ({
            ...candidate,
            score: quotaScore(candidate.path, candidate.value, kind)
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score)

    return candidates[0]?.value || null
}

/**
 * Scores a nested object as a quota window candidate.
 * @param {string} path
 * @param {Record<string, unknown>} value
 * @param {'session' | 'weekly'} kind
 * @returns {number}
 */
function quotaScore(path, value, kind) {
    const text = (path + ' ' + Object.keys(value).join(' ')).toLowerCase()
    const hasPercent = percentFromWindow(value) !== null
    if (!hasPercent) return 0

    if (kind === 'session') {
        return scoreTerms(text, ['five', '5h', '5_hour', 'session', 'primary'])
    }
    return scoreTerms(text, ['week', 'weekly', '7d', '7_day', 'secondary'])
}

/**
 * Scores matching terms in text.
 * @param {string} text
 * @param {string[]} terms
 * @returns {number}
 */
function scoreTerms(text, terms) {
    return terms.reduce(
        (score, term) => score + (text.includes(term) ? 1 : 0),
        0
    )
}

/**
 * Collects nested plain objects with their paths.
 * @param {unknown} value
 * @param {string} path
 * @returns {{ path: string, value: Record<string, unknown> }[]}
 */
function collectObjects(value, path) {
    if (!value || typeof value !== 'object') return []
    const object = /** @type {Record<string, unknown>} */ (value)
    const entries = [{ path, value: object }]

    for (const [key, child] of Object.entries(object)) {
        if (child && typeof child === 'object' && !Array.isArray(child)) {
            entries.push(...collectObjects(child, path + '.' + key))
        }
    }

    return entries
}

/**
 * Reads a percent used from a quota window object.
 * @param {Record<string, unknown> | null} window
 * @returns {number | null}
 */
function percentFromWindow(window) {
    if (!window) return null
    const usedPercent = numberFromKeys(window, [
        'used_percent',
        'usage_percent',
        'percent_used',
        'used_pct'
    ])
    if (usedPercent !== null) return usedPercent

    const remainingPercent = numberFromKeys(window, [
        'remaining_percent',
        'percent_left',
        'remaining_pct'
    ])
    if (remainingPercent !== null) return 100 - remainingPercent

    const utilization = numberFromKeys(window, ['utilization', 'used_ratio'])
    if (utilization !== null) return normalizeRatioOrPercent(utilization)

    const used = numberFromKeys(window, ['used', 'current', 'consumed'])
    const limit = numberFromKeys(window, ['limit', 'max', 'allowed'])
    if (used !== null && limit !== null && limit > 0) {
        return (used / limit) * 100
    }

    return null
}

/**
 * Reads a reset timestamp from a quota window object.
 * @param {Record<string, unknown> | null} window
 * @returns {unknown}
 */
function resetFromWindow(window) {
    if (!window) return undefined
    return firstValue(window, [
        'reset_time_ms',
        'reset_time',
        'reset_at',
        'resets_at',
        'resetAt',
        'resetsAt'
    ])
}

/**
 * Normalizes ratio-style values while still accepting whole percentages.
 * @param {number} value
 * @returns {number}
 */
function normalizeRatioOrPercent(value) {
    return value <= 1 ? value * 100 : value
}

/**
 * Reads the first finite number from a list of possible keys.
 * @param {Record<string, unknown>} source
 * @param {string[]} keys
 * @returns {number | null}
 */
function numberFromKeys(source, keys) {
    const value = firstValue(source, keys)
    if (value === undefined || value === null || value === '') return null
    const parsed = parseFloat(String(value).replace('%', ''))
    return Number.isFinite(parsed) ? parsed : null
}

/**
 * Reads the first available value from possible keys.
 * @param {Record<string, unknown>} source
 * @param {string[]} keys
 * @returns {unknown}
 */
function firstValue(source, keys) {
    for (const key of keys) {
        if (Object.hasOwn(source, key)) return source[key]
    }
    return undefined
}

/**
 * Converts a reset timestamp into minutes from now.
 * @param {unknown} value
 * @param {Date} now
 * @returns {number}
 */
function resetMinutes(value, now) {
    const text = String(value || '').trim()
    if (!text) return -1

    const numeric = Number(text)
    let timestamp = Number.NaN
    if (Number.isFinite(numeric)) {
        timestamp = numeric > 100000000000 ? numeric : numeric * 1000
    } else {
        timestamp = Date.parse(text)
    }

    if (!Number.isFinite(timestamp)) return -1
    return Math.max(0, Math.ceil((timestamp - now.getTime()) / 60000))
}

/**
 * Creates a ChatGPT error payload.
 * @param {string} detail
 * @returns {ReturnType<typeof buildFirmwarePayload>}
 */
function chatGptErrorPayload(detail) {
    return buildFirmwarePayload({
        provider: 'chatgpt',
        title: 'ChatGPT',
        currentLabel: 'Session',
        windowLabel: 'Weekly',
        status: 'error',
        detail,
        ok: false
    })
}

/**
 * Returns a nested object value.
 * @param {Record<string, unknown>} source
 * @param {string[]} path
 * @returns {unknown}
 */
function nested(source, path) {
    let current = /** @type {unknown} */ (source)
    for (const key of path) {
        if (!current || typeof current !== 'object') return undefined
        current = /** @type {Record<string, unknown>} */ (current)[key]
    }
    return current
}

/**
 * Returns the first non-empty string in a list.
 * @param {unknown[]} values
 * @returns {string}
 */
function firstString(values) {
    for (const value of values) {
        const text = String(value || '').trim()
        if (text) return text
    }
    return ''
}

/**
 * Formats an unknown error.
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
    return error instanceof Error
        ? error.message
        : String(error || 'ChatGPT quota request failed')
}
