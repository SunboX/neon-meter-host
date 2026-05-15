import { buildFirmwarePayload } from '../core/FirmwarePayload.mjs'

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages'

/**
 * Fetches Claude Code quota metadata through Anthropic rate-limit headers.
 */
export class ClaudeCodeUsageProvider {
    /** @type {typeof fetch} */
    #fetch

    /** @type {string} */
    #token

    /** @type {Date} */
    #now

    /**
     * @param {{ fetchImpl?: typeof fetch, token?: string, now?: Date }} options
     */
    constructor(options = {}) {
        this.#fetch = options.fetchImpl || globalThis.fetch
        this.#token = String(options.token || '').trim()
        this.#now = options.now || new Date()
    }

    /**
     * Fetches and maps the current Claude Code usage payload.
     * @returns {Promise<ReturnType<typeof buildFirmwarePayload>>}
     */
    async fetchPayload() {
        if (!this.#token) {
            return claudeErrorPayload(
                'Claude Code credentials were not found on this machine'
            )
        }

        try {
            const response = await this.#fetch(MESSAGES_URL, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer ' + this.#token,
                    'anthropic-version': '2023-06-01',
                    'anthropic-beta': 'oauth-2025-04-20',
                    'content-type': 'application/json',
                    'user-agent': 'claude-code/2.1.5'
                },
                body: JSON.stringify({
                    model: 'claude-haiku-4-5-20251001',
                    max_tokens: 1,
                    messages: [
                        {
                            role: 'user',
                            content: 'quota'
                        }
                    ]
                })
            })

            if (!response.ok) {
                return claudeErrorPayload(
                    'Claude Code quota request failed: HTTP ' +
                        String(response.status)
                )
            }

            return mapClaudeHeaders(response.headers, this.#now)
        } catch (error) {
            return claudeErrorPayload(errorMessage(error))
        }
    }
}

/**
 * Extracts an OAuth access token from Claude Code credentials.
 * @param {unknown} raw
 * @returns {string}
 */
export function extractClaudeAccessToken(raw) {
    if (!raw) return ''
    if (typeof raw === 'string') {
        const text = raw.trim()
        if (!text) return ''
        if (text.startsWith('{')) {
            try {
                return extractClaudeAccessToken(JSON.parse(text))
            } catch (_error) {
                return ''
            }
        }
        return /^[A-Za-z0-9_.~+/=-]{20,}$/.test(text) ? text : ''
    }

    if (typeof raw !== 'object') return ''
    const source = /** @type {Record<string, unknown>} */ (raw)
    return firstString([
        source.accessToken,
        source.access_token,
        source.token,
        nested(source, ['claudeAiOauth', 'accessToken']),
        nested(source, ['claudeAiOauth', 'access_token']),
        nested(source, ['oauth', 'accessToken']),
        nested(source, ['oauth', 'access_token']),
        findAccessToken(source)
    ])
}

/**
 * Maps Anthropic headers to firmware payload fields.
 * @param {unknown} headers
 * @param {Date} now
 * @returns {ReturnType<typeof buildFirmwarePayload>}
 */
function mapClaudeHeaders(headers, now) {
    const sessionPercent = headerPercent(
        headers,
        'anthropic-ratelimit-unified-5h-utilization'
    )
    const weeklyPercent = headerPercent(
        headers,
        'anthropic-ratelimit-unified-7d-utilization'
    )

    return buildFirmwarePayload({
        provider: 'claude',
        title: 'Claude Code',
        currentLabel: 'Session',
        currentPercent: sessionPercent,
        currentResetMinutes: resetMinutes(
            headerValue(headers, 'anthropic-ratelimit-unified-5h-reset'),
            now
        ),
        windowLabel: 'Weekly',
        windowPercent: weeklyPercent,
        windowResetMinutes: resetMinutes(
            headerValue(headers, 'anthropic-ratelimit-unified-7d-reset'),
            now
        ),
        status:
            headerValue(headers, 'anthropic-ratelimit-unified-5h-status') ||
            'ok',
        detail:
            '5h ' +
            Math.round(sessionPercent) +
            '% / 7d ' +
            Math.round(weeklyPercent) +
            '%',
        ok: true
    })
}

/**
 * Creates a Claude Code error payload.
 * @param {string} detail
 * @returns {ReturnType<typeof buildFirmwarePayload>}
 */
function claudeErrorPayload(detail) {
    return buildFirmwarePayload({
        provider: 'claude',
        title: 'Claude Code',
        currentLabel: 'Session',
        windowLabel: 'Weekly',
        status: 'error',
        detail,
        ok: false
    })
}

/**
 * Reads a percentage header.
 * @param {unknown} headers
 * @param {string} name
 * @returns {number}
 */
function headerPercent(headers, name) {
    return normalizePercent(headerValue(headers, name))
}

/**
 * Reads a header from Headers, Map, or a plain object.
 * @param {unknown} headers
 * @param {string} name
 * @returns {string}
 */
function headerValue(headers, name) {
    if (!headers) return ''
    if (typeof headers.get === 'function') {
        return String(headers.get(name) || '').trim()
    }
    if (headers instanceof Map) {
        return String(
            headers.get(name) || headers.get(name.toLowerCase()) || ''
        ).trim()
    }
    if (typeof headers === 'object') {
        const source = /** @type {Record<string, unknown>} */ (headers)
        const key = Object.keys(source).find(
            (candidate) => candidate.toLowerCase() === name.toLowerCase()
        )
        return key ? String(source[key] || '').trim() : ''
    }
    return ''
}

/**
 * Normalizes ratio or percentage values.
 * @param {unknown} value
 * @returns {number}
 */
function normalizePercent(value) {
    const parsed = parseFloat(String(value || '').replace('%', ''))
    if (!Number.isFinite(parsed)) return 0
    return parsed <= 1 ? parsed * 100 : parsed
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
 * Searches nested credential objects for an accessToken field.
 * @param {unknown} value
 * @returns {string}
 */
function findAccessToken(value) {
    if (!value || typeof value !== 'object') return ''
    const source = /** @type {Record<string, unknown>} */ (value)
    const direct = firstString([source.accessToken, source.access_token])
    if (direct) return direct

    for (const child of Object.values(source)) {
        const found = findAccessToken(child)
        if (found) return found
    }
    return ''
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
        : String(error || 'Claude Code quota request failed')
}
