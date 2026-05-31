import path from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildProviderBundlePayload } from '../core/ProviderBundle.mjs'
import { ChatGptUsageProvider } from '../providers/ChatGptUsageProvider.mjs'
import { ClaudeCodeUsageProvider } from '../providers/ClaudeCodeUsageProvider.mjs'
import {
    getAutostartStatus,
    setAutostartEnabled
} from './AutostartSettings.mjs'
import { createBluetoothDeviceSelector } from './BluetoothDeviceSelector.mjs'
import { NativeNobleAiMeterClient } from '../ble/NativeNobleAiMeterClient.mjs'
import { NativeUsbSerialAiMeterClient } from '../usb/NativeUsbSerialAiMeterClient.mjs'
import { PreferredAiMeterClient } from '../transport/PreferredAiMeterClient.mjs'
import { registerNativeBleIpc } from './NativeBleIpc.mjs'
import { createProviderCredentialResolver } from './ProviderCredentials.mjs'
import { fetchLatestFirmwareRelease } from '../firmware/FirmwareReleaseClient.mjs'

const require = createRequire(import.meta.url)
const electron = require('electron')
const {
    app,
    BrowserWindow,
    Menu,
    Tray,
    dialog,
    ipcMain,
    nativeImage,
    session
} = electron
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.join(__dirname, '..', '..')
const APP_NAME = 'Neon Meter'
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

app.setName(APP_NAME)

/** @type {BrowserWindow | null} */
let mainWindow = null

/** @type {Tray | null} */
let tray = null

let isQuitting = false

const credentialResolver = createProviderCredentialResolver()
const usbClient = new NativeUsbSerialAiMeterClient()
const bleClient = new NativeNobleAiMeterClient()
const deviceClient = new PreferredAiMeterClient({ usbClient, bleClient })

/**
 * Creates the main Electron window.
 * @param {{ startHidden?: boolean }} [options]
 * @returns {BrowserWindow}
 */
function createWindow(options = {}) {
    const startHidden = Boolean(options.startHidden)
    const window = new BrowserWindow({
        width: 1040,
        height: 760,
        minWidth: 860,
        minHeight: 620,
        title: APP_NAME,
        backgroundColor: '#050914',
        icon: getIconPath('neon-meter-icon.png'),
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            backgroundThrottling: false,
            experimentalFeatures: true
        }
    })

    window.loadFile(path.join(projectRoot, 'src', 'index.html'))
    window.once('ready-to-show', () => {
        if (startHidden) {
            hideMainWindow()
            return
        }
        showMainWindow()
    })
    window.on('close', (event) => {
        if (isQuitting) return
        event.preventDefault()
        hideMainWindow()
    })
    window.on('show', () => updateTrayMenu())
    window.on('hide', () => updateTrayMenu())
    return window
}

/**
 * Creates a minimal tray entry for app visibility and explicit quitting.
 * @returns {void}
 */
function createTray() {
    const trayIcon = createTrayIcon()

    tray = new Tray(trayIcon)
    tray.setToolTip(APP_NAME)
    updateTrayMenu()
}

/**
 * Rebuilds the tray menu for the current window visibility.
 * @returns {void}
 */
function updateTrayMenu() {
    if (!tray) return
    tray.setContextMenu(
        Menu.buildFromTemplate([
            {
                label: mainWindow?.isVisible()
                    ? 'Hide Neon Meter'
                    : 'Show Neon Meter',
                click: () =>
                    mainWindow?.isVisible()
                        ? hideMainWindow()
                        : showMainWindow()
            },
            {
                label: 'Quit',
                click: () => {
                    app.quit()
                }
            }
        ])
    )
}

/**
 * Shows the main window and restores the macOS Dock icon.
 * @returns {void}
 */
function showMainWindow() {
    if (!mainWindow) {
        mainWindow = createWindow()
    }
    if (app.dock) {
        app.dock.show()
    }
    mainWindow.show()
    mainWindow.focus()
    updateTrayMenu()
}

/**
 * Hides the main window and removes the macOS Dock icon.
 * @returns {void}
 */
function hideMainWindow() {
    mainWindow?.hide()
    if (app.dock) {
        app.dock.hide()
    }
    updateTrayMenu()
}

/**
 * Creates the tray icon, using a macOS template image for menu bar contrast.
 * @returns {Electron.NativeImage}
 */
function createTrayIcon() {
    const trayIcon = nativeImage.createFromPath(
        getIconPath(
            process.platform === 'darwin'
                ? 'neon-meter-tray-template.png'
                : 'neon-meter-tray.png'
        )
    )

    if (process.platform === 'darwin') {
        trayIcon.setTemplateImage(true)
    }

    return trayIcon
}

