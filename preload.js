const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig:      () => ipcRenderer.invoke('get-config'),
  getVersion:     () => ipcRenderer.invoke('get-version'),
  openFile:       () => ipcRenderer.invoke('open-file'),
  winMinimize:    () => ipcRenderer.invoke('win-minimize'),
  winMaximize:    () => ipcRenderer.invoke('win-maximize'),
  winClose:       () => ipcRenderer.invoke('win-close'),
  copyText:       (text)  => ipcRenderer.invoke('copy-text', text),
  copyImage:      (bytes) => ipcRenderer.invoke('copy-image', bytes),
  saveConfig:     (cfg)   => ipcRenderer.invoke('save-config', cfg),
  checkUpdate:    () => ipcRenderer.invoke('check-update'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate:  () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (cb) => {
    ipcRenderer.on('update-status', (_, status) => cb(status))
  },
  onConfigUpdated: (cb) => {
    const listener = (_, config) => cb(config)
    ipcRenderer.on('config-updated', listener)
    return () => ipcRenderer.removeListener('config-updated', listener)
  },
  onFileArg: (cb) => {
    ipcRenderer.on('open-file-arg', (_, filePath) => cb(filePath))
  },
  openDefaultAppsSettings: () => ipcRenderer.invoke('open-default-apps-settings'),
  listFolderVideos: (folderPath) => ipcRenderer.invoke('list-folder-videos', folderPath),
})
