const {
  createRecoveryPolicy,
  createMediaRecoveryController,
  getRecoveryNotice,
} = require('../renderer/media-recovery')

describe('createRecoveryPolicy', () => {
  test('a decode error skips one second ahead with audio disabled', () => {
    const policy = createRecoveryPolicy()

    expect(policy.decodeError(12.5)).toEqual({
      type: 'restart',
      targetTime: 13.5,
      audioEnabled: false,
      skipSeconds: 1,
    })
    expect(policy.snapshot().mode).toBe('restarting')
  })

  test('three consecutive decode errors skip one, two, then three seconds to cross a five-second gap', () => {
    const policy = createRecoveryPolicy()

    expect(policy.decodeError(10).skipSeconds).toBe(1)
    policy.restartSucceeded(11, false)
    expect(policy.decodeError(11).skipSeconds).toBe(2)
    policy.restartSucceeded(13, false)
    expect(policy.decodeError(13)).toMatchObject({ targetTime: 16, skipSeconds: 3 })
  })

  test('video-only playback probes audio after six seconds of media progress', () => {
    const policy = createRecoveryPolicy()
    policy.decodeError(10)
    policy.restartSucceeded(10.25, false)

    expect(policy.progress(16.24)).toBeNull()
    expect(policy.progress(16.25)).toEqual({ type: 'probe-audio' })
    expect(policy.snapshot().mode).toBe('probing-audio')
  })

  test('two seconds of probe progress confirms that audio recovered', () => {
    const policy = createRecoveryPolicy()
    policy.decodeError(10)
    policy.restartSucceeded(10.25, false)
    policy.progress(16.25)

    expect(policy.progress(18.24)).toBeNull()
    expect(policy.progress(18.25)).toEqual({ type: 'audio-recovered' })
    expect(policy.snapshot().mode).toBe('normal')
  })

  test('failed probes disable audio and back off through twelve then thirty seconds', () => {
    const policy = createRecoveryPolicy()
    policy.decodeError(0)
    policy.restartSucceeded(0.25, false)

    expect(policy.snapshot().retryDelay).toBe(6)
    policy.progress(6.25)
    expect(policy.restartFailed(6.5)).toEqual({ type: 'continue-video-only', retryDelay: 12 })
    expect(policy.snapshot().retryDelay).toBe(12)

    policy.progress(18.5)
    expect(policy.restartFailed(19)).toEqual({ type: 'continue-video-only', retryDelay: 30 })
    expect(policy.snapshot().retryDelay).toBe(30)

    policy.progress(49)
    expect(policy.restartFailed(49.5)).toEqual({ type: 'continue-video-only', retryDelay: 30 })
    expect(policy.snapshot().retryDelay).toBe(30)
  })

  test('first confirmed stall requests a normal restart', () => {
    const policy = createRecoveryPolicy()

    expect(policy.stall(20)).toEqual({
      type: 'restart',
      targetTime: 20.25,
      audioEnabled: true,
    })
  })

  test('a second nearby stall escalates to a video-only restart', () => {
    const policy = createRecoveryPolicy()
    policy.stall(20)
    policy.restartSucceeded(20.25, true)

    expect(policy.stall(21)).toEqual({
      type: 'restart',
      targetTime: 21.25,
      audioEnabled: false,
    })
  })

  test('five seconds of healthy progress clears stall escalation', () => {
    const policy = createRecoveryPolicy()
    policy.stall(20)
    policy.restartSucceeded(20.25, true)
    policy.progress(25)

    expect(policy.stall(26)).toEqual({
      type: 'restart',
      targetTime: 26.25,
      audioEnabled: true,
    })
  })

  test('a stall during video-only recovery never re-enables damaged audio', () => {
    const policy = createRecoveryPolicy()
    policy.decodeError(10)
    policy.restartSucceeded(10.25, false)

    expect(policy.stall(11)).toEqual({
      type: 'restart',
      targetTime: 11.25,
      audioEnabled: false,
    })
  })
})

function createFakeMedia({ withAudioTracks = true, audioTrackCount = 1 } = {}) {
  const listeners = new Map()
  const addedListeners = []
  const media = {
    currentTime: 10,
    paused: false,
    playbackRate: 1.5,
    muted: false,
    readyState: 1,
    error: null,
    loadCount: 0,
    playCount: 0,
    load() { this.loadCount++ },
    play() { this.playCount++; return Promise.resolve() },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(listener)
      addedListeners.push({ type, listener })
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
    emit(type) {
      for (const listener of [...(listeners.get(type) || [])]) listener()
    },
    listenerCount(type) { return listeners.get(type)?.size || 0 },
    lastAdded(type) { return [...addedListeners].reverse().find(item => item.type === type)?.listener },
  }
  if (withAudioTracks) {
    media.audioTracks = Array.from({ length: audioTrackCount }, () => ({ enabled: true }))
  }
  return media
}

