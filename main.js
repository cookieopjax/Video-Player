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
autoUpdater.autoDownload    = false
autoUpdater.autoInstallOnAppQuit = false
autoUpdater.logger          = null   // silence built-in logger

function sendUpdateStatus(status) {
  mainWin?.webContents.send('update-status', status)
}

autoUpdater.on('checking-for-update',  ()     => sendUpdateStatus({ state: 'checking' }))
autoUpdater.on('update-available',     (info) => sendUpdateStatus({ state: 'available', version: info.version }))
autoUpdater.on('update-not-available', ()     => sendUpdateStatus({ state: 'up-to-date' }))
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

// ── Single-instance lock ───────────────────────────────────────
const gotSingleLock = app.requestSingleInstanceLock()
if (!gotSingleLock) {
  app.quit()
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

app.on('second-instance', (event, argv) => {
  // Another instance was launched — bring this window to front and open the file
  const filePath = findFileArg(argv)
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore()
    mainWin.focus()
    if (filePath) mainWin.webContents.send('open-file-arg', filePath)
  }
})

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
  if (!app.isPackaged) return { state: 'error', message: '開發模式無法檢查更新' }
  try {
    autoUpdater.checkForUpdates()
    return { ok: true }
  } catch (err) {
    return { state: 'error', message: err.message }
  }
})

ipcMain.handle('download-update', () => {
  autoUpdater.downloadUpdate()
})

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall()
})

ipcMain.handle('open-default-apps-settings', async () => {
  await shell.openExternal('ms-settings:defaultapps')
})
