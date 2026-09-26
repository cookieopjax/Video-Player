const RECOVERY_DELAYS = [6, 12, 30]

function createRecoveryPolicy() {
  let state

  function reset() {
    state = {
      mode: 'normal',
      retryIndex: 0,
      nextProbeAt: null,
      probeStartedAt: null,
      lastStallAt: null,
      stallCount: 0,
    }
  }

  function retryDelay() {
    return RECOVERY_DELAYS[Math.min(state.retryIndex, RECOVERY_DELAYS.length - 1)]
  }

  function requestRestart(currentTime, audioEnabled) {
    state.mode = 'restarting'
    return {
      type: 'restart',
      targetTime: currentTime + 0.25,
      audioEnabled,
    }
  }

  function decodeError(currentTime) {
    return requestRestart(currentTime, false)
  }

  function stall(currentTime) {
    const nearby = state.stallCount > 0
      && state.lastStallAt !== null
      && currentTime - state.lastStallAt < 5
    state.stallCount = nearby ? state.stallCount + 1 : 1
    state.lastStallAt = currentTime
    return requestRestart(currentTime, !nearby)
  }

  function progress(currentTime) {
    if (state.lastStallAt !== null && currentTime - state.lastStallAt >= 5) {
      state.lastStallAt = null
      state.stallCount = 0
    }

    if (state.mode === 'video-only' && currentTime >= state.nextProbeAt) {
      state.mode = 'probing-audio'
      state.probeStartedAt = currentTime
      return { type: 'probe-audio' }
    }

    if (state.mode === 'probing-audio' && currentTime - state.probeStartedAt >= 2) {
      state.mode = 'normal'
      state.retryIndex = 0
      state.nextProbeAt = null
      state.probeStartedAt = null
      return { type: 'audio-recovered' }
    }

    return null
  }

  function restartSucceeded(currentTime, audioEnabled) {
    if (audioEnabled) {
      state.mode = 'normal'
      return null
    }

    state.mode = 'video-only'
    state.nextProbeAt = currentTime + retryDelay()
    state.probeStartedAt = null
    return { type: 'video-only', retryDelay: retryDelay() }
  }

  function restartFailed(currentTime) {
    if (state.mode === 'probing-audio') {
      state.retryIndex = Math.min(state.retryIndex + 1, RECOVERY_DELAYS.length - 1)
    }
    state.mode = 'video-only'
    state.probeStartedAt = null
    state.nextProbeAt = currentTime + retryDelay()
    return { type: 'continue-video-only', retryDelay: retryDelay() }
  }

  function snapshot() {
    return {
      ...state,
      retryDelay: retryDelay(),
    }
  }

  reset()
  return { reset, decodeError, stall, progress, restartSucceeded, restartFailed, snapshot }
}

