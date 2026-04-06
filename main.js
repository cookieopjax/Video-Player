const { app, BrowserWindow, ipcMain, dialog, clipboard, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')

const DEFAULTS = { speeds: [0.75, 1.0, 1.25, 1.5, 2.0], jumpSeconds: 15, defaultVolume: 70, autoPlay: false, resumeAfterCrop: false }

function getConfigPath() {
  // In packaged app, %APPDATA%\VideoPlayer\config.json (writable by user).
  // In dev, project-root config.json.
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'config.json')
    : path.join(__dirname, 'config.json')
}

function readConfig() {
  const configPath = getConfigPath()
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  } catch {
    // Packaged: try to seed from the bundled default-config.json
    if (app.isPackaged) {
      try {
        const bundled = path.join(process.resourcesPath, 'default-config.json')
        return JSON.parse(fs.readFileSync(bundled, 'utf-8'))
      } catch { /* ignore */ }
    }
    return DEFAULTS
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
    // Only load icon from file in dev; packaged exe has it embedded.
    icon: app.isPackaged ? undefined : path.join(__dirname, 'assets', 'icon.png'),
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
    filters: [{ name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'flv', 'wmv'] }],
  })
  return canceled ? null : filePaths[0]
})

ipcMain.handle('win-minimize', () => mainWin?.minimize())
ipcMain.handle('win-maximize', () => { mainWin?.isMaximized() ? mainWin.unmaximize() : mainWin?.maximize() })
ipcMain.handle('win-close',    () => mainWin?.close())

ipcMain.handle('copy-image', (event, bytes) => {
  try {
    const img = nativeImage.createFromBuffer(Buffer.from(bytes))
    if (img.isEmpty()) throw new Error('empty image')
    clipboard.writeImage(img)
    return { ok: true }
  } catch (err) {
    console.error('[copy-image]', err)
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('save-config', (event, newConfig) => {
  try {
    const configPath = getConfigPath()
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2))
    return { ok: true }
  } catch (err) {
    console.error('[save-config]', err)
    return { ok: false, error: err.message }
  }
})
