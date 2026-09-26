const { app, BrowserWindow, ipcMain, dialog, clipboard, nativeImage, shell } = require('electron')
const path = require('path')
const fs   = require('fs')
const { autoUpdater } = require('electron-updater')
const {
  VIDEO_EXTENSIONS,
  findVideoFileArg,
  resolveSecondInstanceFile,
  createWindowManager,
} = require('./main/window-manager')

// Chromium 的硬體加速影片解碼在某些 GPU/驅動組合下會直接 native crash
// (STATUS_BREAKPOINT 0x80000003)，改用軟體解碼規避
app.commandLine.appendSwitch('disable-accelerated-video-decode')
app.commandLine.appendSwitch('disable-accelerated-video-encode')
// Windows Media Foundation (WMF) 對部分 MP4 音訊封包格式過於嚴格，
// 導致 PIPELINE_ERROR_DECODE。停用後 Chromium 改用內建 FFmpeg 音訊解碼，
// 與 VLC/MPV 相同的解碼後端，相容性大幅提升。
app.commandLine.appendSwitch('disable-features', 'MediaFoundationClearPlayback')

// Keep one Electron process so every player window shares the same profile,
// localStorage and configuration. A secondary launch asks the primary process
// to create another independent player window, then exits.
const initialFilePath = findVideoFileArg(process.argv)
const hasSingleInstanceLock = app.requestSingleInstanceLock({ filePath: initialFilePath })
if (!hasSingleInstanceLock) app.quit()

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

let config = readConfig()

// ── Auto-updater ───────────────────────────────────────────────
autoUpdater.autoDownload         = false
autoUpdater.autoInstallOnAppQuit = false
autoUpdater.logger               = null
// Prevent CDN from returning a cached latest.yml that lags behind the real release
autoUpdater.requestHeaders       = { 'Cache-Control': 'no-cache' }

function sendUpdateStatus(status) {
  windowManager.broadcast('update-status', status)
}

autoUpdater.on('checking-for-update',  ()     => sendUpdateStatus({ state: 'checking' }))
autoUpdater.on('update-available',     (info) => sendUpdateStatus({ state: 'available', version: info.version }))
autoUpdater.on('update-not-available', (info) => sendUpdateStatus({ state: 'up-to-date', latestVersion: info?.version }))
autoUpdater.on('download-progress',    (p)    => sendUpdateStatus({ state: 'downloading', percent: Math.round(p.percent) }))
autoUpdater.on('update-downloaded',    ()     => sendUpdateStatus({ state: 'downloaded' }))
autoUpdater.on('error',                (err)  => sendUpdateStatus({ state: 'error', message: err.message }))

// ── Window ─────────────────────────────────────────────────────
function createBrowserWindow(filePath) {
  const win = new BrowserWindow({
    width: 900, height: 600, minWidth: 640, minHeight: 400,
    backgroundColor: '#0f0c29', frame: false,
    icon: app.isPackaged ? undefined : path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true,
    },
  })
  win.loadFile('renderer/index.html')
  win.webContents.once('did-finish-load', () => {
    if (filePath) win.webContents.send('open-file-arg', filePath)
  })
  return win
}

const windowManager = createWindowManager({ BrowserWindow, createBrowserWindow })

if (hasSingleInstanceLock) {
  app.on('second-instance', (event, argv, workingDirectory, additionalData) => {
    windowManager.createWindow(resolveSecondInstanceFile(additionalData, argv))
  })

  app.whenReady().then(() => {
    windowManager.createWindow(initialFilePath)
  // Auto-check for updates after window is ready (3s delay)
    if (app.isPackaged) {
      setTimeout(() => {
        try {
          if (config.autoCheckUpdate !== false) autoUpdater.checkForUpdates()
        } catch { /* ignore */ }
      }, 3000)
    }
  })
}
app.on('window-all-closed', () => app.quit())

// ── IPC handlers ───────────────────────────────────────────────
ipcMain.handle('get-config',  () => config)
ipcMain.handle('get-version', () => app.getVersion())

ipcMain.handle('open-file', async (event) => {
  const owner = windowManager.getWindowForEvent(event)
  const options = {
    properties: ['openFile'],
    filters: [{ name: 'Videos', extensions: [...VIDEO_EXTENSIONS] }],
  }
  const { canceled, filePaths } = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options)
  return canceled ? null : filePaths[0]
})

ipcMain.handle('win-minimize', event => windowManager.getWindowForEvent(event)?.minimize())
ipcMain.handle('win-maximize', event => {
  const win = windowManager.getWindowForEvent(event)
  if (!win) return
  win.isMaximized() ? win.unmaximize() : win.maximize()
})
ipcMain.handle('win-close', event => windowManager.getWindowForEvent(event)?.close())

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
    config = newConfig
    windowManager.broadcast('config-updated', config, event.sender)
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
