const { app, BrowserWindow, ipcMain, dialog, clipboard, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')

function readConfig() {
  const configPath = path.join(__dirname, 'config.json')
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  } catch {
    return { speeds: [0.5, 1.0, 1.5, 2.0], jumpSeconds: 10, defaultVolume: 70, autoPlay: true }
  }
}

let mainWin = null

function createWindow() {
  mainWin = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 640,
    minHeight: 400,
    backgroundColor: '#0f0c29',
    frame: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  mainWin.loadFile('renderer/index.html')
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())

ipcMain.handle('get-config', () => readConfig())

ipcMain.handle('open-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv'] }],
  })
  return canceled ? null : filePaths[0]
})

ipcMain.handle('win-minimize', () => mainWin.minimize())
ipcMain.handle('win-maximize', () => { mainWin.isMaximized() ? mainWin.unmaximize() : mainWin.maximize() })
ipcMain.handle('win-close',    () => mainWin.close())

ipcMain.handle('copy-image', (event, bytes) => {
  const img = nativeImage.createFromBuffer(Buffer.from(bytes))
  clipboard.writeImage(img)
})

ipcMain.handle('save-config', (event, newConfig) => {
  const configPath = path.join(__dirname, 'config.json')
  fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2))
})
