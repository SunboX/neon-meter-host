import {
    createPersistedSettings,
    normalizePersistedSettings
} from './core/AppSettings.mjs'

/**
 * Coordinates renderer state, BLE writes, and provider refreshes.
 */
export class AppController {
    #state
    #view
    #i18n
    #bridge
    #bleClient
    #timers
    #syncTimer = null
    #bleReconnectTimer = null
    #bleReconnectDelayMs = 5000
    #skipNextBleReconnect = false
    #disposed = false

    /**
     * @param {{
     * state: import('./core/AppState.mjs').AppState,
     * view: import('./ui/AppView.mjs').AppView,
     * i18n?: { getLocale: () => string, setLocale: (locale: string) => Promise<void>, translate: (key: string) => string, applyToDom: (node: Document) => void } | null,
     * bridge: { getAppMeta: () => Promise<object>, loadSettings: () => Promise<object>, saveSettings: (settings: object) => Promise<object>, fetchProviderBundle: (settings?: object) => Promise<object> },
     * bleClient: EventTarget & { isSupported: () => boolean, connect: () => Promise<{ id?: string, name: string, connected: boolean }>, connectRemembered?: (device: { id?: string, name?: string }) => Promise<{ id?: string, name: string, connected: boolean } | null>, disconnect: () => void, writePayload: (payload: object) => Promise<void> },
     * timers?: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval'>,
     * bleReconnectDelayMs?: number
     * }} dependencies
     */
    constructor(dependencies) {
        this.#state = dependencies.state
        this.#view = dependencies.view
        this.#i18n = dependencies.i18n || null
        this.#bridge = dependencies.bridge
        this.#bleClient = dependencies.bleClient
        const timers = dependencies.timers || {}
        this.#timers = {
            setTimeout: timers.setTimeout
                ? timers.setTimeout.bind(timers)
                : globalThis.setTimeout,
            clearTimeout: timers.clearTimeout
                ? timers.clearTimeout.bind(timers)
                : globalThis.clearTimeout,
            setInterval: timers.setInterval
                ? timers.setInterval.bind(timers)
                : globalThis.setInterval,
            clearInterval: timers.clearInterval
                ? timers.clearInterval.bind(timers)
                : globalThis.clearInterval
        }
        this.#bleReconnectDelayMs =
            Number(dependencies.bleReconnectDelayMs) || 5000
    }

    /**
     * Initializes renderer wiring.
     * @returns {Promise<void>}
     */
    async init() {
        const [meta, rawSettings] = await Promise.all([
            this.#bridge.getAppMeta(),
            this.#bridge.loadSettings()
        ])
        const persisted = normalizePersistedSettings({
            ...rawSettings,
            startAtLogin:
                typeof rawSettings?.startAtLogin === 'boolean'
                    ? rawSettings.startAtLogin
                    : meta?.autostart?.openAtLogin
        })
        if (this.#i18n && persisted.locale !== this.#i18n.getLocale()) {
            await this.#i18n.setLocale(persisted.locale)
        }
        this.#state.patch({
            provider: persisted.provider,
            locale: persisted.locale,
            settings: persisted.settings,
            ble: { supported: this.#bleClient.isSupported() },
            sync: {
                status: syncStatusFor(normalizeCredentialStatus(meta))
            }
        })

        this.#state.subscribe((snapshot) => this.#view.render(snapshot))
        this.#view.setVersion(String(meta.version || ''))
        this.#bindView()
        this.#bindBle()
        this.#scheduleSync()
        void this.#connectRememberedBleDevice()
    }

    /**
     * Frees controller resources.
     * @returns {void}
     */
    dispose() {
        this.#disposed = true
        this.#cancelBleReconnect()
        this.#skipNextBleReconnect = true
        if (this.#syncTimer) this.#timers.clearInterval(this.#syncTimer)
        this.#bleClient.disconnect()
    }

    /**
     * Wires view events.
     * @returns {void}
     */
    #bindView() {
        this.#view.bindConnect(() => this.#connect())
        this.#view.bindDisconnect(() => this.#disconnectBle())
        this.#view.bindSyncNow(() => this.#syncNow())
        this.#view.bindSettingsOpen(() => this.#view.openSettingsDialog())
        this.#view.bindSettingsCancel(() => this.#view.closeSettingsDialog())
        this.#view.bindSettingsSave((settings) => this.#saveSettings(settings))
    }

    /**
     * Persists non-secret settings from the settings dialog.
     * @param {Record<string, unknown>} settings
     * @returns {Promise<void>}
     */
    async #saveSettings(settings) {
        const locale = String(settings.locale || 'en')
        const editableSettings = { ...settings }
        delete editableSettings.locale

        try {
            this.#state.patch({
                provider: 'auto',
                locale,
                settings: editableSettings
            })
            if (this.#i18n && locale !== this.#i18n.getLocale()) {
                await this.#i18n.setLocale(locale)
            }
            await this.#bridge.saveSettings(
                createPersistedSettings(this.#state.getSnapshot())
            )
            this.#state.setValue('sync', {
                status: 'Ready',
                error: ''
            })
            if (editableSettings.autoConnectBle === false) {
                this.#cancelBleReconnect()
            }
            this.#view.closeSettingsDialog()
            this.#scheduleSync()
        } catch (error) {
            this.#state.setValue('sync', {
                status: 'Settings save failed',
                error: errorMessage(error)
            })
        }
    }

    /**
     * Wires BLE client events.
     * @returns {void}
     */
    #bindBle() {
        this.#bleClient.addEventListener('disconnected', () => {
            const wasConnected = this.#state.getSnapshot().ble.connected
            this.#state.setValue('ble', { connected: false, deviceName: '' })
            if (this.#skipNextBleReconnect) {
                this.#skipNextBleReconnect = false
                return
            }
            if (wasConnected) this.#scheduleBleReconnect()
        })
        this.#bleClient.addEventListener('refresh-requested', () =>
            this.#syncNow()
        )
        this.#bleClient.addEventListener('ack', (event) => {
            const raw = event.detail?.raw || 'ack'
            this.#state.setValue('sync', {
                status: 'Device acknowledged ' + raw,
                error: ''
            })
        })
    }

    /**
     * Connects to the CoreS3 over BLE.
     * @returns {Promise<void>}
     */
    async #connect() {
        try {
            this.#cancelBleReconnect()
            const device = await this.#bleClient.connect()
            this.#state.setValue('ble', {
                connected: true,
                deviceName: device.name
            })
            await this.#rememberBleDevice(device)
            await this.#syncNow()
        } catch (error) {
            this.#state.setValue('sync', {
                error: errorMessage(error),
                status: 'BLE connection failed'
            })
        }
    }

    /**
     * Disconnects BLE after an explicit local operator action.
     * @returns {void}
     */
    #disconnectBle() {
        this.#cancelBleReconnect()
        this.#skipNextBleReconnect = true
        this.#bleClient.disconnect()
    }

    /**
     * Reconnects to a persisted BLE device when the browser still has permission.
     * @returns {Promise<void>}
     */
    async #connectRememberedBleDevice() {
        const snapshot = this.#state.getSnapshot()
        if (snapshot.settings.autoConnectBle === false) return

        const rememberedDevice = {
            id: String(snapshot.settings.rememberedBleDeviceId || ''),
            name: String(snapshot.settings.rememberedBleDeviceName || '')
        }
        if (!this.#bleClient.isSupported()) return
        if (!rememberedDevice.id && !rememberedDevice.name) return
        if (typeof this.#bleClient.connectRemembered !== 'function') return

        this.#state.setValue('sync', {
            status: 'Reconnecting Neon Meter',
            error: ''
        })

        try {
            const device =
                await this.#bleClient.connectRemembered(rememberedDevice)
            if (!device?.connected) {
                this.#state.setValue('sync', {
                    status: snapshot.sync.status,
                    error: ''
                })
                return
            }
            this.#state.setValue('ble', {
                connected: true,
                deviceName: device.name
            })
            await this.#rememberBleDevice(device)
            await this.#syncNow()
        } catch (error) {
            this.#state.setValue('sync', {
                status: 'BLE auto-connect failed',
                error: errorMessage(error)
            })
        }
    }

    /**
     * Starts a delayed reconnect loop for an unexpectedly lost BLE device.
     * @returns {void}
     */
    #scheduleBleReconnect() {
        if (this.#disposed || this.#bleReconnectTimer) return
        const snapshot = this.#state.getSnapshot()
        const rememberedDevice = rememberedBleDeviceFrom(snapshot)
        if (snapshot.settings.autoConnectBle === false) return
        if (snapshot.ble.connected) return
        if (!rememberedDevice) return
        if (!this.#bleClient.isSupported()) return
        if (typeof this.#bleClient.connectRemembered !== 'function') return

        this.#state.setValue('sync', {
            status: 'Waiting for Neon Meter to return',
            error: ''
        })
        this.#bleReconnectTimer = this.#timers.setTimeout(() => {
            this.#bleReconnectTimer = null
            void this.#retryBleReconnect()
        }, this.#bleReconnectDelayMs)
    }

    /**
     * Attempts one remembered-device reconnect and reschedules if unavailable.
     * @returns {Promise<void>}
     */
    async #retryBleReconnect() {
        if (this.#disposed) return
        const snapshot = this.#state.getSnapshot()
        const rememberedDevice = rememberedBleDeviceFrom(snapshot)
        if (snapshot.settings.autoConnectBle === false) return
        if (snapshot.ble.connected) return
        if (!rememberedDevice) return
        if (!this.#bleClient.isSupported()) return
        if (typeof this.#bleClient.connectRemembered !== 'function') return

        let connected = false
        this.#state.setValue('sync', {
            status: 'Reconnecting Neon Meter',
            error: ''
        })

        try {
            const device =
                await this.#bleClient.connectRemembered(rememberedDevice)
            if (device?.connected) {
                connected = true
                this.#state.setValue('ble', {
                    connected: true,
                    deviceName: device.name
                })
                await this.#rememberBleDevice(device)
                await this.#syncNow()
            }
        } catch (error) {
            this.#state.setValue('sync', {
                status: 'Waiting for Neon Meter to return',
                error: errorMessage(error)
            })
        }

        if (!connected) this.#scheduleBleReconnect()
    }

    /**
     * Cancels any pending BLE reconnect attempt.
     * @returns {void}
     */
    #cancelBleReconnect() {
        if (!this.#bleReconnectTimer) return
        this.#timers.clearTimeout(this.#bleReconnectTimer)
        this.#bleReconnectTimer = null
    }

    /**
     * Stores the last connected BLE device metadata for startup reconnect.
     * @param {{ id?: string, name?: string }} device
     * @returns {Promise<void>}
     */
    async #rememberBleDevice(device) {
        const remembered = {
            rememberedBleDeviceId: String(device.id || ''),
            rememberedBleDeviceName: String(device.name || '')
        }
        if (
            !remembered.rememberedBleDeviceId &&
            !remembered.rememberedBleDeviceName
        ) {
            return
        }

        this.#state.setValue('settings', remembered)
        await this.#bridge.saveSettings(
            createPersistedSettings(this.#state.getSnapshot())
        )
    }

    /**
     * Fetches detected providers and optionally writes to BLE.
     * @returns {Promise<void>}
     */
    async #syncNow() {
        const snapshot = this.#state.getSnapshot()
        this.#state.setValue('sync', {
            running: true,
            error: '',
            status: 'Syncing detected providers'
        })

        try {
            const payload = await this.#bridge.fetchProviderBundle(
                snapshot.settings
            )

            if (snapshot.ble.connected) {
                await this.#bleClient.writePayload(payload)
            }
            this.#state.patch({
                payload,
                sync: {
                    running: false,
                    status: snapshot.ble.connected
                        ? 'Synced to Neon Meter'
                        : 'Payload ready',
                    lastSync: new Date().toLocaleTimeString(),
                    error: bundleError(payload)
                }
            })
        } catch (error) {
            this.#state.setValue('sync', {
                running: false,
                status: 'Sync failed',
                error: errorMessage(error)
            })
        }
    }

    /**
     * Restarts the auto-sync timer.
     * @returns {void}
     */
    #scheduleSync() {
        if (this.#syncTimer) this.#timers.clearInterval(this.#syncTimer)
        const settings = this.#state.getSnapshot().settings
        if (!settings.autoSync) return
        const intervalMs =
            Math.max(1, Number(settings.syncIntervalMinutes) || 5) * 60000
        this.#syncTimer = this.#timers.setInterval(
            () => this.#syncNow(),
            intervalMs
        )
    }
}

