import { buildFirmwarePayload } from './FirmwarePayload.mjs'

export const DEFAULT_ROTATION_SECONDS = 30

/**
 * Builds the firmware envelope used when the host has one or more detected providers.
 * @param {object[]} providers
 * @param {{ rotationSeconds?: number }} [options]
 * @returns {{ providers: object[], rotationSeconds: number }}
 */
export function buildProviderBundlePayload(providers, options = {}) {
    const safeProviders = Array.isArray(providers)
        ? providers
              .filter((item) => item && typeof item === 'object')
              .slice(0, 2)
        : []

    return {
        rotationSeconds: normalizeRotationSeconds(options.rotationSeconds),
        providers: safeProviders.length > 0 ? safeProviders : [noAuthPayload()]
    }
}

/**
 * Normalizes display rotation seconds.
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeRotationSeconds(value) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return DEFAULT_ROTATION_SECONDS
    }
    return Math.max(5, Math.min(3600, Math.round(parsed)))
}

/**
 * Creates the fallback payload shown when neither provider is detected.
 * @returns {ReturnType<typeof buildFirmwarePayload>}
 */
function noAuthPayload() {
    return buildFirmwarePayload({
        provider: 'host',
        title: 'Neon Meter',
        currentLabel: 'Auth',
        windowLabel: 'Providers',
        status: 'error',
        detail: 'No local auth found',
        ok: false
    })
}
