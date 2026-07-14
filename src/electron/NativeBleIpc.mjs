/**
 * Registers legacy-named IPC handlers for the main-process device transport.
 * @param {{ ipcMain: Electron.IpcMain, bleClient: EventTarget & { isSupported: () => boolean, canConnectWithoutRemembered?: () => boolean, connect: () => Promise<object>, connectSelected: (device: object) => Promise<object>, connectRemembered: (device: object) => Promise<object | null>, disconnect: () => void, writePayload: (payload: object) => Promise<void> }, getWebContents: () => Electron.WebContents[] }} dependencies
 * @returns {void}
 */
export function registerNativeBleIpc(dependencies) {
    const { ipcMain, bleClient, getWebContents } = dependencies

    ipcMain.on('ble:is-supported', (event) => {
        event.returnValue = bleClient.isSupported()
    })
    ipcMain.on('ble:can-connect-without-remembered', (event) => {
        event.returnValue = Boolean(bleClient.canConnectWithoutRemembered?.())
    })
    ipcMain.handle('ble:connect', () =>
        deviceOperation(() => bleClient.connect())
    )
    ipcMain.handle('ble:connect-selected', (_event, device) =>
        deviceOperation(() => bleClient.connectSelected(device))
    )
    ipcMain.handle('ble:connect-remembered', (_event, device) =>
        deviceOperation(() => bleClient.connectRemembered(device))
    )
    ipcMain.handle('ble:disconnect', () => bleClient.disconnect())
    ipcMain.handle('ble:write-payload', (_event, payload) =>
        bleClient.writePayload(payload)
    )

    for (const eventName of ['ack', 'refresh-requested', 'disconnected']) {
        bleClient.addEventListener(eventName, (event) => {
            broadcastBleEvent(getWebContents(), {
                type: eventName,
                detail: event.detail ?? null
            })
        })
    }
}

/**
 * Converts native connection failures into serializable IPC results.
 * @param {() => Promise<unknown>} callback
 * @returns {Promise<unknown>}
 */
async function deviceOperation(callback) {
    try {
        return await callback()
    } catch (error) {
        return {
            operationError: {
                code: String(error?.code || 'DEVICE_OPERATION_FAILED'),
                message:
                    error instanceof Error ? error.message : String(error),
                deviceId: String(error?.deviceId || ''),
                deviceName: String(error?.deviceName || '')
            }
        }
    }
}

/**
 * Sends one BLE event to all live renderer processes.
 * @param {Array<{ send: (channel: string, payload: object) => void, isDestroyed?: () => boolean }>} webContentsList
 * @param {{ type: string, detail: unknown }} payload
 * @returns {void}
 */
function broadcastBleEvent(webContentsList, payload) {
    for (const webContents of webContentsList || []) {
        if (webContents.isDestroyed?.()) continue
        webContents.send('ble:event', payload)
    }
}
