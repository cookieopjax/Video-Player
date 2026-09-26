const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'flv', 'wmv'])

function stripWrappingQuotes(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1)
  }
  return value
}

function findVideoFileArg(argv) {
  if (!Array.isArray(argv)) return null

  for (const rawArg of argv.slice(1)) {
    if (typeof rawArg !== 'string' || rawArg.startsWith('-')) continue
    const arg = stripWrappingQuotes(rawArg)
    const dot = arg.lastIndexOf('.')
    if (dot < 0) continue
    if (VIDEO_EXTENSIONS.has(arg.slice(dot + 1).toLowerCase())) return arg
  }
  return null
}

function isSupportedVideoPath(value) {
  return typeof value === 'string' && findVideoFileArg(['app', value]) === stripWrappingQuotes(value)
}

function resolveSecondInstanceFile(additionalData, argv) {
  const suppliedPath = additionalData?.filePath
  if (isSupportedVideoPath(suppliedPath)) return stripWrappingQuotes(suppliedPath)
  return findVideoFileArg(argv)
}

function createWindowManager({ BrowserWindow, createBrowserWindow }) {
  const windows = new Set()

  function createWindow(filePath = null) {
    const window = createBrowserWindow(filePath)
    windows.add(window)
    window.once('closed', () => windows.delete(window))
    return window
  }

  function getWindowForEvent(event) {
    return BrowserWindow.fromWebContents(event.sender)
  }

  function broadcast(channel, payload, excludedWebContents = null) {
    for (const window of windows) {
      if (window.isDestroyed?.()) continue
      const contents = window.webContents
      if (!contents || contents === excludedWebContents || contents.isDestroyed?.()) continue
      contents.send(channel, payload)
    }
  }

  return {
    createWindow,
    getWindowForEvent,
    broadcast,
    get size() { return windows.size },
  }
}

module.exports = {
  VIDEO_EXTENSIONS,
  findVideoFileArg,
  resolveSecondInstanceFile,
  createWindowManager,
}
