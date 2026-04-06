function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

// Sanitise a raw config object — guarantees all required keys exist with valid values.
function normalizeConfig(raw) {
  const DEFAULT_SPEEDS = [0.75, 1, 1.25, 1.5, 2]
  const speeds = Array.isArray(raw && raw.speeds)
    ? raw.speeds.filter(s => typeof s === 'number' && s > 0 && isFinite(s)).sort((a, b) => a - b)
    : []
  return {
    speeds:         speeds.length ? speeds : DEFAULT_SPEEDS,
    jumpSeconds:    (typeof raw?.jumpSeconds === 'number' && raw.jumpSeconds >= 1 && isFinite(raw.jumpSeconds))
                      ? Math.floor(raw.jumpSeconds) : 15,
    defaultVolume:  (typeof raw?.defaultVolume === 'number' && isFinite(raw.defaultVolume))
                      ? clamp(Math.round(raw.defaultVolume), 0, 100) : 70,
    autoPlay:       raw?.autoPlay === true,
    resumeAfterCrop: raw?.resumeAfterCrop === true,
  }
}

// Browser: globals. Node (Jest): module.exports
if (typeof module !== 'undefined') module.exports = { formatTime, clamp, normalizeConfig }
