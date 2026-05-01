const { app, BrowserWindow, ipcMain, dialog, clipboard, nativeImage, shell } = require('electron')
const path = require('path')
const fs   = require('fs')
const { autoUpdater } = require('electron-updater')

const DEFAULTS = {
  speeds: [0.75, 1.0, 1.25, 1.5, 2.0],
  jumpSeconds: 15,
  defaultVolume: 70,
  autoPlay: false,
  resumeAfterCrop: false,
  autoCheckUpdate: true,
}

function getConfigPath() {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'config.json')
    : path.join(__dirname, 'config.json')
}

function readConfig() {
  const configPath = getConfigPath()
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  } catch {
    if (app.isPackaged) {
      try {
        const bundled = path.join(process.resourcesPath, 'default-config.json')
        return JSON.parse(fs.readFileSync(bundled, 'utf-8'))
      } catch { /* ignore */ }
    }
    return DEFAULTS
  }
}

// ── Auto-updater ───────────────────────────────────────────────
autoUpdater.autoDownload         = false
autoUpdater.autoInstallOnAppQuit = false
autoUpdater.logger               = null
// Prevent CDN from returning a cached latest.yml that lags behind the real release
autoUpdater.requestHeaders       = { 'Cache-Control': 'no-cache' }

function sendUpdateStatus(status) {
  mainWin?.webContents.send('update-status', status)
}

autoUpdater.on('checking-for-update',  ()     => sendUpdateStatus({ state: 'checking' }))
autoUpdater.on('update-available',     (info) => sendUpdateStatus({ state: 'available', version: info.version }))
autoUpdater.on('update-not-available', (info) => sendUpdateStatus({ state: 'up-to-date', latestVersion: info?.version }))
autoUpdater.on('download-progress',    (p)    => sendUpdateStatus({ state: 'downloading', percent: Math.round(p.percent) }))
autoUpdater.on('update-downloaded',    ()     => sendUpdateStatus({ state: 'downloaded' }))
autoUpdater.on('error',                (err)  => sendUpdateStatus({ state: 'error', message: err.message }))

// ── File arg helpers ───────────────────────────────────────────
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'flv', 'wmv'])

function findFileArg(argv) {
  // argv[0] is the executable; skip flags (--xxx)
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-')) continue
    const ext = arg.split('.').pop().toLowerCase()
    if (VIDEO_EXTS.has(ext)) return arg
  }
  return null
}

// ── Window ─────────────────────────────────────────────────────
let mainWin = null
let pendingFileArg = null

function createWindow() {
  mainWin = new BrowserWindow({
    width: 900, height: 600, minWidth: 640, minHeight: 400,
    backgroundColor: '#0f0c29', frame: false,
    icon: app.isPackaged ? undefined : path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true,
    },
  })
  mainWin.loadFile('renderer/index.html')
  // Send pending file arg once the renderer is ready
  mainWin.webContents.once('did-finish-load', () => {
    if (pendingFileArg) {
      mainWin.webContents.send('open-file-arg', pendingFileArg)
      pendingFileArg = null
    }
  })
}

app.whenReady().then(() => {
  pendingFileArg = findFileArg(process.argv)
  createWindow()
  // Auto-check for updates after window is ready (3s delay)
  if (app.isPackaged) {
    setTimeout(() => {
      try {
        if (readConfig().autoCheckUpdate !== false) autoUpdater.checkForUpdates()
      } catch { /* ignore */ }
    }, 3000)
  }
})
app.on('window-all-closed', () => app.quit())

// ── IPC handlers ───────────────────────────────────────────────
ipcMain.handle('get-config',  () => readConfig())
ipcMain.handle('get-version', () => app.getVersion())

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

ipcMain.handle('copy-text', (event, text) => {
  clipboard.writeText(String(text))
  return { ok: true }
})

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

ipcMain.handle('check-update', async () => {
  if (!app.isPackaged) {
    sendUpdateStatus({ state: 'error', message: '開發模式無法檢查更新' })
    return { ok: true }
  }
  try {
    const p = autoUpdater.checkForUpdates()
    if (p && typeof p.catch === 'function') {
      p.catch(err => sendUpdateStatus({ state: 'error', message: err.message }))
    }
  } catch (err) {
    sendUpdateStatus({ state: 'error', message: err.message })
  }
  return { ok: true }
})

ipcMain.handle('download-update', () => {
  autoUpdater.downloadUpdate()
})

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall()
})

ipcMain.handle('open-default-apps-settings', async () => {
  if (process.platform === 'darwin') {
    return { platform: 'mac' }
  }
  await shell.openExternal('ms-settings:defaultapps')
  return { platform: 'win' }
})

ipcMain.handle('list-folder-videos', (event, folderPath) => {
  try {
    const exts = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'flv', 'wmv'])
    return fs.readdirSync(folderPath, { withFileTypes: true })
      .filter(e => e.isFile() && exts.has(path.extname(e.name).slice(1).toLowerCase()))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
      .map(name => path.join(folderPath, name))
  } catch {
    return []
  }
})