function createMediaRecoveryController({
  media,
  timers = { setTimeout, clearTimeout },
  onAction = () => {},
}) {
  const policy = createRecoveryPolicy()
  let session = 0
  let active = false
  let terminal = false
  let userMuted = false
  let waitingTimer = null
  let restart = null

  function setAudioEnabled(enabled) {
    const tracks = media.audioTracks
    if (!tracks || typeof tracks.length !== 'number' || tracks.length === 0) {
      return enabled
    }
    for (let index = 0; index < tracks.length; index++) tracks[index].enabled = enabled
    return true
  }

  function clearWaitingTimer() {
    if (waitingTimer !== null) timers.clearTimeout(waitingTimer)
    waitingTimer = null
  }

  function clearRestart() {
    if (!restart) return
    media.removeEventListener('canplay', restart.canplay)
    timers.clearTimeout(restart.timeout)
    restart = null
  }

  function fail(reason) {
    clearRestart()
    clearWaitingTimer()
    terminal = true
    onAction({ type: 'failed', reason })
  }

  function performRestart(action) {
    if (!active || terminal || restart) return
    if (!action.audioEnabled && !setAudioEnabled(false)) {
      policy.restartFailed(media.currentTime)
      fail('audio-tracks-unavailable')
      return
    }

    const token = session
    const wasPaused = media.paused
    const playbackRate = media.playbackRate

    const canplay = () => {
      if (token !== session || !active || terminal || restart?.canplay !== canplay) return
      clearRestart()
      if (!action.audioEnabled && !setAudioEnabled(false)) {
        policy.restartFailed(media.currentTime)
        fail('audio-tracks-unavailable')
        return
      }
      if (action.audioEnabled) setAudioEnabled(true)
      media.playbackRate = playbackRate
      media.muted = userMuted
      media.currentTime = action.targetTime
      const policyAction = policy.restartSucceeded(action.targetTime, action.audioEnabled)
      if (policyAction) onAction(policyAction)
      if (!wasPaused) {
        const playResult = media.play()
        playResult?.catch?.(() => {})
      }
    }

    const timeout = timers.setTimeout(() => {
      if (token !== session || restart?.canplay !== canplay) return
      clearRestart()
      policy.restartFailed(media.currentTime)
      fail('restart-timeout')
    }, 8000)

    restart = { canplay, timeout }
    media.addEventListener('canplay', canplay)
    onAction(action)
    media.load()
  }

  function beginSource() {
    session++
    active = true
    terminal = false
    clearWaitingTimer()
    clearRestart()
    policy.reset()
    setAudioEnabled(true)
    media.muted = userMuted
  }

  function cancel() {
    session++
    active = false
    clearWaitingTimer()
    clearRestart()
    policy.reset()
  }

  function handleError(error = media.error) {
    if (!active || terminal) return
    if (error?.code !== 3) {
      fail('media-error')
      return
    }

    const mode = policy.snapshot().mode
    if (mode === 'restarting') return
    if (mode === 'video-only') {
      fail('video-decode-failed')
      return
    }
    if (mode === 'probing-audio') {
      setAudioEnabled(false)
      const fallback = policy.restartFailed(media.currentTime)
      onAction(fallback)
      performRestart({
        type: 'restart',
        targetTime: media.currentTime + 0.25,
        audioEnabled: false,
      })
      return
    }

    performRestart(policy.decodeError(media.currentTime))
  }

  function handleWaiting() {
    if (!active || terminal || waitingTimer !== null) return
    const token = session
    waitingTimer = timers.setTimeout(() => {
      waitingTimer = null
      if (token !== session || !active || terminal) return
      if (media.paused || media.currentTime <= 0 || media.readyState >= 3) return
      performRestart(policy.stall(media.currentTime))
    }, 1000)
  }

  function handlePlaying() {
    clearWaitingTimer()
  }

  function handlePause() {
    clearWaitingTimer()
  }

  function handleTimeUpdate() {
    if (!active || terminal) return
    const action = policy.progress(media.currentTime)
    if (!action) return
    if (action.type === 'probe-audio') {
      if (!setAudioEnabled(true)) {
        const fallback = policy.restartFailed(media.currentTime)
        onAction(fallback)
        return
      }
    }
    onAction(action)
  }

  function resync() {
    if (!active || terminal || restart) return
    const mode = policy.snapshot().mode
    performRestart({
      type: 'restart',
      targetTime: media.currentTime,
      audioEnabled: mode !== 'video-only',
    })
  }

  function setUserMuted(muted) {
    userMuted = !!muted
    media.muted = userMuted
  }

  function snapshot() {
    const current = policy.snapshot()
    return terminal ? { ...current, mode: 'failed' } : current
  }

  return {
    beginSource,
    cancel,
    handleError,
    handleWaiting,
    handlePlaying,
    handlePause,
    handleTimeUpdate,
    resync,
    setUserMuted,
    snapshot,
  }
}

if (typeof module !== 'undefined') module.exports = {
  createRecoveryPolicy,
  createMediaRecoveryController,
}