/**
 * Resolves project-local app icon assets.
 * @param {string} fileName
 * @returns {string}
 */
function getIconPath(fileName) {
    return path.join(projectRoot, 'src', 'assets', fileName)
}

/**
 * Installs Web Bluetooth permission and selection handlers.
 * @returns {void}
 */
function installBluetoothHandlers() {
    const selectBluetoothDevice = createBluetoothDeviceSelector({
        chooseDevice: chooseBluetoothDevice
    })

    session.defaultSession.setPermissionRequestHandler(
        (_webContents, permission, callback) => {
            callback(
                permission === 'bluetooth' || permission === 'bluetoothScanning'
            )
        }
    )

    app.on('web-contents-created', (_event, contents) => {
        contents.on(
            'select-bluetooth-device',
            (event, deviceList, callback) => {
                selectBluetoothDevice(event, deviceList, callback)
            }
        )
    })
}

/**
 * Installs Web Serial handlers for the embedded firmware installer.
 * @returns {void}
 */
function installSerialHandlers() {
    session.defaultSession.setDevicePermissionHandler((details) => {
        return details.deviceType === 'serial'
    })
    session.defaultSession.on(
        'select-serial-port',
        (selectEvent, portList, webContents, callback) => {
            selectEvent.preventDefault()
            void chooseSerialPort(portList)
                .then((port) => {
                    if (!port) {
                        notifyFirmwareInstallerEvent(webContents, {
                            type: 'serial-canceled'
                        })
                    }
                    callback(port?.portId || '')
                })
                .catch(() => {
                    notifyFirmwareInstallerEvent(webContents, {
                        type: 'serial-canceled'
                    })
                    callback('')
                })
        }
    )
}

/**
 * Sends firmware installer lifecycle events to the renderer.
 * @param {{ send?: (channel: string, payload: object) => void } | null} webContents
 * @param {object} payload
 * @returns {void}
 */
function notifyFirmwareInstallerEvent(webContents, payload) {
    webContents?.send?.('firmware:installer-event', payload)
}

/**
 * Lets the operator choose a serial port for ESP Web Tools.
 * @param {Array<{ portId?: string, portName?: string, displayName?: string, vendorId?: string, productId?: string }>} ports
 * @returns {Promise<object | null>}
 */
async function chooseSerialPort(ports) {
    const candidates = Array.isArray(ports) ? ports : []
    const buttons = candidates.map(formatSerialPortButton).concat('Cancel')
    const options = {
        type: 'question',
        title: 'Select firmware serial port',
        message: 'Select the CoreS3 USB serial port for firmware installation.',
        detail: 'Choose the Espressif or M5Stack serial device exposed by the connected meter.',
        buttons,
        cancelId: buttons.length - 1,
        defaultId: 0,
        noLink: true
    }
    const result = mainWindow
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options)
    return result.response >= 0 && result.response < candidates.length
        ? candidates[result.response]
        : null
}

/**
 * Formats one Web Serial chooser button.
 * @param {{ portName?: string, displayName?: string, vendorId?: string, productId?: string }} port
 * @returns {string}
 */
function formatSerialPortButton(port) {
    return [
        String(port.displayName || port.portName || 'Serial device'),
        'VID: ' + String(port.vendorId || 'unknown'),
        'PID: ' + String(port.productId || 'unknown')
    ].join(' | ')
}

/**
 * Lets the operator choose from visible Web Bluetooth devices.
 * @param {Array<{ id: string, name: string, rssi?: number }>} devices
 * @returns {Promise<object | null>}
 */
async function chooseBluetoothDevice(devices) {
    const buttons = devices.map(formatBluetoothDeviceButton).concat('Cancel')
    const options = {
        type: 'question',
        title: 'Select Neon Meter',
        message: 'Select the Bluetooth device to connect.',
        detail: 'Choose the meter by local BLE identifier. RSSI is shown when Electron exposes it.',
        buttons,
        cancelId: buttons.length - 1,
        defaultId: 0,
        noLink: true
    }
    const result = mainWindow
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options)
    return result.response >= 0 && result.response < devices.length
        ? devices[result.response]
        : null
}

/**
 * Formats one Web Bluetooth chooser button.
 * @param {{ id?: string, name?: string, rssi?: number }} device
 * @returns {string}
 */
function formatBluetoothDeviceButton(device) {
    return [
        String(device.name || 'Unnamed BLE device'),
        'ID: ' + String(device.id || 'Unavailable'),
        formatBluetoothRssi(device.rssi)
    ].join(' | ')
}

/**
 * Formats optional Bluetooth RSSI metadata.
 * @param {unknown} value
 * @returns {string}
 */
function formatBluetoothRssi(value) {
    const rssi = Number(value)
    return Number.isFinite(rssi)
        ? 'RSSI: ' + String(rssi) + ' dBm'
        : 'RSSI unavailable'
}

