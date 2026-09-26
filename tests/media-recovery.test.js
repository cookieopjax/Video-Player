const {
  createRecoveryPolicy,
  createMediaRecoveryController,
} = require('../renderer/media-recovery')

describe('createRecoveryPolicy', () => {
  test('a decode error requests one restart just ahead with audio disabled', () => {
    const policy = createRecoveryPolicy()

    expect(policy.decodeError(12.5)).toEqual({
      type: 'restart',
      targetTime: 12.75,
      audioEnabled: false,
    })
    expect(policy.snapshot().mode).toBe('restarting')
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
})

function createFakeMedia({ withAudioTracks = true } = {}) {
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
  if (withAudioTracks) media.audioTracks = [{ enabled: true }]
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

    expect(media.currentTime).toBe(10.25)
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

  test('missing audioTracks fails safely without starting a reload loop', () => {
    const media = createFakeMedia({ withAudioTracks: false })
    const actions = []
    const controller = createMediaRecoveryController({
      media,
      timers: createFakeTimers(),
      onAction: action => actions.push(action),
    })
    controller.beginSource()

    controller.handleError({ code: 3 })
    controller.handleError({ code: 3 })

    expect(media.loadCount).toBe(0)
    expect(actions.at(-1)).toEqual({ type: 'failed', reason: 'audio-tracks-unavailable' })
  })

  test('an error while already video-only does not recursively reload', () => {
    const media = createFakeMedia()
    const actions = []
    const controller = createMediaRecoveryController({
      media,
      timers: createFakeTimers(),
      onAction: action => actions.push(action),
    })
    controller.beginSource()
    controller.handleError({ code: 3 })
    media.emit('canplay')

    controller.handleError({ code: 3 })

    expect(media.loadCount).toBe(1)
    expect(actions.at(-1)).toEqual({ type: 'failed', reason: 'video-decode-failed' })
  })

  test('user mute remains independent while recovery disables and probes audio', () => {
    const media = createFakeMedia()
    const controller = createMediaRecoveryController({ media, timers: createFakeTimers() })
    controller.beginSource()
    controller.setUserMuted(true)
    controller.handleError({ code: 3 })
    media.emit('canplay')

    media.currentTime = 16.25
    controller.handleTimeUpdate()

    expect(media.audioTracks[0].enabled).toBe(true)
    expect(media.muted).toBe(true)
    controller.setUserMuted(false)
    expect(media.muted).toBe(false)
    expect(media.audioTracks[0].enabled).toBe(true)
  })
})
