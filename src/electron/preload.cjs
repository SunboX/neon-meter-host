const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('aiMeterHost', {
    getAppMeta: () => ipcRenderer.invoke('app:meta'),
    loadSettings: () => ipcRenderer.invoke('settings:load'),
    saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
    fetchProviderBundle: (settings) =>
        ipcRenderer.invoke('provider:fetch-bundle', settings),
    isBleSupported: () => ipcRenderer.sendSync('ble:is-supported'),
    canConnectWithoutRemembered: () =>
        ipcRenderer.sendSync('ble:can-connect-without-remembered'),
    bleConnect: () => ipcRenderer.invoke('ble:connect'),
    bleConnectRemembered: (device) =>
        ipcRenderer.invoke('ble:connect-remembered', device),
    bleDisconnect: () => ipcRenderer.invoke('ble:disconnect'),
    bleWritePayload: (payload) =>
        ipcRenderer.invoke('ble:write-payload', payload),
    onBleEvent: (callback) => {
        const listener = (_event, payload) => callback(payload)
        ipcRenderer.on('ble:event', listener)
        return () => ipcRenderer.removeListener('ble:event', listener)
    }
})
