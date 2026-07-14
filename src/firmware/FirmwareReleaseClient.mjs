export const DEFAULT_FIRMWARE_MANIFEST_URL =
    'https://sunbox.github.io/neon-meter/manifest.json'

/**
 * Fetches and normalizes the latest published firmware installer manifest.
 * @param {{ manifestUrl?: string, fetch?: typeof globalThis.fetch }} [options]
 * @returns {Promise<{ name: string, version: string, manifestUrl: string, chipFamily: string, parts: Array<{ path: string, offset: number }>, imageUrl: string, factoryImageUrl: string }>}
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
 * @returns {{ name: string, version: string, manifestUrl: string, chipFamily: string, parts: Array<{ path: string, offset: number }>, imageUrl: string, factoryImageUrl: string }}
 */
export function normalizeFirmwareManifest(manifest, manifestUrl) {
    const source = manifest && typeof manifest === 'object' ? manifest : {}
    const builds = Array.isArray(source.builds) ? source.builds : []
    const build = builds.find((item) => item && typeof item === 'object') || {}
    const parts = Array.isArray(build.parts) ? build.parts : []
    const version = String(source.version || '').trim()
    const chipFamily = String(build.chipFamily || '').trim()
    const normalizedParts = normalizeFirmwareParts(parts, manifestUrl)
    const firmwarePart = normalizedParts.find(
        (part) => part.offset === 65536 || /\/firmware\.bin$/i.test(part.path)
    )
    const factoryPath = String(source.factory?.path || '').trim()

    if (!version) throw new Error('Firmware manifest is missing version')
    if (!chipFamily) throw new Error('Firmware manifest is missing chip family')
    if (!firmwarePart) {
        throw new Error('Firmware manifest is missing application image')
    }
    if (!factoryPath) {
        throw new Error('Firmware manifest is missing factory image')
    }

    return {
        name: String(source.name || 'Neon Meter'),
        version,
        manifestUrl,
        chipFamily,
        parts: normalizedParts,
        imageUrl: firmwarePart.path,
        factoryImageUrl: new URL(factoryPath, manifestUrl).href
    }
}

/**
 * Validates and resolves every non-erasing firmware image part.
 * @param {unknown[]} parts
 * @param {string} manifestUrl
 * @returns {Array<{ path: string, offset: number }>}
 */
function normalizeFirmwareParts(parts, manifestUrl) {
    if (parts.length === 0) {
        throw new Error('Firmware manifest is missing part offsets')
    }
    const offsets = new Set()
    return parts.map((item) => {
        const offset = item?.offset
        if (!Number.isInteger(offset) || offset < 0) {
            throw new Error(
                'Firmware part offset must be a non-negative integer'
            )
        }
        if (offset >= 0x9000 && offset < 0xe000) {
            throw new Error('Firmware part offset overlaps NVS')
        }
        if (offsets.has(offset)) {
            throw new Error('Firmware part offset is duplicated')
        }
        offsets.add(offset)

        const path = String(item?.path || '').trim()
        if (!path) throw new Error('Firmware part offset is missing a path')
        return {
            path: new URL(path, manifestUrl).href,
            offset
        }
    })
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
