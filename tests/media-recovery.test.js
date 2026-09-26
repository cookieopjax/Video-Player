const { createRecoveryPolicy } = require('../renderer/media-recovery')

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