/**
 * Registers IPC handlers used by the preload bridge.
 * @returns {void}
 */
function registerIpc() {
    ipcMain.handle('app:meta', async () => {
        return {
            version: app.getVersion(),
            autostart: await getAutostartStatus(getAutostartOptions()),
            credentialStatus: await credentialResolver.getStatus()
        }
    })

    ipcMain.handle('settings:load', async () => readSettings())
    ipcMain.handle('settings:save', async (_event, settings) =>
        writeSettings(settings)
    )

    ipcMain.handle('provider:fetch-bundle', async (_event, settings) => {
        return fetchProviderBundle(settings)
    })
    ipcMain.handle('firmware:latest-release', async () => {
        return fetchLatestFirmwareRelease()
    })

    registerNativeBleIpc({
        ipcMain,
        bleClient: deviceClient,
        getWebContents: () =>
            BrowserWindow.getAllWindows().map((window) => window.webContents)
    })
}

/**
 * Fetches a firmware provider bundle for all detected providers.
 * @param {unknown} settings
 * @returns {Promise<object>}
 */
async function fetchProviderBundle(settings) {
    const status = await credentialResolver.getStatus()
    const payloads = await Promise.all(
        [
            status.claude.configured ? fetchClaudePayload() : null,
            status.chatgpt.configured ? fetchChatGptPayload() : null
        ].filter(Boolean)
    )
    return buildProviderBundlePayload(payloads, {
        rotationSeconds: settings?.rotationSeconds
    })
}

/**
 * Fetches Claude Code payload using local Claude credentials.
 * @returns {Promise<object>}
 */
async function fetchClaudePayload() {
    return new ClaudeCodeUsageProvider({
        token: await credentialResolver.getClaudeToken()
    }).fetchPayload()
}

/**
 * Fetches ChatGPT/Codex payload using local Codex auth.
 * @returns {Promise<object>}
 */
async function fetchChatGptPayload() {
    const credentials = await credentialResolver.getChatGptCredentials()
    return new ChatGptUsageProvider({
        accessToken: credentials.accessToken,
        accountId: credentials.accountId
    }).fetchPayload()
}

/**
 * Reads persisted renderer settings.
 * @returns {Promise<object>}
 */
async function readSettings() {
    try {
        return JSON.parse(await readFile(settingsFile(), 'utf8'))
    } catch (_error) {
        return {}
    }
}

/**
 * Writes persisted renderer settings.
 * @param {unknown} settings
 * @returns {Promise<object>}
 */
async function writeSettings(settings) {
    const safeSettings =
        settings && typeof settings === 'object' ? settings : {}
    if (typeof safeSettings.startAtLogin === 'boolean') {
        await setAutostartEnabled(
            safeSettings.startAtLogin,
            getAutostartOptions()
        )
    }
    await mkdir(path.dirname(settingsFile()), { recursive: true })
    await writeFile(
        settingsFile(),
        JSON.stringify(safeSettings, null, 2),
        'utf8'
    )
    return safeSettings
}

/**
 * Applies persisted launch-at-login state on app startup.
 * @param {object | null} [settings]
 * @returns {Promise<void>}
 */
async function applyPersistedAutostart(settings = null) {
    try {
        const safeSettings =
            settings && typeof settings === 'object'
                ? settings
                : await readSettings()
        if (typeof safeSettings.startAtLogin !== 'boolean') return
        await setAutostartEnabled(
            safeSettings.startAtLogin,
            getAutostartOptions()
        )
    } catch (error) {
        console.warn('Autostart setup failed:', error)
    }
}

/**
 * Returns platform launch metadata for OS autostart.
 * @returns {{ app: typeof app, executable: string, args: string[], icon: string }}
 */
function getAutostartOptions() {
    return {
        app,
        executable: process.execPath,
        args: process.defaultApp ? [app.getAppPath()] : [],
        icon: getIconPath('neon-meter-icon.png')
    }
}

registerIpc()

app.whenReady()
    .then(async () => {
        installBluetoothHandlers()
        installSerialHandlers()
        const settings = await readSettings()
        await applyPersistedAutostart(settings)
        return settings
    })
    .then((settings) => {
        if (app.dock) {
            app.dock.setIcon(
                nativeImage.createFromPath(getIconPath('neon-meter-icon.png'))
            )
            if (settings.startHidden === true) {
                app.dock.hide()
            }
        }
        mainWindow = createWindow({
            startHidden: settings.startHidden === true
        })
        createTray()
    })

app.on('activate', () => {
    showMainWindow()
})

app.on('before-quit', () => {
    isQuitting = true
    deviceClient.disconnect()
})

app.on('window-all-closed', () => {
    app.quit()
})
