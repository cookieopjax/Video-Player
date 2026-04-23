const {
  formatTime, clamp, normalizeConfig,
  normalizePath, getFolderPath, getFolderName, escapeHtml, getAdjacentEpisode,
} = require('../renderer/utils')

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

  test('autoCheckUpdate defaults to true', () => {
    expect(normalizeConfig({}).autoCheckUpdate).toBe(true)
    expect(normalizeConfig(null).autoCheckUpdate).toBe(true)
  })

  test('autoCheckUpdate is false only when explicitly false', () => {
    expect(normalizeConfig({ autoCheckUpdate: false }).autoCheckUpdate).toBe(false)
    expect(normalizeConfig({ autoCheckUpdate: true }).autoCheckUpdate).toBe(true)
    expect(normalizeConfig({ autoCheckUpdate: 0 }).autoCheckUpdate).toBe(true)
  })
})

// ── normalizePath ──────────────────────────────────────────────
describe('normalizePath', () => {
  test('converts backslashes to forward slashes', () => {
    expect(normalizePath('C:\\Users\\foo\\bar.mp4')).toBe('C:/Users/foo/bar.mp4')
  })
  test('leaves forward slashes unchanged', () => {
    expect(normalizePath('/Users/foo/bar.mp4')).toBe('/Users/foo/bar.mp4')
  })
  test('returns empty string for null', () => {
    expect(normalizePath(null)).toBe('')
  })
  test('returns empty string for undefined', () => {
    expect(normalizePath(undefined)).toBe('')
  })
  test('handles mixed slashes', () => {
    expect(normalizePath('C:/Users\\foo/bar')).toBe('C:/Users/foo/bar')
  })
})

// ── getFolderPath ──────────────────────────────────────────────
describe('getFolderPath', () => {
  test('returns folder from Windows backslash path', () => {
    expect(getFolderPath('C:\\Videos\\Course\\ep01.mp4')).toBe('C:/Videos/Course')
  })
  test('returns folder from Unix path', () => {
    expect(getFolderPath('/home/user/videos/ep01.mp4')).toBe('/home/user/videos')
  })
  test('returns empty string when no directory separator', () => {
    expect(getFolderPath('file.mp4')).toBe('')
  })
  test('handles path with only one level', () => {
    expect(getFolderPath('/file.mp4')).toBe('')
  })
})

// ── getFolderName ──────────────────────────────────────────────
describe('getFolderName', () => {
  test('returns last path segment', () => {
    expect(getFolderName('C:/Videos/A科目')).toBe('A科目')
  })
  test('handles Windows backslash path', () => {
    expect(getFolderName('C:\\Videos\\Course')).toBe('Course')
  })
  test('ignores trailing slash', () => {
    expect(getFolderName('/Videos/Course/')).toBe('Course')
  })
  test('returns full path as fallback for root path', () => {
    expect(getFolderName('CourseName')).toBe('CourseName')
  })
})

// ── escapeHtml ─────────────────────────────────────────────────
describe('escapeHtml', () => {
  test('escapes angle brackets', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;')
  })
  test('escapes ampersand', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b')
  })
  test('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;')
  })
  test('leaves safe text unchanged', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World')
  })
  test('converts non-string values to string', () => {
    expect(escapeHtml(123)).toBe('123')
  })
  test('handles all special chars together', () => {
    expect(escapeHtml('<a href="x&y">')).toBe('&lt;a href=&quot;x&amp;y&quot;&gt;')
  })
})

// ── getAdjacentEpisode ─────────────────────────────────────────
describe('getAdjacentEpisode', () => {
  const files = ['/videos/ep1.mp4', '/videos/ep2.mp4', '/videos/ep3.mp4']

  test('returns next episode', () => {
    expect(getAdjacentEpisode(files, '/videos/ep1.mp4', 1)).toBe('/videos/ep2.mp4')
  })
  test('returns previous episode', () => {
    expect(getAdjacentEpisode(files, '/videos/ep2.mp4', -1)).toBe('/videos/ep1.mp4')
  })
  test('returns null when already at first and going backward', () => {
    expect(getAdjacentEpisode(files, '/videos/ep1.mp4', -1)).toBeNull()
  })
  test('returns null when already at last and going forward', () => {
    expect(getAdjacentEpisode(files, '/videos/ep3.mp4', 1)).toBeNull()
  })
  test('returns null when file not found in list', () => {
    expect(getAdjacentEpisode(files, '/videos/unknown.mp4', 1)).toBeNull()
  })
  test('returns null for empty list', () => {
    expect(getAdjacentEpisode([], '/videos/ep1.mp4', 1)).toBeNull()
  })
  test('handles Windows backslash paths', () => {
    const winFiles = ['C:\\videos\\ep1.mp4', 'C:\\videos\\ep2.mp4', 'C:\\videos\\ep3.mp4']
    expect(getAdjacentEpisode(winFiles, 'C:\\videos\\ep2.mp4', 1)).toBe('C:\\videos\\ep3.mp4')
    expect(getAdjacentEpisode(winFiles, 'C:\\videos\\ep2.mp4', -1)).toBe('C:\\videos\\ep1.mp4')
  })
  test('matches cross-slash: backslash in list, forward slash in current', () => {
    const winFiles = ['C:\\videos\\ep1.mp4', 'C:\\videos\\ep2.mp4']
    expect(getAdjacentEpisode(winFiles, 'C:/videos/ep1.mp4', 1)).toBe('C:\\videos\\ep2.mp4')
  })
  test('skips by delta=2 when within bounds', () => {
    expect(getAdjacentEpisode(files, '/videos/ep1.mp4', 2)).toBe('/videos/ep3.mp4')
  })
})
