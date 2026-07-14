import {
    createPersistedSettings,
    normalizePersistedSettings
} from './core/AppSettings.mjs'
import { compareSemver } from './firmware/FirmwareReleaseClient.mjs'
import { BlePairingRecovery } from './ble/BlePairingRecovery.mjs'
import { errorMessage } from './core/ErrorMessage.mjs'

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
    #usbAutoConnectTimer = null
    #resetRefreshTimer = null
    #bleReconnectDelayMs = 5000
    #usbAutoConnectDelayMs = 5000
    #skipNextBleReconnect = false
    #disposed = false
    #activeTransport = ''
    #allowDisconnectedUsbAutoConnect = false
    #firmwareInstallerUnsubscribe = null
    #blePairingRecovery = new BlePairingRecovery()

    /**
     * @param {{
     * state: import('./core/AppState.mjs').AppState,
     * view: import('./ui/AppView.mjs').AppView,
     * i18n?: { getLocale: () => string, setLocale: (locale: string) => Promise<void>, translate: (key: string) => string, applyToDom: (node: Document) => void } | null,
     * bridge: { getAppMeta: () => Promise<object>, loadSettings: () => Promise<object>, saveSettings: (settings: object) => Promise<object>, fetchProviderBundle: (settings?: object) => Promise<object>, fetchLatestFirmwareRelease?: () => Promise<object | null>, onFirmwareInstallerEvent?: (callback: (event: object) => void) => (() => void), openBluetoothSettings?: () => Promise<void> },
     * bleClient: EventTarget & { isSupported: () => boolean, canConnectWithoutRemembered?: () => boolean, connect: (options?: { selectDevice?: (devices: Array<{ id: string, name: string, rssi?: number }>) => Promise<object | string | null> }) => Promise<{ id?: string, name: string, connected: boolean, transport?: string }>, connectRemembered?: (device: { id?: string, name?: string }) => Promise<{ id?: string, name: string, connected: boolean, transport?: string } | null>, disconnect: () => void | Promise<void>, writePayload: (payload: object) => Promise<void>, repairBlePairing?: () => Promise<{ accepted: boolean, reason?: string }> },
     * timers?: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval'>,
     * bleReconnectDelayMs?: number,
     * usbAutoConnectDelayMs?: number
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
                : globalThis.setTimeout.bind(globalThis),
            clearTimeout: timers.clearTimeout
                ? timers.clearTimeout.bind(timers)
                : globalThis.clearTimeout.bind(globalThis),
            setInterval: timers.setInterval
                ? timers.setInterval.bind(timers)
                : globalThis.setInterval.bind(globalThis),
            clearInterval: timers.clearInterval
                ? timers.clearInterval.bind(timers)
                : globalThis.clearInterval.bind(globalThis)
        }
        this.#bleReconnectDelayMs =
            Number(dependencies.bleReconnectDelayMs) || 5000
        this.#usbAutoConnectDelayMs =
            Number(dependencies.usbAutoConnectDelayMs) || 5000
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
        this.#bindFirmwareInstallerLifecycle()
        await this.#loadLatestFirmwareRelease()
        this.#scheduleSync()
        void this.#connectRememberedBleDevice()
        this.#scheduleUsbAutoConnect()
    }

    /**
     * Frees controller resources.
     * @returns {void}
     */
    dispose() {
        this.#disposed = true
        this.#cancelBleReconnect()
        this.#cancelUsbAutoConnect()
        this.#cancelResetRefresh()
        this.#firmwareInstallerUnsubscribe?.()
        this.#firmwareInstallerUnsubscribe = null
        this.#blePairingRecovery.reset()
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
        this.#view.bindFirmwareInstallPrepare?.(() =>
            this.#prepareFirmwareInstall()
        )
        this.#view.bindFirmwareInstall?.(() => this.#prepareFirmwareInstall())
        this.#view.bindFirmwareRecheck?.(() => this.#recheckFirmware())
        this.#view.bindFirmwareInstallerClosed?.((event) =>
            this.#resumeAfterFirmwareInstaller(event)
        )
        this.#view.bindOpenBluetoothSettings?.(() =>
            this.#bridge.openBluetoothSettings?.()
        )
    }

    /**
     * Wires main-process firmware installer lifecycle events.
     * @returns {void}
     */
    #bindFirmwareInstallerLifecycle() {
        if (typeof this.#bridge.onFirmwareInstallerEvent !== 'function') return
        this.#firmwareInstallerUnsubscribe =
            this.#bridge.onFirmwareInstallerEvent((event) => {
                if (event?.type !== 'serial-canceled') return
                this.#resumeAfterFirmwareInstaller(event)
            })
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
            this.#activeTransport = ''
            this.#state.setValue('ble', {
                connected: false,
                connecting: false,
                deviceName: ''
            })
            if (this.#skipNextBleReconnect) {
                this.#skipNextBleReconnect = false
                return
            }
            if (wasConnected) this.#scheduleBleReconnect()
            this.#scheduleUsbAutoConnect()
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
     * Connects to the CoreS3 over the preferred device transport.
     * @returns {Promise<void>}
     */
    async #connect() {
        const snapshot = this.#state.getSnapshot()
        if (
            snapshot.ble.connected ||
            snapshot.ble.connecting ||
            !snapshot.ble.supported
        ) {
            return
        }

        this.#state.patch({
            ble: { connecting: true },
            sync: {
                error: '',
                status: 'Connecting Neon Meter'
            }
        })

        try {
            this.#cancelBleReconnect()
            const device = await this.#bleClient.connect({
                selectDevice: (devices) => this.#chooseBleDevice(devices)
            })
            this.#setConnectedDevice(device)
            await this.#rememberBleDevice(device)
            await this.#syncNow()
        } catch (error) {
            if (await this.#handleBleConnectionError(error)) return
            this.#state.patch({
                ble: { connecting: false },
                sync: {
                    error: errorMessage(error),
                    status: 'Device connection failed'
                }
            })
        }
    }

    /**
     * Disconnects BLE after an explicit local operator action.
     * @returns {void}
     */
    #disconnectBle() {
        const shouldKeepUsbProbe = this.#activeTransport !== 'usb'
        this.#cancelBleReconnect()
        this.#cancelUsbAutoConnect()
        this.#skipNextBleReconnect = true
        this.#blePairingRecovery.reset()
        this.#state.setValue('ble', {
            connecting: false,
            repairRequired: false,
            repairing: false
        })
        this.#bleClient.disconnect()
        if (shouldKeepUsbProbe) {
            this.#scheduleUsbAutoConnect({ allowDisconnected: true })
        }
    }

    /**
     * Reconnects to a persisted BLE device when the BLE client can resolve it.
     * @returns {Promise<void>}
     */
    async #connectRememberedBleDevice() {
        const snapshot = this.#state.getSnapshot()
        if (snapshot.settings.autoConnectBle === false) return

        const rememberedDevice = {
            id: String(snapshot.settings.rememberedBleDeviceId || ''),
            name: String(snapshot.settings.rememberedBleDeviceName || '')
        }
        const canAutoConnectWithoutRemembered =
            this.#canConnectWithoutRemembered()
        if (!this.#bleClient.isSupported()) return
        if (
            !rememberedDevice.id &&
            !rememberedDevice.name &&
            !canAutoConnectWithoutRemembered
        ) {
            return
        }
        if (typeof this.#bleClient.connectRemembered !== 'function') return

        this.#state.setValue('sync', {
            status: 'Reconnecting Neon Meter',
            error: ''
        })

        try {
            const device =
                await this.#bleClient.connectRemembered(rememberedDevice)
            if (!device?.connected) {
                this.#scheduleBleReconnect()
                this.#scheduleUsbAutoConnect()
                return
            }
            this.#setConnectedDevice(device)
            await this.#rememberBleDevice(device)
            await this.#syncNow()
        } catch (error) {
            if (await this.#handleBleConnectionError(error)) return
            this.#state.setValue('sync', {
                status: 'Device auto-connect failed',
                error: errorMessage(error)
            })
            this.#scheduleBleReconnect()
            this.#scheduleUsbAutoConnect()
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
        const canAutoConnectWithoutRemembered =
            this.#canConnectWithoutRemembered()
        if (snapshot.settings.autoConnectBle === false) return
        if (snapshot.ble.connected) return
        if (!rememberedDevice && !canAutoConnectWithoutRemembered) return
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
        const canAutoConnectWithoutRemembered =
            this.#canConnectWithoutRemembered()
        if (snapshot.settings.autoConnectBle === false) return
        if (snapshot.ble.connected) return
        if (!rememberedDevice && !canAutoConnectWithoutRemembered) return
        if (!this.#bleClient.isSupported()) return
        if (typeof this.#bleClient.connectRemembered !== 'function') return

        let connected = false
        this.#state.setValue('sync', {
            status: 'Reconnecting Neon Meter',
            error: ''
        })

        try {
            const device = await this.#bleClient.connectRemembered(
                rememberedDevice || { id: '', name: '' }
            )
            if (device?.connected) {
                connected = true
                this.#setConnectedDevice(device)
                await this.#rememberBleDevice(device)
                await this.#syncNow()
            }
        } catch (error) {
            if (await this.#handleBleConnectionError(error)) return
            this.#state.setValue('sync', {
                status: 'Waiting for Neon Meter to return',
                error: errorMessage(error)
            })
        }

        if (!connected) this.#scheduleBleReconnect()
    }

    /**
     * Starts a delayed USB probe while BLE is active so cable hotplug can win.
     * @param {{ allowDisconnected?: boolean }} [options]
     * @returns {void}
     */
    #scheduleUsbAutoConnect(options = {}) {
        if (this.#disposed || this.#usbAutoConnectTimer) return
        const snapshot = this.#state.getSnapshot()
        const allowDisconnected = Boolean(options.allowDisconnected)
        const force = Boolean(options.force)
        if (snapshot.settings.autoConnectBle === false && !force) return
        if (!snapshot.ble.connected && !allowDisconnected) return
        if (this.#activeTransport === 'usb') return
        if (!this.#canConnectWithoutRemembered()) return
        if (!this.#bleClient.isSupported()) return
        if (typeof this.#bleClient.connectRemembered !== 'function') return

        this.#allowDisconnectedUsbAutoConnect = allowDisconnected
        this.#usbAutoConnectTimer = this.#timers.setTimeout(() => {
            const retryWhileDisconnected = this.#allowDisconnectedUsbAutoConnect
            this.#usbAutoConnectTimer = null
            this.#allowDisconnectedUsbAutoConnect = false
            void this.#retryUsbAutoConnect({
                allowDisconnected: retryWhileDisconnected,
                force
            })
        }, this.#usbAutoConnectDelayMs)
        this.#usbAutoConnectTimer?.unref?.()
    }

    /**
     * Attempts one USB-only auto-connect pass and reschedules until USB wins.
     * @param {{ allowDisconnected?: boolean }} [options]
     * @returns {Promise<void>}
     */
    async #retryUsbAutoConnect(options = {}) {
        if (this.#disposed) return
        const snapshot = this.#state.getSnapshot()
        const allowDisconnected = Boolean(options.allowDisconnected)
        const force = Boolean(options.force)
        if (snapshot.settings.autoConnectBle === false && !force) return
        if (!snapshot.ble.connected && !allowDisconnected) return
        if (this.#activeTransport === 'usb') return
        if (!this.#canConnectWithoutRemembered()) return
        if (!this.#bleClient.isSupported()) return
        if (typeof this.#bleClient.connectRemembered !== 'function') return

        try {
            const device = await this.#bleClient.connectRemembered({
                id: '',
                name: ''
            })
            if (device?.connected && device.transport === 'usb') {
                this.#setConnectedDevice(device)
                await this.#syncNow()
                return
            }
        } catch (_error) {
            // USB may simply be absent; keep the current state and retry later.
        }

        this.#scheduleUsbAutoConnect({ allowDisconnected, force })
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
     * Cancels any pending USB upgrade probe.
     * @returns {void}
     */
    #cancelUsbAutoConnect() {
        if (!this.#usbAutoConnectTimer) return
        this.#timers.clearTimeout(this.#usbAutoConnectTimer)
        this.#usbAutoConnectTimer = null
        this.#allowDisconnectedUsbAutoConnect = false
    }

    /**
     * Stores the active device in app state and manages USB upgrade polling.
     * @param {{ name?: string, transport?: string }} device
     * @returns {void}
     */
    #setConnectedDevice(device) {
        this.#blePairingRecovery.reset()
        this.#activeTransport = String(device?.transport || 'ble')
        this.#state.setValue('ble', {
            connected: true,
            connecting: false,
            deviceName: String(device?.name || 'Neon Meter'),
            repairRequired: false,
            repairing: false
        })
        this.#setConnectedFirmware(device)
        if (this.#activeTransport === 'usb') this.#cancelUsbAutoConnect()
        else this.#scheduleUsbAutoConnect()
    }

    /**
     * Updates firmware status from connected device metadata.
     * @param {{ firmwareVersion?: string, chipFamily?: string }} device
     * @returns {void}
     */
    #setConnectedFirmware(device) {
        const connectedVersion = String(device?.firmwareVersion || '')
        const connectedChipFamily = String(device?.chipFamily || '')
        const latestVersion = this.#state.getSnapshot().firmware.latestVersion
        const updateAvailable = Boolean(
            latestVersion &&
            (!connectedVersion ||
                compareSemver(latestVersion, connectedVersion) > 0)
        )
        this.#state.setValue('firmware', {
            connectedVersion,
            connectedChipFamily,
            updateAvailable,
            installerReady: false,
            status: firmwareStatus({
                connected: true,
                connectedVersion,
                latestVersion,
                updateAvailable
            }),
            error: ''
        })
    }

    /**
     * Stores the last connected BLE device metadata for startup reconnect.
     * @param {{ id?: string, name?: string }} device
     * @returns {Promise<void>}
     */
    async #rememberBleDevice(device) {
        if (device?.transport === 'usb') return
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
     * Returns whether the current client can auto-connect without BLE metadata.
     * @returns {boolean}
     */
    #canConnectWithoutRemembered() {
        return Boolean(this.#bleClient.canConnectWithoutRemembered?.())
    }

    /**
     * Tracks a manual choice and clears stale timeout counts when it changes.
     * @param {Array<{ id?: string, name?: string, rssi?: number }>} devices
     * @returns {Promise<object | string | null>}
     */
    async #chooseBleDevice(devices) {
        const selected = await this.#view.chooseBleDevice(devices)
        this.#blePairingRecovery.noteManualSelection(selected)
        return selected
    }

    /**
     * Handles a typed BLE connection timeout and starts repair after repetition.
     * @param {unknown} error
     * @returns {Promise<boolean>}
     */
    async #handleBleConnectionError(error) {
        if (String(error?.code || '') !== 'BLE_CONNECTION_TIMEOUT') {
            return false
        }

        const snapshot = this.#state.getSnapshot()
        const attempts = this.#blePairingRecovery.recordTimeout(error, {
            id: snapshot.settings.rememberedBleDeviceId,
            name: snapshot.settings.rememberedBleDeviceName
        })
        this.#state.setValue('ble', { connecting: false })
        if (attempts < 2) {
            this.#scheduleBleReconnect()
            this.#state.setValue('sync', {
                status: 'Retrying Neon Meter Bluetooth',
                error: errorMessage(error)
            })
            return true
        }

        await this.#repairTimedOutBlePairing()
        return true
    }

    /**
     * Attempts USB-assisted pairing repair and stops retries when unavailable.
     * @returns {Promise<void>}
     */
    async #repairTimedOutBlePairing() {
        this.#cancelBleReconnect()
        this.#cancelUsbAutoConnect()
        this.#state.patch({
            ble: {
                connecting: false,
                repairRequired: false,
                repairing: true
            },
            sync: {
                status: 'Repairing Bluetooth pairing',
                error: ''
            }
        })

        const result = await this.#blePairingRecovery.repair(this.#bleClient)

        if (result?.accepted) {
            this.#blePairingRecovery.reset()
            this.#scheduleBleReconnect()
            this.#state.patch({
                ble: { repairRequired: false, repairing: true },
                sync: {
                    status: 'Repairing Bluetooth pairing',
                    error: ''
                }
            })
            return
        }

        const repairMessage = this.#blePairingRecovery.fallbackMessage(
            result?.reason
        )
        this.#cancelBleReconnect()
        this.#state.patch({
            ble: { repairRequired: true, repairing: false },
            sync: {
                status: 'Bluetooth pairing repair required',
                error: repairMessage
            }
        })
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
            this.#scheduleResetRefresh(payload)
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
        this.#syncTimer?.unref?.()
    }

    /**
     * Schedules a one-shot refresh at the next known provider reset.
     * @param {unknown} payload
     * @returns {void}
     */
    #scheduleResetRefresh(payload) {
        this.#cancelResetRefresh()
        const resetMinutes = nextResetMinutes(payload)
        if (resetMinutes === null) return

        this.#resetRefreshTimer = this.#timers.setTimeout(() => {
            this.#resetRefreshTimer = null
            void this.#syncNow()
        }, resetMinutes * 60000)
        this.#resetRefreshTimer?.unref?.()
    }

    /**
     * Cancels any pending reset-triggered provider refresh.
     * @returns {void}
     */
    #cancelResetRefresh() {
        if (!this.#resetRefreshTimer) return
        this.#timers.clearTimeout(this.#resetRefreshTimer)
        this.#resetRefreshTimer = null
    }

    /**
     * Loads the latest installable firmware release metadata.
     * @returns {Promise<void>}
     */
    async #loadLatestFirmwareRelease() {
        if (typeof this.#bridge.fetchLatestFirmwareRelease !== 'function') {
            return
        }
        this.#state.setValue('firmware', {
            checking: true,
            status: 'Checking firmware release',
            error: ''
        })
        try {
            const release = await this.#bridge.fetchLatestFirmwareRelease()
            if (!release) {
                this.#state.setValue('firmware', {
                    checking: false,
                    status: 'Firmware release not available'
                })
                return
            }
            const snapshot = this.#state.getSnapshot()
            const latestVersion = String(release.version || '')
            const connectedVersion = snapshot.firmware.connectedVersion
            const updateAvailable = Boolean(
                latestVersion &&
                (!connectedVersion ||
                    compareSemver(latestVersion, connectedVersion) > 0)
            )
            this.#state.setValue('firmware', {
                latestVersion,
                latestName: String(release.name || ''),
                manifestUrl: String(release.manifestUrl || ''),
                imageUrl: String(release.imageUrl || ''),
                chipFamily: String(release.chipFamily || ''),
                updateAvailable,
                checking: false,
                status: firmwareStatus({
                    connected: snapshot.ble.connected,
                    connectedVersion,
                    latestVersion,
                    updateAvailable
                }),
                error: ''
            })
        } catch (error) {
            this.#state.setValue('firmware', {
                checking: false,
                status: 'Firmware release check failed',
                error: errorMessage(error)
            })
        }
    }

    /**
     * Rechecks latest release metadata and connected-device firmware state.
     * @returns {Promise<void>}
     */
    async #recheckFirmware() {
        await this.#loadLatestFirmwareRelease()
        const snapshot = this.#state.getSnapshot()
        if (!snapshot.ble.connected) return
        this.#state.setValue('firmware', {
            status: firmwareStatus({
                connected: true,
                connectedVersion: snapshot.firmware.connectedVersion,
                latestVersion: snapshot.firmware.latestVersion,
                updateAvailable: snapshot.firmware.updateAvailable
            })
        })
    }

    /**
     * Releases the active transport so ESP Web Tools can claim Web Serial.
     * @returns {Promise<boolean>}
     */
    async #prepareFirmwareInstall() {
        this.#cancelBleReconnect()
        this.#cancelUsbAutoConnect()
        this.#skipNextBleReconnect = true
        this.#state.setValue('firmware', {
            installerReady: false,
            status: 'Releasing firmware serial port',
            error: ''
        })
        try {
            await this.#bleClient.disconnect()
        } catch (error) {
            this.#skipNextBleReconnect = false
            this.#state.setValue('firmware', {
                installerReady: false,
                status: 'Installer preparation failed',
                error: errorMessage(error)
            })
            return false
        }
        this.#state.patch({
            ble: {
                connected: false,
                connecting: false,
                deviceName: ''
            },
            firmware: {
                installerReady: true,
                status: 'Installer ready',
                error: ''
            }
        })
        return true
    }

    /**
     * Restores normal USB probing after ESP Web Tools releases or cancels serial.
     * @param {object} [_event]
     * @returns {void}
     */
    #resumeAfterFirmwareInstaller(_event = {}) {
        this.#skipNextBleReconnect = false
        this.#cancelBleReconnect()
        this.#cancelUsbAutoConnect()
        this.#state.patch({
            firmware: {
                installerReady: false,
                status: 'Reconnecting Neon Meter over USB',
                error: ''
            },
            sync: {
                status: 'Reconnecting Neon Meter',
                error: ''
            }
        })
        this.#scheduleUsbAutoConnect({
            allowDisconnected: true,
            force: true
        })
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

/**
 * Returns the soonest positive reset minute from a provider bundle.
 * @param {unknown} payload
 * @returns {number | null}
 */
function nextResetMinutes(payload) {
    if (!payload || typeof payload !== 'object') return null
    const providers = Array.isArray(payload.providers) ? payload.providers : []
    const resetMinutes = providers.flatMap((provider) => [
        provider?.sr,
        provider?.wr
    ])
    const futureResets = resetMinutes
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)

    if (futureResets.length === 0) return null
    return Math.min(...futureResets)
}

/**
 * Returns user-facing firmware status text.
 * @param {{ connected?: boolean, connectedVersion?: string, latestVersion?: string, updateAvailable?: boolean }} state
 * @returns {string}
 */
function firmwareStatus(state) {
    if (!state.latestVersion) return 'Firmware release not checked'
    if (!state.connected) return 'Connect a device to check firmware'
    if (!state.connectedVersion) return 'Connected firmware version unknown'
    return state.updateAvailable ? 'Update available' : 'Firmware up to date'
}
