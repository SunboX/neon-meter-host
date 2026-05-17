import {
    DEFAULT_LOCALE,
    DEFAULT_PROVIDER,
    DEFAULT_SETTINGS
} from './AppSettings.mjs'

/**
 * State container for the Electron host renderer.
 */
export class AppState {
    /** @type {{ provider: string, locale: string, settings: typeof DEFAULT_SETTINGS, ble: { connected: boolean, connecting: boolean, deviceName: string, supported: boolean }, sync: { running: boolean, lastSync: string, status: string, error: string }, payload: object | null }} */
    #state

    /** @type {Set<(snapshot: ReturnType<AppState['getSnapshot']>) => void>} */
    #listeners

    /**
     * @param {Partial<ReturnType<AppState['getSnapshot']>>} [initial]
     */
    constructor(initial = {}) {
        this.#state = {
            provider: String(initial.provider || DEFAULT_PROVIDER),
            locale: String(initial.locale || DEFAULT_LOCALE),
            settings: { ...DEFAULT_SETTINGS, ...(initial.settings || {}) },
            ble: {
                connected: Boolean(initial.ble?.connected),
                connecting: Boolean(initial.ble?.connecting),
                deviceName: String(initial.ble?.deviceName || ''),
                supported: Boolean(initial.ble?.supported)
            },
            sync: {
                running: Boolean(initial.sync?.running),
                lastSync: String(initial.sync?.lastSync || ''),
                status: String(initial.sync?.status || 'Ready'),
                error: String(initial.sync?.error || '')
            },
            payload: initial.payload || null
        }
        this.#listeners = new Set()
    }

    /**
     * Returns an immutable state snapshot.
     * @returns {{ provider: string, locale: string, settings: typeof DEFAULT_SETTINGS, ble: { connected: boolean, connecting: boolean, deviceName: string, supported: boolean }, sync: { running: boolean, lastSync: string, status: string, error: string }, payload: object | null }}
     */
    getSnapshot() {
        return structuredClone(this.#state)
    }

    /**
     * Sets one top-level state field.
     * @param {'provider' | 'locale' | 'settings' | 'ble' | 'sync' | 'payload'} key
     * @param {unknown} value
     * @returns {ReturnType<AppState['getSnapshot']>}
     */
    setValue(key, value) {
        if (key === 'settings') {
            this.#state.settings = { ...this.#state.settings, ...(value || {}) }
        } else if (key === 'ble') {
            this.#state.ble = { ...this.#state.ble, ...(value || {}) }
        } else if (key === 'sync') {
            this.#state.sync = { ...this.#state.sync, ...(value || {}) }
        } else if (key === 'payload') {
            this.#state.payload =
                value && typeof value === 'object'
                    ? structuredClone(value)
                    : null
        } else if (key === 'provider' || key === 'locale') {
            this.#state[key] = String(value || '')
        }

        return this.#emit()
    }

    /**
     * Applies a state patch.
     * @param {Partial<ReturnType<AppState['getSnapshot']>>} patch
     * @returns {ReturnType<AppState['getSnapshot']>}
     */
    patch(patch) {
        for (const [key, value] of Object.entries(patch || {})) {
            this.setValue(
                /** @type {keyof ReturnType<AppState['getSnapshot']>} */ (key),
                value
            )
        }
        return this.getSnapshot()
    }

    /**
     * Subscribes to state updates.
     * @param {(snapshot: ReturnType<AppState['getSnapshot']>) => void} callback
     * @returns {() => void}
     */
    subscribe(callback) {
        if (typeof callback !== 'function') return () => {}
        this.#listeners.add(callback)
        callback(this.getSnapshot())
        return () => this.#listeners.delete(callback)
    }

    /**
     * Emits the current state.
     * @returns {ReturnType<AppState['getSnapshot']>}
     */
    #emit() {
        const snapshot = this.getSnapshot()
        this.#listeners.forEach((listener) => listener(snapshot))
        return snapshot
    }
}
