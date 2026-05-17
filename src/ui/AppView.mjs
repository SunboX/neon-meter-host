/**
 * DOM rendering and event binding for the Neon Meter window.
 */
export class AppView {
    #document

    /**
     * @param {Document} documentRef
     */
    constructor(documentRef) {
        this.#document = documentRef
    }

    /**
     * Renders state into the dashboard.
     * @param {{ provider: string, locale: string, settings: object, ble: object, sync: object, payload: object | null }} snapshot
     * @returns {void}
     */
    render(snapshot) {
        this.#setText(
            '#bleState',
            snapshot.ble.connected ? 'Connected' : 'Disconnected'
        )
        this.#setText(
            '#bleDevice',
            snapshot.ble.deviceName || 'Neon Meter CoreS3'
        )
        this.#setText('#syncStatus', snapshot.sync.status || 'Ready')
        this.#setHidden(
            '#syncLoader',
            !snapshot.ble.connecting && !snapshot.sync.running
        )
        this.#setText('#syncError', snapshot.sync.error || '')
        this.#setText('#lastSync', snapshot.sync.lastSync || 'Never')
        this.#setText(
            '#payloadPreview',
            snapshot.payload ? JSON.stringify(snapshot.payload) : '{}'
        )

        this.#setValue('#localeSelect', snapshot.locale)
        this.#setChecked('#autoSyncInput', snapshot.settings.autoSync !== false)
        this.#setChecked('#startAtLoginInput', snapshot.settings.startAtLogin)
        this.#setChecked('#startHiddenInput', snapshot.settings.startHidden)
        this.#setChecked(
            '#autoConnectBleInput',
            snapshot.settings.autoConnectBle !== false
        )
        this.#setValue(
            '#syncIntervalInput',
            snapshot.settings.syncIntervalMinutes
        )
        this.#setValue(
            '#rotationSecondsInput',
            snapshot.settings.rotationSeconds
        )
        this.#setText('#providerSummary', 'Auto-detect providers')
        this.#setText(
            '#daemonSummary',
            snapshot.settings.autoSync === false
                ? 'Manual sync'
                : 'Every ' +
                      String(snapshot.settings.syncIntervalMinutes || 5) +
                      ' minutes / rotate ' +
                      String(snapshot.settings.rotationSeconds || 30) +
                      ' seconds' +
                      (snapshot.settings.startAtLogin
                          ? ' / start at login'
                          : '') +
                      (snapshot.settings.startHidden ? ' / start hidden' : '')
        )
        this.#setText(
            '#bleAutomationSummary',
            snapshot.settings.autoConnectBle === false
                ? 'Manual connection'
                : snapshot.settings.rememberedBleDeviceName
                  ? 'Auto-connect ' + snapshot.settings.rememberedBleDeviceName
                  : 'Auto-connect USB or latest BLE'
        )

        this.#setDisabled(
            '#connectButton',
            snapshot.ble.connected ||
                snapshot.ble.connecting ||
                !snapshot.ble.supported
        )
        this.#setText(
            '#connectButton',
            snapshot.ble.connecting ? 'Connecting' : 'Connect'
        )
        this.#setDisabled(
            '#disconnectButton',
            !snapshot.ble.connected || snapshot.ble.connecting
        )
        this.#setDisabled(
            '#syncButton',
            snapshot.sync.running || snapshot.ble.connecting
        )
    }

    /**
     * Renders app version.
     * @param {string} version
     * @returns {void}
     */
    setVersion(version) {
        this.#setText('#appVersion', version ? 'v' + version : 'v—')
    }

    /**
     * Binds connect button.
     * @param {() => void} callback
     * @returns {void}
     */
    bindConnect(callback) {
        this.#button('#connectButton')?.addEventListener('click', callback)
    }

    /**
     * Binds disconnect button.
     * @param {() => void} callback
     * @returns {void}
     */
    bindDisconnect(callback) {
        this.#button('#disconnectButton')?.addEventListener('click', callback)
    }

    /**
     * Binds the immediate sync button.
     * @param {() => void} callback
     * @returns {void}
     */
    bindSyncNow(callback) {
        this.#button('#syncButton')?.addEventListener('click', callback)
    }

    /**
     * Binds the settings dialog open button.
     * @param {() => void} callback
     * @returns {void}
     */
    bindSettingsOpen(callback) {
        this.#button('#settingsButton')?.addEventListener('click', callback)
        this.#button('#settingsPanelButton')?.addEventListener(
            'click',
            callback
        )
    }

    /**
     * Binds settings dialog cancellation.
     * @param {() => void} callback
     * @returns {void}
     */
    bindSettingsCancel(callback) {
        this.#button('#settingsCancelButton')?.addEventListener(
            'click',
            callback
        )
    }

    /**
     * Binds settings dialog save.
     * @param {(settings: object) => void} callback
     * @returns {void}
     */
    bindSettingsSave(callback) {
        this.#document
            .querySelector('#settingsForm')
            ?.addEventListener('submit', (event) => {
                event.preventDefault()
                callback(this.collectSettings())
            })
    }

    /**
     * Opens the settings dialog.
     * @returns {void}
     */
    openSettingsDialog() {
        const dialog = this.#dialog('#settingsDialog')
        if (!dialog || dialog.open) return
        if (typeof dialog.showModal === 'function') {
            dialog.showModal()
        } else {
            dialog.setAttribute('open', '')
        }
        this.#input('#localeSelect')?.focus()
    }

    /**
     * Closes the settings dialog.
     * @returns {void}
     */
    closeSettingsDialog() {
        const dialog = this.#dialog('#settingsDialog')
        if (!dialog) return
        if (dialog.open && typeof dialog.close === 'function') {
            dialog.close()
        } else {
            dialog.removeAttribute('open')
        }
    }

    /**
     * Returns current form settings.
     * @returns {object}
     */
    collectSettings() {
        return {
            locale: this.#value('#localeSelect') || 'en',
            autoSync: this.#checked('#autoSyncInput'),
            startAtLogin: this.#checked('#startAtLoginInput'),
            startHidden: this.#checked('#startHiddenInput'),
            autoConnectBle: this.#checked('#autoConnectBleInput'),
            syncIntervalMinutes: this.#number('#syncIntervalInput'),
            rotationSeconds: this.#number('#rotationSecondsInput')
        }
    }

    #button(selector) {
        return /** @type {HTMLButtonElement | null} */ (
            this.#document.querySelector(selector)
        )
    }

    #input(selector) {
        return /** @type {HTMLInputElement | HTMLSelectElement | null} */ (
            this.#document.querySelector(selector)
        )
    }

    #dialog(selector) {
        return /** @type {HTMLDialogElement | null} */ (
            this.#document.querySelector(selector)
        )
    }

    #setText(selector, value) {
        const node = this.#document.querySelector(selector)
        if (node) node.textContent = String(value)
    }

    #setValue(selector, value) {
        const node = this.#input(selector)
        if (node && node.value !== String(value ?? '')) {
            node.value = String(value ?? '')
        }
    }

    #setChecked(selector, value) {
        const node = /** @type {HTMLInputElement | null} */ (
            this.#document.querySelector(selector)
        )
        if (node) node.checked = Boolean(value)
    }

    #setDisabled(selector, value) {
        const node = this.#button(selector)
        if (node) node.disabled = Boolean(value)
    }

    #setHidden(selector, value) {
        const node = this.#document.querySelector(selector)
        if (node) node.hidden = Boolean(value)
    }

    #value(selector) {
        return String(this.#input(selector)?.value || '').trim()
    }

    #number(selector) {
        const value = Number(this.#input(selector)?.value)
        return Number.isFinite(value) ? value : 0
    }

    #checked(selector) {
        return Boolean(
            /** @type {HTMLInputElement | null} */ (
                this.#document.querySelector(selector)
            )?.checked
        )
    }
}
