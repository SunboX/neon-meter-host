export const DEFAULT_PROVIDER = 'auto'
export const DEFAULT_LOCALE = 'en'

export const DEFAULT_SETTINGS = Object.freeze({
    syncIntervalMinutes: 5,
    rotationSeconds: 30,
    autoSync: true,
    startAtLogin: false,
    startHidden: false,
    autoConnectBle: true,
    rememberedBleDeviceId: '',
    rememberedBleDeviceName: ''
})

const LOCALES = new Set(['en', 'de'])

/**
 * Converts a persisted flat settings payload into renderer state fields.
 * @param {unknown} raw
 * @returns {{ provider: string, locale: string, settings: typeof DEFAULT_SETTINGS, isFirstRun: boolean }}
 */
export function normalizePersistedSettings(raw) {
    const source = raw && typeof raw === 'object' ? raw : {}
    return {
        provider: DEFAULT_PROVIDER,
        locale: localeOrDefault(source.locale),
        settings: normalizeSettings(source),
        isFirstRun: Object.keys(source).length === 0
    }
}

/**
 * Creates the flat non-secret settings payload stored on disk.
 * @param {{ provider?: string, locale?: string, settings?: Record<string, unknown> }} snapshot
 * @returns {Record<string, string | number | boolean>}
 */
export function createPersistedSettings(snapshot) {
    const settings = normalizeSettings(snapshot?.settings || {})
    return {
        locale: localeOrDefault(snapshot?.locale),
        syncIntervalMinutes: settings.syncIntervalMinutes,
        rotationSeconds: settings.rotationSeconds,
        autoSync: settings.autoSync,
        startAtLogin: settings.startAtLogin,
        startHidden: settings.startHidden,
        autoConnectBle: settings.autoConnectBle,
        rememberedBleDeviceId: settings.rememberedBleDeviceId,
        rememberedBleDeviceName: settings.rememberedBleDeviceName,
        settingsConfigured: true
    }
}

/**
 * Normalizes editable non-secret settings.
 * @param {Record<string, unknown>} source
 * @returns {typeof DEFAULT_SETTINGS}
 */
function normalizeSettings(source) {
    return {
        syncIntervalMinutes: numberOrDefault(
            source.syncIntervalMinutes,
            DEFAULT_SETTINGS.syncIntervalMinutes
        ),
        rotationSeconds: numberOrDefault(
            source.rotationSeconds,
            DEFAULT_SETTINGS.rotationSeconds
        ),
        rememberedBleDeviceId: stringOrDefault(
            source.rememberedBleDeviceId,
            DEFAULT_SETTINGS.rememberedBleDeviceId
        ),
        rememberedBleDeviceName: stringOrDefault(
            source.rememberedBleDeviceName,
            DEFAULT_SETTINGS.rememberedBleDeviceName
        ),
        autoSync:
            typeof source.autoSync === 'boolean'
                ? source.autoSync
                : DEFAULT_SETTINGS.autoSync,
        startAtLogin:
            typeof source.startAtLogin === 'boolean'
                ? source.startAtLogin
                : DEFAULT_SETTINGS.startAtLogin,
        startHidden:
            typeof source.startHidden === 'boolean'
                ? source.startHidden
                : DEFAULT_SETTINGS.startHidden,
        autoConnectBle:
            typeof source.autoConnectBle === 'boolean'
                ? source.autoConnectBle
                : DEFAULT_SETTINGS.autoConnectBle
    }
}

/**
 * Returns a known locale key.
 * @param {unknown} value
 * @returns {string}
 */
function localeOrDefault(value) {
    const locale = String(value || DEFAULT_LOCALE).toLowerCase()
    return LOCALES.has(locale) ? locale : DEFAULT_LOCALE
}

/**
 * Returns a finite numeric setting.
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function numberOrDefault(value, fallback) {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
}

/**
 * Returns a finite string setting.
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function stringOrDefault(value, fallback) {
    return typeof value === 'string' ? value : fallback
}
