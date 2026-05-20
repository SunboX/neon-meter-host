/**
 * DOM rendering and event binding for the Neon Meter window.
 */
export class AppView {
    #document
    #bleDeviceReject = null
    #firmwareInstallerReady = false
    #firmwareInstallPreparing = false
    #firmwareInstallBypass = false

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
        this.#renderFirmware(snapshot)

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
     * Binds firmware installer preparation.
     * @param {() => void} callback
     * @returns {void}
     */
    bindFirmwareInstallPrepare(callback) {
        this.#button('#firmwarePrepareButton')?.addEventListener(
            'click',
            callback
        )
    }

    /**
     * Binds firmware installation with automatic port release before opening.
     * @param {() => boolean | Promise<boolean>} callback
     * @returns {void}
     */
    bindFirmwareInstall(callback) {
        const button = this.#button('#firmwareInstallButton')
        if (!button) return
        button.addEventListener('click', async (event) => {
            if (this.#firmwareInstallBypass || this.#firmwareInstallerReady) {
                this.#firmwareInstallBypass = false
                return
            }
            event.preventDefault?.()
            event.stopPropagation?.()
            event.stopImmediatePropagation?.()
            if (this.#firmwareInstallPreparing) return

            this.#firmwareInstallPreparing = true
            button.disabled = true
            button.textContent = 'Preparing installer'
            const prepared = await callback()
            this.#firmwareInstallPreparing = false
            if (prepared === false) {
                button.disabled = false
                button.textContent = 'Install or update'
                return
            }

            this.#firmwareInstallerReady = true
            button.disabled = false
            button.textContent = 'Install or update'
            this.#firmwareInstallBypass = true
            button.click()
        })
    }

    /**
     * Binds firmware status recheck.
     * @param {() => void} callback
     * @returns {void}
     */
    bindFirmwareRecheck(callback) {
        this.#button('#firmwareRecheckButton')?.addEventListener(
            'click',
            callback
        )
    }

    /**
     * Binds ESP Web Tools dialog closure so normal device sync can resume.
     * @param {(event: { reason: string, state: string }) => void} callback
     * @returns {void}
     */
    bindFirmwareInstallerClosed(callback) {
        this.#document.addEventListener?.('closed', (event) => {
            if (!isEspWebToolsDialog(event.target)) return
            callback({
                reason: 'closed',
                state: String(event.target.getAttribute?.('state') || '')
            })
        })
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
     * Opens the BLE device chooser and resolves the selected device.
     * @param {Array<{ id?: string, name?: string, rssi?: number }>} devices
     * @returns {Promise<{ id: string, name: string }>}
     */
    chooseBleDevice(devices) {
        const candidates = normalizeBleCandidates(devices)
        if (candidates.length === 0) {
            return Promise.reject(new Error('No BLE devices available'))
        }

        const dialog = this.#dialog('#bleDeviceDialog')
        const list = this.#document.querySelector('#bleDeviceList')
        const cancelButton = this.#button('#bleDeviceCancelButton')
        if (!dialog || !list || !cancelButton) {
            return Promise.reject(
                new Error('BLE device chooser is unavailable')
            )
        }

        this.#bleDeviceReject?.(new Error('BLE device selection cancelled'))

        return new Promise((resolve, reject) => {
            const closeChooser = () => {
                cancelButton.removeEventListener?.('click', cancelSelection)
                dialog.removeEventListener?.('cancel', cancelDialog)
                list.replaceChildren()
                this.#bleDeviceReject = null
                if (dialog.open && typeof dialog.close === 'function') {
                    dialog.close()
                } else {
                    dialog.removeAttribute('open')
                }
            }
            const selectDevice = (device) => {
                closeChooser()
                resolve({
                    id: device.id,
                    name: device.name
                })
            }
            const cancelSelection = () => {
                closeChooser()
                reject(new Error('BLE device selection cancelled'))
            }
            const cancelDialog = (event) => {
                event.preventDefault()
                cancelSelection()
            }

            this.#bleDeviceReject = reject
            list.replaceChildren(
                ...candidates.map((device) =>
                    this.#bleDeviceOption(device, () => selectDevice(device))
                )
            )
            cancelButton.addEventListener('click', cancelSelection)
            dialog.addEventListener?.('cancel', cancelDialog)

            if (typeof dialog.showModal === 'function') {
                dialog.showModal()
            } else {
                dialog.setAttribute('open', '')
            }
        })
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

    /**
     * Renders firmware version and installer status.
     * @param {{ ble?: object, firmware?: object }} snapshot
     * @returns {void}
     */
    #renderFirmware(snapshot) {
        const firmware = snapshot.firmware || {}
        this.#firmwareInstallerReady = Boolean(firmware.installerReady)
        this.#setText(
            '#firmwareConnectedVersion',
            firmware.connectedVersion
                ? 'v' + firmware.connectedVersion
                : 'Unknown'
        )
        this.#setText(
            '#firmwareLatestVersion',
            firmware.latestVersion ? 'v' + firmware.latestVersion : 'Unknown'
        )
        this.#setText(
            '#firmwareChipFamily',
            firmware.chipFamily ||
                firmware.connectedChipFamily ||
                'M5Stack CoreS3'
        )
        this.#setText(
            '#firmwareStatus',
            firmware.status || firmwareStatusText(snapshot)
        )
        this.#setText('#firmwareError', firmware.error || '')
        this.#setDisabled(
            '#firmwarePrepareButton',
            Boolean(firmware.checking || firmware.installerReady)
        )
        this.#setDisabled(
            '#firmwareInstallButton',
            Boolean(firmware.checking || this.#firmwareInstallPreparing)
        )
        this.#setText(
            '#firmwareInstallButton',
            this.#firmwareInstallPreparing
                ? 'Preparing installer'
                : 'Install or update'
        )
        this.#setText(
            '#firmwarePrepareButton',
            firmware.installerReady ? 'Installer ready' : 'Prepare installer'
        )
        this.#setDisabled('#firmwareRecheckButton', Boolean(firmware.checking))
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

    #bleDeviceOption(device, onSelect) {
        const button = this.#document.createElement('button')
        button.type = 'button'
        button.className = 'ble-device-option'

        const name = this.#document.createElement('strong')
        name.textContent = device.name || 'Neon Meter'

        const identifier = this.#document.createElement('span')
        identifier.textContent = 'Identifier: ' + (device.id || 'Unavailable')

        const rssi = this.#document.createElement('span')
        rssi.textContent = formatRssi(device.rssi)

        button.append(name, identifier, rssi)
        button.addEventListener('click', onSelect)
        return button
    }
}

