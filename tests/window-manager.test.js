const {
  findVideoFileArg,
  resolveSecondInstanceFile,
  createWindowManager,
} = require('../main/window-manager')

describe('findVideoFileArg', () => {
  test('returns the first supported video after executable and script arguments', () => {
    expect(findVideoFileArg([
      'C:\\Program Files\\Electron\\electron.exe',
      '.',
      '--inspect=9229',
      'D:\\Videos\\lesson.mkv',
    ])).toBe('D:\\Videos\\lesson.mkv')
  })

  test('ignores flags and unsupported files', () => {
    expect(findVideoFileArg(['VideoPlayer.exe', '--safe-mode', 'notes.txt', 'clip.mp4']))
      .toBe('clip.mp4')
  })

  test('returns null for a launch without a video', () => {
    expect(findVideoFileArg(['VideoPlayer.exe'])).toBeNull()
    expect(findVideoFileArg([])).toBeNull()
  })

  test('removes wrapping quotes from a video path', () => {
    expect(findVideoFileArg(['VideoPlayer.exe', '"D:\\My Videos\\lesson.webm"']))
      .toBe('D:\\My Videos\\lesson.webm')
  })
})

describe('resolveSecondInstanceFile', () => {
  test('prefers a supported file supplied through additional data', () => {
    expect(resolveSecondInstanceFile(
      { filePath: 'D:\\Videos\\preferred.mkv' },
      ['VideoPlayer.exe', 'fallback.mp4'],
    )).toBe('D:\\Videos\\preferred.mkv')
  })

  test('falls back to argv when additional data is absent or invalid', () => {
    expect(resolveSecondInstanceFile({}, ['VideoPlayer.exe', 'fallback.mp4']))
      .toBe('fallback.mp4')
    expect(resolveSecondInstanceFile(
      { filePath: 'D:\\Videos\\notes.txt' },
      ['VideoPlayer.exe', 'fallback.webm'],
    )).toBe('fallback.webm')
  })

  test('returns null when neither source contains a supported video', () => {
    expect(resolveSecondInstanceFile({ filePath: '' }, ['VideoPlayer.exe', '--flag']))
      .toBeNull()
  })
})

function makeWindow() {
  const closedListeners = []
  const webContents = {
    destroyed: false,
    isDestroyed() { return this.destroyed },
    send: jest.fn(),
  }
  return {
    destroyed: false,
    webContents,
    isDestroyed() { return this.destroyed },
    once(event, listener) {
      if (event === 'closed') closedListeners.push(listener)
    },
    closeForTest() {
      this.destroyed = true
      closedListeners.forEach(listener => listener())
    },
  }
}

describe('createWindowManager', () => {
  test('registers new windows and removes them after close', () => {
    const window = makeWindow()
    const manager = createWindowManager({
      BrowserWindow: { fromWebContents: jest.fn() },
      createBrowserWindow: () => window,
    })

    expect(manager.createWindow('lesson.mp4')).toBe(window)
    expect(manager.size).toBe(1)

    window.closeForTest()
    expect(manager.size).toBe(0)
  })

  test('resolves the window belonging to an IPC sender', () => {
    const owner = makeWindow()
    const BrowserWindow = { fromWebContents: jest.fn(() => owner) }
    const manager = createWindowManager({ BrowserWindow, createBrowserWindow: makeWindow })
    const event = { sender: owner.webContents }

    expect(manager.getWindowForEvent(event)).toBe(owner)
    expect(BrowserWindow.fromWebContents).toHaveBeenCalledWith(owner.webContents)
  })

  test('broadcasts to live peers while excluding the sender', () => {
    const first = makeWindow()
    const second = makeWindow()
    const destroyed = makeWindow()
    destroyed.webContents.destroyed = true
    const queue = [first, second, destroyed]
    const manager = createWindowManager({
      BrowserWindow: { fromWebContents: jest.fn() },
      createBrowserWindow: () => queue.shift(),
    })
    manager.createWindow()
    manager.createWindow()
    manager.createWindow()

    manager.broadcast('config-updated', { jumpSeconds: 5 }, first.webContents)

    expect(first.webContents.send).not.toHaveBeenCalled()
    expect(second.webContents.send).toHaveBeenCalledWith('config-updated', { jumpSeconds: 5 })
    expect(destroyed.webContents.send).not.toHaveBeenCalled()
  })
})
