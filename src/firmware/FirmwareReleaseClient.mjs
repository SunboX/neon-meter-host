export const DEFAULT_FIRMWARE_MANIFEST_URL =
    'https://sunbox.github.io/neon-meter/manifest.json'

/**
 * Fetches and normalizes the latest published firmware installer manifest.
 * @param {{ manifestUrl?: string, fetch?: typeof globalThis.fetch }} [options]
 * @returns {Promise<{ name: string, version: string, manifestUrl: string, chipFamily: string, imageUrl: string }>}
 */
export async function fetchLatestFirmwareRelease(options = {}) {
    const manifestUrl = String(
        options.manifestUrl || DEFAULT_FIRMWARE_MANIFEST_URL
    )
    const fetchImpl = options.fetch || globalThis.fetch
    if (typeof fetchImpl !== 'function') {
        throw new Error('Firmware release fetch is not available')
    }

    const response = await fetchImpl(manifestUrl)
    if (!response?.ok) {
        throw new Error(
            'Firmware manifest request failed: HTTP ' +
                String(response?.status || 'unknown')
        )
    }
    return normalizeFirmwareManifest(await response.json(), manifestUrl)
}

/**
 * Normalizes an ESP Web Tools manifest into host firmware release metadata.
 * @param {unknown} manifest
 * @param {string} manifestUrl
 * @returns {{ name: string, version: string, manifestUrl: string, chipFamily: string, imageUrl: string }}
 */
export function normalizeFirmwareManifest(manifest, manifestUrl) {
    const source = manifest && typeof manifest === 'object' ? manifest : {}
    const builds = Array.isArray(source.builds) ? source.builds : []
    const build = builds.find((item) => item && typeof item === 'object') || {}
    const parts = Array.isArray(build.parts) ? build.parts : []
    const part = parts.find((item) => item && typeof item === 'object') || {}
    const version = String(source.version || '').trim()
    const chipFamily = String(build.chipFamily || '').trim()
    const imagePath = String(part.path || '').trim()

    if (!version) throw new Error('Firmware manifest is missing version')
    if (!chipFamily) throw new Error('Firmware manifest is missing chip family')
    if (!imagePath) throw new Error('Firmware manifest is missing image path')

    return {
        name: String(source.name || 'Neon Meter'),
        version,
        manifestUrl,
        chipFamily,
        imageUrl: new URL(imagePath, manifestUrl).href
    }
}

/**
 * Compares two semantic versions.
 * @param {string} left
 * @param {string} right
 * @returns {-1 | 0 | 1}
 */
export function compareSemver(left, right) {
    const leftParts = semverParts(left)
    const rightParts = semverParts(right)
    for (let index = 0; index < 3; index += 1) {
        if (leftParts[index] > rightParts[index]) return 1
        if (leftParts[index] < rightParts[index]) return -1
    }
    return 0
}

/**
 * Returns numeric major/minor/patch parts for a version string.
 * @param {unknown} version
 * @returns {[number, number, number]}
 */
function semverParts(version) {
    const text = String(version || '')
        .trim()
        .replace(/^v/i, '')
    const parts = text.split('.').map((part) => Number(part))
    return [0, 1, 2].map((index) =>
        Number.isFinite(parts[index]) ? parts[index] : 0
    )
}
