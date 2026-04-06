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

// Browser: globals. Node (Jest): module.exports
if (typeof module !== 'undefined') module.exports = { formatTime, clamp }
