const RECOVERY_DELAYS = [6, 12, 30]
const RECOVERY_SKIP_SECONDS = [1, 2, 3]

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
      skipIndex: 0,
    }
  }

  function retryDelay() {
    return RECOVERY_DELAYS[Math.min(state.retryIndex, RECOVERY_DELAYS.length - 1)]
  }

  function requestRestart(currentTime, audioEnabled, skipSeconds = 0.25) {
    state.mode = 'restarting'
    const safeCurrentTime = Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0
    const action = {
      type: 'restart',
      targetTime: safeCurrentTime + skipSeconds,
      audioEnabled,
    }
    if (skipSeconds !== 0.25) action.skipSeconds = skipSeconds
    return action
  }

  function decodeError(currentTime) {
    const skipSeconds = RECOVERY_SKIP_SECONDS[Math.min(state.skipIndex, RECOVERY_SKIP_SECONDS.length - 1)]
    state.skipIndex = Math.min(state.skipIndex + 1, RECOVERY_SKIP_SECONDS.length - 1)
    return requestRestart(currentTime, false, skipSeconds)
  }

  function manualRestart(currentTime) {
    return requestRestart(currentTime, true, 0)
  }

  function stall(currentTime) {
    const recoveringAudio = state.mode === 'video-only' || state.mode === 'probing-audio'
    const nearby = state.stallCount > 0
      && state.lastStallAt !== null
      && currentTime - state.lastStallAt < 5
    state.stallCount = nearby ? state.stallCount + 1 : 1
    state.lastStallAt = currentTime
    return requestRestart(currentTime, !recoveringAudio && !nearby)
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
      state.skipIndex = 0
      state.nextProbeAt = null
      state.probeStartedAt = null
      return { type: 'audio-recovered' }
    }

    return null
  }

  function restartSucceeded(currentTime, audioEnabled) {
    if (audioEnabled) {
      state.mode = 'normal'
      state.skipIndex = 0
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
  return { reset, decodeError, manualRestart, stall, progress, restartSucceeded, restartFailed, snapshot }
}

function createMediaRecoveryController({
  media,
  timers = {
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout: (...args) => globalThis.clearTimeout(...args),
  },
  onAction = () => {},
}) {
  const policy = createRecoveryPolicy()
  let session = 0
  let active = false
  let terminal = false
  let userMuted = false
  let recoveryMuted = false
  let waitingTimer = null
  let restart = null

  function applyMuteState() {
    media.muted = userMuted || recoveryMuted
  }

  function setAudioEnabled(enabled) {
    const tracks = media.audioTracks
    if (!tracks || typeof tracks.length !== 'number' || tracks.length === 0) {
      recoveryMuted = !enabled
      applyMuteState()
      return true
    }
    for (let index = 0; index < tracks.length; index++) tracks[index].enabled = enabled
    recoveryMuted = false
    applyMuteState()
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
    if (!action.audioEnabled) setAudioEnabled(false)

    const token = session
    const wasPaused = media.paused
    const playbackRate = media.playbackRate

    const canplay = () => {
      if (token !== session || !active || terminal || restart?.canplay !== canplay) return
      clearRestart()
      if (!action.audioEnabled) setAudioEnabled(false)
      if (action.audioEnabled) setAudioEnabled(true)
      media.playbackRate = playbackRate
      applyMuteState()
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
    applyMuteState()
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
    if (restart) return
    if (error?.code !== 3) {
      fail('media-error')
      return
    }

    const mode = policy.snapshot().mode
    if (mode === 'restarting') return
    if (mode === 'video-only') {
      performRestart(policy.decodeError(media.currentTime))
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
      if (policy.snapshot().mode === 'probing-audio') {
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
      setAudioEnabled(true)
    }
    onAction(action)
  }

  function resync() {
    if (!active) {
      onAction({ type: 'resync-unavailable' })
      return false
    }
    session++
    clearWaitingTimer()
    clearRestart()
    terminal = false
    policy.reset()
    setAudioEnabled(true)
    performRestart(policy.manualRestart(media.currentTime))
    return true
  }

  function setUserMuted(muted) {
    userMuted = !!muted
    applyMuteState()
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

function getRecoveryNotice(action) {
  switch (action?.type) {
    case 'restart':
      return action.audioEnabled
        ? { kind: 'restarting', message: '正在重新同步播放…', persistent: false }
        : {
            kind: 'video-only',
            message: action.skipSeconds
              ? `偵測到損壞音訊，正在跳過 ${action.skipSeconds} 秒並暫時靜音…`
              : '偵測到損壞音訊，已暫時靜音繼續播放',
            persistent: true,
          }
    case 'video-only':
      return {
        kind: 'video-only',
        message: `已略過損壞區段，${action.retryDelay || 6} 秒後自動恢復音訊`,
        persistent: true,
      }
    case 'probe-audio':
      return { kind: 'probing', message: '正在嘗試恢復音訊…', persistent: false }
    case 'audio-recovered':
      return { kind: 'recovered', message: '音訊已自動恢復', persistent: false }
    case 'continue-video-only':
      return { kind: 'video-only', message: '音訊仍損壞，繼續無聲播放並稍後重試', persistent: true }
    case 'failed':
      return { kind: 'failed', message: '影片解碼失敗，無法自動恢復', persistent: true }
    case 'resync-unavailable':
      return { kind: 'unavailable', message: '請先開啟影片', persistent: false }
    default:
      return null
  }
}

if (typeof module !== 'undefined') module.exports = {
  createRecoveryPolicy,
  createMediaRecoveryController,
  getRecoveryNotice,
}
