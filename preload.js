const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig:   () => ipcRenderer.invoke('get-config'),
  openFile:    () => ipcRenderer.invoke('open-file'),
  winMinimize: () => ipcRenderer.invoke('win-minimize'),
  winMaximize: () => ipcRenderer.invoke('win-maximize'),
  winClose:    () => ipcRenderer.invoke('win-close'),
})
