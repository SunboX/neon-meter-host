const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('aiMeterHost', {
    getAppMeta: () => ipcRenderer.invoke('app:meta'),
    loadSettings: () => ipcRenderer.invoke('settings:load'),
    saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
    fetchProviderBundle: (settings) =>
        ipcRenderer.invoke('provider:fetch-bundle', settings)
})