/**
 * Returns BLE candidates with safe display fields.
 * @param {unknown} devices
 * @returns {Array<{ id: string, name: string, rssi?: number }>}
 */
function normalizeBleCandidates(devices) {
    if (!Array.isArray(devices)) return []
    return devices.map((device) => {
        const rssi = Number(device?.rssi)
        return {
            id: String(device?.id || ''),
            name: String(device?.name || 'Neon Meter'),
            ...(Number.isFinite(rssi) ? { rssi } : {})
        }
    })
}

/**
 * Formats an optional RSSI value.
 * @param {unknown} value
 * @returns {string}
 */
function formatRssi(value) {
    const rssi = Number(value)
    return Number.isFinite(rssi)
        ? 'RSSI: ' + String(rssi) + ' dBm'
        : 'RSSI unavailable'
}

/**
 * Returns fallback firmware status copy from state fields.
 * @param {{ ble?: object, firmware?: object }} snapshot
 * @returns {string}
 */
function firmwareStatusText(snapshot) {
    const firmware = snapshot.firmware || {}
    if (firmware.checking) return 'Checking firmware release'
    if (!snapshot.ble?.connected) return 'Connect a device to check firmware'
    if (!firmware.connectedVersion) return 'Connected firmware version unknown'
    if (firmware.updateAvailable) return 'Update available'
    return 'Firmware up to date'
}

/**
 * Checks whether an event came from the ESP Web Tools install dialog.
 * @param {unknown} target
 * @returns {boolean}
 */
function isEspWebToolsDialog(target) {
    if (!target || typeof target !== 'object') return false
    const element = /** @type {{ localName?: string, tagName?: string }} */ (
        target
    )
    return (
        String(element.localName || '').toLowerCase() ===
            'ewt-install-dialog' ||
        String(element.tagName || '').toLowerCase() === 'ewt-install-dialog'
    )
}