/**
 * Returns persisted BLE metadata from the current app snapshot.
 * @param {ReturnType<import('./core/AppState.mjs').AppState['getSnapshot']>} snapshot
 * @returns {{ id: string, name: string } | null}
 */
function rememberedBleDeviceFrom(snapshot) {
    const device = {
        id: String(snapshot.settings.rememberedBleDeviceId || ''),
        name: String(snapshot.settings.rememberedBleDeviceName || '')
    }
    return device.id || device.name ? device : null
}

/**
 * Formats unknown errors.
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
    return error instanceof Error
        ? error.message
        : String(error || 'Unknown error')
}

/**
 * Normalizes main-process credential status metadata.
 * @param {object} meta
 * @returns {Record<string, { configured: boolean, source: string }>}
 */
function normalizeCredentialStatus(meta) {
    const status =
        meta?.credentialStatus && typeof meta.credentialStatus === 'object'
            ? meta.credentialStatus
            : {}
    return {
        claude: normalizeProviderStatus(status.claude),
        chatgpt: normalizeProviderStatus(status.chatgpt)
    }
}

/**
 * Normalizes one provider status object.
 * @param {unknown} status
 * @returns {{ configured: boolean, source: string }}
 */
function normalizeProviderStatus(status) {
    if (!status || typeof status !== 'object') {
        return { configured: false, source: 'none' }
    }
    return {
        configured: Boolean(status.configured),
        source: String(status.source || 'none')
    }
}

/**
 * Returns a user-facing sync status for current detected providers.
 * @param {Record<string, { configured?: boolean }>} status
 * @returns {string}
 */
function syncStatusFor(status) {
    const detected = ['claude', 'chatgpt'].filter(
        (provider) => status[provider]?.configured
    )
    if (detected.length === 0) return 'Waiting for local auth'
    if (detected.length === 2) return 'Ready: Claude Code + ChatGPT'
    return detected[0] === 'chatgpt'
        ? 'Ready: ChatGPT/Codex'
        : 'Ready: Claude Code'
}

/**
 * Returns the first provider error message from a provider bundle.
 * @param {unknown} payload
 * @returns {string}
 */
function bundleError(payload) {
    if (!payload || typeof payload !== 'object') return ''
    const providers = Array.isArray(payload.providers) ? payload.providers : []
    const failed = providers.find((item) => item?.ok === false)
    return failed ? String(failed.detail || '') : ''
}
