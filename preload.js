const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig:   () => ipcRenderer.invoke('get-config'),
  getVersion:  () => ipcRenderer.invoke('get-version'),
  openFile:    () => ipcRenderer.invoke('open-file'),
  winMinimize: () => ipcRenderer.invoke('win-minimize'),
  winMaximize: () => ipcRenderer.invoke('win-maximize'),
  winClose:    () => ipcRenderer.invoke('win-close'),
  copyImage:   (bytes) => ipcRenderer.invoke('copy-image', bytes),
  saveConfig:  (cfg)   => ipcRenderer.invoke('save-config', cfg),
})