function createFakeTimers() {
  let nextId = 1
  const pending = new Map()
  return {
    setTimeout(fn, delay) {
      const id = nextId++
      pending.set(id, { fn, delay })
      return id
    },
    clearTimeout(id) { pending.delete(id) },
    runDelay(delay) {
      const match = [...pending.entries()].find(([, item]) => item.delay === delay)
      if (!match) throw new Error(`No pending timer for ${delay}ms`)
      pending.delete(match[0])
      match[1].fn()
    },
  }
}

describe('createMediaRecoveryController', () => {
  test('reloads once, disables audio, restores playback state, and resumes', () => {
    const media = createFakeMedia()
    const actions = []
    const controller = createMediaRecoveryController({
      media,
      timers: createFakeTimers(),
      onAction: action => actions.push(action),
    })
    controller.beginSource()

    controller.handleError({ code: 3 })
    expect(media.loadCount).toBe(1)
    expect(media.audioTracks[0].enabled).toBe(false)

    media.playbackRate = 1
    media.emit('canplay')

    expect(media.currentTime).toBe(11)
    expect(media.playbackRate).toBe(1.5)
    expect(media.playCount).toBe(1)
    expect(media.audioTracks[0].enabled).toBe(false)
    expect(controller.snapshot().mode).toBe('video-only')
  })

  test('ignores a stale callback after a new source begins', () => {
    const media = createFakeMedia()
    const controller = createMediaRecoveryController({ media, timers: createFakeTimers() })
    controller.beginSource()
    controller.handleError({ code: 3 })
    const staleCanplay = media.lastAdded('canplay')

    controller.beginSource()
    media.currentTime = 3
    staleCanplay()

    expect(media.currentTime).toBe(3)
    expect(media.playCount).toBe(0)
    expect(controller.snapshot().mode).toBe('normal')
  })

  test('an eight-second restart timeout clears listeners and fails safely', () => {
    const media = createFakeMedia()
    const timers = createFakeTimers()
    const actions = []
    const controller = createMediaRecoveryController({ media, timers, onAction: action => actions.push(action) })
    controller.beginSource()
    controller.handleError({ code: 3 })

    timers.runDelay(8000)

    expect(media.listenerCount('canplay')).toBe(0)
    expect(actions.at(-1)).toEqual({ type: 'failed', reason: 'restart-timeout' })
    media.emit('canplay')
    expect(media.playCount).toBe(0)
  })

  test.each([
    ['missing audioTracks', { withAudioTracks: false }],
    ['an empty audioTracks list', { audioTrackCount: 0 }],
  ])('%s falls back to muted recovery and still restarts playback', (_caseName, mediaOptions) => {
    const media = createFakeMedia(mediaOptions)
    const actions = []
    const controller = createMediaRecoveryController({
      media,
      timers: createFakeTimers(),
      onAction: action => actions.push(action),
    })
    controller.beginSource()

    controller.handleError({ code: 3 })

    expect(media.loadCount).toBe(1)
    expect(media.muted).toBe(true)
    expect(actions.at(-1)).toMatchObject({ type: 'restart', audioEnabled: false })

    media.emit('canplay')

    expect(controller.snapshot().mode).toBe('video-only')
    expect(media.playCount).toBe(1)
    expect(media.muted).toBe(true)

    media.currentTime = 17
    controller.handleTimeUpdate()

    expect(media.muted).toBe(false)
    expect(actions.at(-1)).toEqual({ type: 'probe-audio' })
  })

  test('consecutive decode errors keep skipping until playback is beyond a five-second damaged segment', () => {
    const media = createFakeMedia()
    const actions = []
    const controller = createMediaRecoveryController({
      media,
      timers: createFakeTimers(),
      onAction: action => actions.push(action),
    })
    controller.beginSource()
    const startTime = media.currentTime

    for (let attempt = 0; attempt < 3; attempt++) {
      controller.handleError({ code: 3 })
      expect(media.loadCount).toBe(attempt + 1)
      media.emit('canplay')
    }

    expect(media.currentTime).toBeGreaterThanOrEqual(startTime + 5)
    expect(actions).not.toContainEqual(expect.objectContaining({ type: 'failed' }))
    expect(controller.snapshot().mode).toBe('video-only')
  })

  test('manual resync revives a terminal recovery session and always reloads', () => {
    const media = createFakeMedia()
    const actions = []
    const controller = createMediaRecoveryController({
      media,
      timers: createFakeTimers(),
      onAction: action => actions.push(action),
    })
    controller.beginSource()
    controller.handleError({ code: 4 })
    expect(controller.snapshot().mode).toBe('failed')

    controller.resync()

    expect(media.loadCount).toBe(1)
    expect(actions.at(-1)).toMatchObject({ type: 'restart', audioEnabled: true })
    expect(controller.snapshot().mode).toBe('restarting')
  })

  test('manual resync replaces an in-flight automatic restart instead of ignoring the click', () => {
    const media = createFakeMedia()
    const actions = []
    const controller = createMediaRecoveryController({
      media,
      timers: createFakeTimers(),
      onAction: action => actions.push(action),
    })
    controller.beginSource()
    controller.handleError({ code: 3 })
    expect(media.loadCount).toBe(1)

    controller.resync()

    expect(media.loadCount).toBe(2)
    expect(media.listenerCount('canplay')).toBe(1)
    expect(actions.at(-1)).toMatchObject({ type: 'restart', audioEnabled: true })
  })

  test('manual resync without an active video reports why nothing can be restarted', () => {
    const media = createFakeMedia()
    const actions = []
    const controller = createMediaRecoveryController({
      media,
      timers: createFakeTimers(),
      onAction: action => actions.push(action),
    })

    expect(controller.resync()).toBe(false)
    expect(media.loadCount).toBe(0)
    expect(actions).toEqual([{ type: 'resync-unavailable' }])
  })

  test('manual resync uses the start when the decoder no longer exposes a finite position', () => {
    const media = createFakeMedia()
    const actions = []
    const controller = createMediaRecoveryController({
      media,
      timers: createFakeTimers(),
      onAction: action => actions.push(action),
    })
    controller.beginSource()
    media.currentTime = Number.NaN

    controller.resync()

    expect(actions.at(-1)).toMatchObject({ type: 'restart', targetTime: 0 })
  })

  test('user mute remains independent while recovery disables and probes audio', () => {
    const media = createFakeMedia()
    const controller = createMediaRecoveryController({ media, timers: createFakeTimers() })
    controller.beginSource()
    controller.setUserMuted(true)
    controller.handleError({ code: 3 })
    media.emit('canplay')

    media.currentTime = 17
    controller.handleTimeUpdate()

    expect(media.audioTracks[0].enabled).toBe(true)
    expect(media.muted).toBe(true)
    controller.setUserMuted(false)
    expect(media.muted).toBe(false)
    expect(media.audioTracks[0].enabled).toBe(true)
  })

  test('a stall during an audio probe disables audio and increases the retry delay', () => {
    const media = createFakeMedia()
    const timers = createFakeTimers()
    const actions = []
    const controller = createMediaRecoveryController({ media, timers, onAction: action => actions.push(action) })
    controller.beginSource()
    controller.handleError({ code: 3 })
    media.emit('canplay')
    media.currentTime = 17
    controller.handleTimeUpdate()
    expect(media.audioTracks[0].enabled).toBe(true)

    media.currentTime = 17.25
    controller.handleWaiting()
    timers.runDelay(1000)

    expect(media.audioTracks[0].enabled).toBe(false)
    expect(actions).toContainEqual({ type: 'continue-video-only', retryDelay: 12 })
  })
})

describe('getRecoveryNotice', () => {
  test('marks video-only fallback as persistent but recovery checks as temporary', () => {
    expect(getRecoveryNotice({ type: 'video-only' })).toMatchObject({
      kind: 'video-only',
      persistent: true,
    })
    expect(getRecoveryNotice({ type: 'probe-audio' })).toMatchObject({
      kind: 'probing',
      persistent: false,
    })
    expect(getRecoveryNotice({ type: 'restart', audioEnabled: false, skipSeconds: 2 })).toMatchObject({
      message: expect.stringContaining('跳過 2 秒'),
    })
  })

  test('distinguishes recovered audio from a terminal playback failure', () => {
    expect(getRecoveryNotice({ type: 'audio-recovered' })).toMatchObject({
      kind: 'recovered',
      persistent: false,
    })
    expect(getRecoveryNotice({ type: 'failed', reason: 'restart-timeout' })).toMatchObject({
      kind: 'failed',
      persistent: true,
    })
    expect(getRecoveryNotice({ type: 'resync-unavailable' })).toMatchObject({
      kind: 'unavailable',
      persistent: false,
    })
  })
})
