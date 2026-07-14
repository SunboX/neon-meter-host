const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('aiMeterHost', {
    getAppMeta: () => ipcRenderer.invoke('app:meta'),
    loadSettings: () => ipcRenderer.invoke('settings:load'),
    saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
    fetchProviderBundle: (settings) =>
        ipcRenderer.invoke('provider:fetch-bundle', settings),
    fetchLatestFirmwareRelease: () =>
        ipcRenderer.invoke('firmware:latest-release'),
    openBluetoothSettings: () => ipcRenderer.invoke('bluetooth:open-settings'),
    onFirmwareInstallerEvent: (callback) => {
        const listener = (_event, payload) => callback(payload)
        ipcRenderer.on('firmware:installer-event', listener)
        return () =>
            ipcRenderer.removeListener('firmware:installer-event', listener)
    },
    isBleSupported: () => ipcRenderer.sendSync('ble:is-supported'),
    canConnectWithoutRemembered: () =>
        ipcRenderer.sendSync('ble:can-connect-without-remembered'),
    bleConnect: () => ipcRenderer.invoke('ble:connect'),
    bleConnectSelected: (device) =>
        ipcRenderer.invoke('ble:connect-selected', device),
    bleConnectRemembered: (device) =>
        ipcRenderer.invoke('ble:connect-remembered', device),
    bleDisconnect: () => ipcRenderer.invoke('ble:disconnect'),
    bleWritePayload: (payload) =>
        ipcRenderer.invoke('ble:write-payload', payload),
    bleRepairPairing: () => ipcRenderer.invoke('ble:repair-pairing'),
    onBleEvent: (callback) => {
        const listener = (_event, payload) => callback(payload)
        ipcRenderer.on('ble:event', listener)
        return () => ipcRenderer.removeListener('ble:event', listener)
    }
})
