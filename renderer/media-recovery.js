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

if (typeof module !== 'undefined') module.exports = { createRecoveryPolicy }
