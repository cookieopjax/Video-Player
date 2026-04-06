const { formatTime, clamp, normalizeConfig } = require('../renderer/utils')

// ── formatTime ─────────────────────────────────────────────────
describe('formatTime', () => {
  test('formats seconds under a minute', () => {
    expect(formatTime(45)).toBe('00:45')
  })
  test('formats minutes and seconds', () => {
    expect(formatTime(754)).toBe('12:34')
  })
  test('formats hours', () => {
    expect(formatTime(5025)).toBe('1:23:45')
  })
  test('returns 00:00 for NaN', () => {
    expect(formatTime(NaN)).toBe('00:00')
  })
  test('returns 00:00 for negative', () => {
    expect(formatTime(-5)).toBe('00:00')
  })
  test('formats zero', () => {
    expect(formatTime(0)).toBe('00:00')
  })
  test('formats exactly one hour', () => {
    expect(formatTime(3600)).toBe('1:00:00')
  })
  test('truncates fractional seconds', () => {
    expect(formatTime(61.9)).toBe('01:01')
  })
})

// ── clamp ──────────────────────────────────────────────────────
describe('clamp', () => {
  test('returns value when within range', () => {
    expect(clamp(50, 0, 100)).toBe(50)
  })
  test('clamps to min', () => {
    expect(clamp(-10, 0, 100)).toBe(0)
  })
  test('clamps to max', () => {
    expect(clamp(150, 0, 100)).toBe(100)
  })
  test('returns min when value equals min', () => {
    expect(clamp(0, 0, 100)).toBe(0)
  })
  test('returns max when value equals max', () => {
    expect(clamp(100, 0, 100)).toBe(100)
  })
})

// ── normalizeConfig ────────────────────────────────────────────
describe('normalizeConfig', () => {
  test('passes through a fully valid config', () => {
    const raw = { speeds: [0.5, 1, 2], jumpSeconds: 10, defaultVolume: 80, autoPlay: true, resumeAfterCrop: true }
    const cfg = normalizeConfig(raw)
    expect(cfg.speeds).toEqual([0.5, 1, 2])
    expect(cfg.jumpSeconds).toBe(10)
    expect(cfg.defaultVolume).toBe(80)
    expect(cfg.autoPlay).toBe(true)
    expect(cfg.resumeAfterCrop).toBe(true)
  })

  test('uses defaults for null input', () => {
    const cfg = normalizeConfig(null)
    expect(cfg.speeds).toEqual([0.75, 1, 1.25, 1.5, 2])
    expect(cfg.jumpSeconds).toBe(15)
    expect(cfg.defaultVolume).toBe(70)
    expect(cfg.autoPlay).toBe(false)
    expect(cfg.resumeAfterCrop).toBe(false)
  })

  test('uses defaults for empty object', () => {
    const cfg = normalizeConfig({})
    expect(cfg.speeds).toEqual([0.75, 1, 1.25, 1.5, 2])
    expect(cfg.jumpSeconds).toBe(15)
    expect(cfg.defaultVolume).toBe(70)
  })

  test('strips invalid speed entries and sorts', () => {
    const cfg = normalizeConfig({ speeds: [2, -1, 0, 'fast', 0.5, NaN] })
    expect(cfg.speeds).toEqual([0.5, 2])
  })

  test('falls back to defaults when speeds array is empty after filtering', () => {
    const cfg = normalizeConfig({ speeds: [-1, 0] })
    expect(cfg.speeds).toEqual([0.75, 1, 1.25, 1.5, 2])
  })

  test('clamps defaultVolume to 0-100', () => {
    expect(normalizeConfig({ defaultVolume: 150 }).defaultVolume).toBe(100)
    expect(normalizeConfig({ defaultVolume: -20 }).defaultVolume).toBe(0)
  })

  test('rounds fractional defaultVolume', () => {
    expect(normalizeConfig({ defaultVolume: 72.6 }).defaultVolume).toBe(73)
  })

  test('ignores jumpSeconds below 1', () => {
    expect(normalizeConfig({ jumpSeconds: 0 }).jumpSeconds).toBe(15)
    expect(normalizeConfig({ jumpSeconds: -5 }).jumpSeconds).toBe(15)
  })

  test('truncates fractional jumpSeconds', () => {
    expect(normalizeConfig({ jumpSeconds: 7.9 }).jumpSeconds).toBe(7)
  })

  test('treats non-boolean autoPlay as false', () => {
    expect(normalizeConfig({ autoPlay: 1 }).autoPlay).toBe(false)
    expect(normalizeConfig({ autoPlay: 'yes' }).autoPlay).toBe(false)
    expect(normalizeConfig({ autoPlay: true }).autoPlay).toBe(true)
  })

  test('treats non-boolean resumeAfterCrop as false', () => {
    expect(normalizeConfig({ resumeAfterCrop: 1 }).resumeAfterCrop).toBe(false)
    expect(normalizeConfig({ resumeAfterCrop: true }).resumeAfterCrop).toBe(true)
  })
})
