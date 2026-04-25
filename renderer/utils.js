function formatTime(seconds) {
  if (isNaN(seconds) || !isFinite(seconds) || seconds < 0) return '00:00'
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
    autoPlay:        raw?.autoPlay === true,
    resumeAfterCrop: raw?.resumeAfterCrop === true,
    autoCheckUpdate: raw?.autoCheckUpdate !== false,
    hideDelay:       (typeof raw?.hideDelay === 'number' && raw.hideDelay >= 1 && isFinite(raw.hideDelay))
                       ? Math.floor(raw.hideDelay) : 3,
    glassOpacity:    (typeof raw?.glassOpacity === 'number' && isFinite(raw.glassOpacity))
                       ? clamp(Math.round(raw.glassOpacity), 0, 100) : 42,
  }
}

// ── Path helpers ──────────────────────────────────────────────
function normalizePath(p) {
  return (p || '').replace(/\\/g, '/')
}

function getFolderPath(filePath) {
  const p = normalizePath(filePath)
  const idx = p.lastIndexOf('/')
  return idx > 0 ? p.slice(0, idx) : ''
}

function getFolderName(folderPath) {
  return normalizePath(folderPath).split('/').filter(Boolean).pop() || folderPath
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Returns the adjacent file in a sorted list, or null if out of bounds.
// delta: -1 for previous, +1 for next.
function getAdjacentEpisode(files, currentFilePath, delta) {
  if (!Array.isArray(files) || !files.length) return null
  const normCurrent = normalizePath(currentFilePath)
  const idx = files.findIndex(f => normalizePath(f) === normCurrent)
  if (idx < 0) return null
  const newIdx = idx + delta
  if (newIdx < 0 || newIdx >= files.length) return null
  return files[newIdx]
}

// Builds (or updates) a course-data entry.
// existing: previous entry or {}; files: sorted list; currentIndex: index of current file.
// Returns new entry object. Pure — no side-effects.
function buildCourseEntry(existing, files, currentIndex, filePath, folderPath) {
  const prevMaxIndex = existing.maxEpisodeIndex ?? -1
  const newMaxIndex  = Math.max(prevMaxIndex, currentIndex)
  return {
    folderName:      getFolderName(folderPath),
    maxEpisodeIndex: newMaxIndex,
    maxEpisodeFile:  currentIndex >= prevMaxIndex ? filePath : (existing.maxEpisodeFile || filePath),
    totalFiles:      files.length,
    playCount:       (existing.playCount || 0) + 1,
    lastAccessed:    Date.now(),
  }
}

// Browser: globals. Node (Jest): module.exports
if (typeof module !== 'undefined') module.exports = {
  formatTime, clamp, normalizeConfig,
  normalizePath, getFolderPath, getFolderName, escapeHtml, getAdjacentEpisode,
  buildCourseEntry,
}
