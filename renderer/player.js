// ── Element refs ──────────────────────────────────────────────
const video          = document.getElementById('video')
const btnPlayPause   = document.getElementById('btn-playpause')
const iconPlay       = document.getElementById('icon-play')
const iconPause      = document.getElementById('icon-pause')
const animEl         = document.getElementById('playpause-anim')
const animSvg        = document.getElementById('anim-svg')
const progressWrap   = document.getElementById('progress-wrap')
const progressTrack  = document.getElementById('progress-track')
const progressFill   = document.getElementById('progress-fill')
const progressThumb  = document.getElementById('progress-thumb')
const timeDisplay    = document.getElementById('time-display')
const filenameEl     = document.getElementById('filename')
const dropOverlay    = document.getElementById('drop-overlay')
const loadingOverlay = document.getElementById('loading-overlay')
const controls       = document.getElementById('controls')
const btnSpeed       = document.getElementById('btn-speed')
const speedDropdown  = document.getElementById('speed-dropdown')
const labelBackward  = document.getElementById('label-backward')
const labelForward   = document.getElementById('label-forward')
const volTrack       = document.getElementById('vol-track')
const volFill        = document.getElementById('vol-fill')
const volThumb       = document.getElementById('vol-thumb')
const volLabel       = document.getElementById('vol-label')
const volIcon        = document.getElementById('vol-icon')
const volumeWrap     = document.getElementById('volume-wrap')
const volPopup       = document.getElementById('vol-popup')
const volPopupLabel  = document.getElementById('vol-popup-label')
const volTrackVert   = document.getElementById('vol-track-vert')
const volFillVert    = document.getElementById('vol-fill-vert')
const volThumbVert   = document.getElementById('vol-thumb-vert')
const cropCanvas     = document.getElementById('crop-canvas')
const settingsOverlay = document.getElementById('settings-overlay')
const speedChips     = document.getElementById('speed-chips')
const speedInput     = document.getElementById('speed-input')
const jumpInput      = document.getElementById('jump-input')
const volDefaultInput = document.getElementById('vol-default-input')
const volDefaultLabel = document.getElementById('vol-default-label')
const toastEl        = document.getElementById('toast')

// ── State ──────────────────────────────────────────────────────
let config             = { speeds: [0.5, 1.0, 1.5, 2.0], jumpSeconds: 10, defaultVolume: 70 }
let isDraggingProgress = false
let isDraggingVolume   = false
let isDraggingVolVert  = false
let currentSpeed       = 1.0
let currentFilePath    = ''
let saveTimer          = null
let fsHideTimer        = null

// ── Play/pause animation ───────────────────────────────────────
const SVG_PLAY  = '<polygon points="5,3 19,12 5,21" fill="white"/>'
const SVG_PAUSE = '<rect x="6" y="4" width="4" height="16" fill="white"/><rect x="14" y="4" width="4" height="16" fill="white"/>'

function triggerPlayAnim(willBePaused) {
  animSvg.innerHTML = willBePaused ? SVG_PLAY : SVG_PAUSE
  animEl.classList.remove('pop')
  void animEl.offsetWidth        // force reflow to restart animation
  animEl.classList.add('pop')
}

// ── Play / Pause ───────────────────────────────────────────────
function updatePlayButton() {
  const paused = video.paused || video.ended
  iconPlay.style.display  = paused  ? '' : 'none'
  iconPause.style.display = !paused ? '' : 'none'
}

function togglePlay() {
  if (!video.src) return
  const willPause = !video.paused
  triggerPlayAnim(willPause)
  willPause ? video.pause() : video.play()
}

btnPlayPause.addEventListener('click', togglePlay)
video.addEventListener('click', togglePlay)
video.addEventListener('play',  updatePlayButton)
video.addEventListener('pause', updatePlayButton)
video.addEventListener('ended', updatePlayButton)

// ── Loading indicator (debounced to avoid flicker on fast seeks) ──
let loadingTimer = null
function showLoading()  {
  clearTimeout(loadingTimer)
  loadingTimer = setTimeout(() => loadingOverlay.classList.remove('hidden'), 160)
}
function hideLoading()  {
  clearTimeout(loadingTimer)
  loadingOverlay.classList.add('hidden')
}
video.addEventListener('waiting',   showLoading)
video.addEventListener('loadstart', showLoading)
video.addEventListener('playing',   hideLoading)
video.addEventListener('canplay',   hideLoading)
video.addEventListener('seeked',    hideLoading)

// ── Video error ────────────────────────────────────────────────
video.addEventListener('error', () => {
  loadingOverlay.classList.add('hidden')
  const err = video.error
  const MSG = {
    1: '載入中止',
    2: '網路錯誤',
    3: '解碼失敗',
    4: '格式不支援',
  }
  const detail = err ? (MSG[err.code] || `錯誤 ${err.code}`) : '未知錯誤'
  showToast(`無法播放：${detail}`)
})

// ── Progress bar ───────────────────────────────────────────────
function setProgress(pct) {
  progressFill.style.width = pct + '%'
  progressThumb.style.left = pct + '%'
}

function updateProgress() {
  if (!video.duration || isDraggingProgress) return
  setProgress((video.currentTime / video.duration) * 100)
  timeDisplay.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`
}

video.addEventListener('timeupdate', () => {
  updateProgress()
  if (!currentFilePath || !video.duration) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    localStorage.setItem('pos:' + currentFilePath, video.currentTime)
  }, 4000)
})

video.addEventListener('loadedmetadata', () => {
  timeDisplay.textContent = `00:00 / ${formatTime(video.duration)}`
  setProgress(0)
  const saved = parseFloat(localStorage.getItem('pos:' + currentFilePath))
  if (saved > 0 && saved < video.duration - 2) video.currentTime = saved
})

function seekFromEvent(e) {
  if (!video.duration) return
  const rect = progressTrack.getBoundingClientRect()
  const pct  = clamp((e.clientX - rect.left) / rect.width, 0, 1)
  video.currentTime = pct * video.duration
  setProgress(pct * 100)
  timeDisplay.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`
}

progressWrap.addEventListener('mousedown', (e) => { isDraggingProgress = true; seekFromEvent(e) })
document.addEventListener('mousemove', (e) => { if (isDraggingProgress) seekFromEvent(e) })
document.addEventListener('mouseup',   ()  => { isDraggingProgress = false })

// ── Speed control ──────────────────────────────────────────────
function buildSpeedMenu() {
  speedDropdown.innerHTML = ''
  config.speeds.forEach((s) => {
    const item = document.createElement('div')
    item.className = 'speed-item' + (s === currentSpeed ? ' active' : '')
    item.textContent = s + 'x'
    item.addEventListener('click', () => {
      currentSpeed = s
      video.playbackRate = s
      btnSpeed.textContent = s + 'x \u25BE'
      localStorage.setItem('playbackSpeed', s)
      document.querySelectorAll('.speed-item').forEach((el) => el.classList.remove('active'))
      item.classList.add('active')
      speedDropdown.classList.add('hidden')
    })
    speedDropdown.appendChild(item)
  })
}

btnSpeed.addEventListener('click', (e) => { e.stopPropagation(); speedDropdown.classList.toggle('hidden') })
document.addEventListener('click', (e) => {
  speedDropdown.classList.add('hidden')
  if (!volumeWrap.contains(e.target)) volPopup.classList.add('hidden')
})

// ── Jump buttons + keyboard ────────────────────────────────────
function updateJumpLabels() {
  labelBackward.textContent = config.jumpSeconds + 's'
  labelForward.textContent  = config.jumpSeconds + 's'
}

document.getElementById('btn-backward').addEventListener('click', () => {
  video.currentTime = clamp(video.currentTime - config.jumpSeconds, 0, video.duration || 0)
})
document.getElementById('btn-forward').addEventListener('click', () => {
  video.currentTime = clamp(video.currentTime + config.jumpSeconds, 0, video.duration || 0)
})

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return
  if (e.code === 'KeyO' && e.ctrlKey) {
    e.preventDefault()
    document.getElementById('btn-open').click()
    return
  }
  switch (e.code) {
    case 'Space':
      e.preventDefault()
      if (video.src) togglePlay()
      break
    case 'ArrowLeft':
      e.preventDefault()
      if (video.src) video.currentTime = clamp(video.currentTime - config.jumpSeconds, 0, video.duration)
      break
    case 'ArrowRight':
      e.preventDefault()
      if (video.src) video.currentTime = clamp(video.currentTime + config.jumpSeconds, 0, video.duration)
      break
    case 'KeyF':
      e.preventDefault()
      toggleFullscreen()
      break
    case 'KeyS':
      e.preventDefault()
      startCrop()
      break
  }
})

// ── Volume control ─────────────────────────────────────────────
function setVolume(v) {
  const vol = clamp(v, 0, 1)
  video.volume = vol
  const pct = Math.round(vol * 100)
  volFill.style.width       = pct + '%'
  volThumb.style.left       = pct + '%'
  volLabel.textContent      = pct + '%'
  // Vertical popup track
  volFillVert.style.height  = pct + '%'
  volThumbVert.style.bottom = `calc(${pct}% - 5.5px)`
  volPopupLabel.textContent = pct + '%'
}

function volumeFromEvent(e) {
  const rect = volTrack.getBoundingClientRect()
  setVolume((e.clientX - rect.left) / rect.width)
}

volTrack.addEventListener('mousedown', (e) => { isDraggingVolume = true; volumeFromEvent(e) })
document.addEventListener('mousemove', (e) => {
  if (isDraggingVolume) volumeFromEvent(e)
  if (isDraggingVolVert) volumeFromVertEvent(e)
})
document.addEventListener('mouseup', () => { isDraggingVolume = false; isDraggingVolVert = false })

// Vertical track (compact popup)
function volumeFromVertEvent(e) {
  const rect = volTrackVert.getBoundingClientRect()
  setVolume(1 - clamp((e.clientY - rect.top) / rect.height, 0, 1))
}
volTrackVert.addEventListener('mousedown', (e) => { e.stopPropagation(); isDraggingVolVert = true; volumeFromVertEvent(e) })
volPopup.addEventListener('click', (e) => e.stopPropagation())

volumeWrap.addEventListener('wheel', (e) => {
  e.preventDefault()
  setVolume(video.volume + (e.deltaY < 0 ? 0.05 : -0.05))
}, { passive: false })

volIcon.addEventListener('click', (e) => {
  e.stopPropagation()
  if (document.body.classList.contains('vol-compact')) {
    volPopup.classList.toggle('hidden')
  } else {
    video.muted = !video.muted
    volIcon.textContent = video.muted ? '\uD83D\uDD07' : '\uD83D\uDD0A'
  }
})

// Compact mode — ResizeObserver on controls-right with hysteresis.
// compact ON < 320px, OFF only when > 390px (avoids oscillation).
let volIsCompact = false
const controlsRight = document.getElementById('controls-right')

function applyVolCompact(compact) {
  volIsCompact = compact
  document.body.classList.toggle('vol-compact', compact)
  if (!compact) volPopup.classList.add('hidden')
}

const volResizeObserver = new ResizeObserver(() => {
  const w = controlsRight.offsetWidth
  if (!volIsCompact && w < 320) applyVolCompact(true)
  else if (volIsCompact && w > 390) applyVolCompact(false)
})

// ctrl-compact — hide jump button labels when btn-row is tight.
// compact ON < 520px, OFF > 570px.
let ctrlIsCompact = false
const btnRow = document.getElementById('btn-row')

const ctrlResizeObserver = new ResizeObserver(() => {
  const w = btnRow.offsetWidth
  if (!ctrlIsCompact && w < 520) { ctrlIsCompact = true;  document.body.classList.add('ctrl-compact') }
  else if (ctrlIsCompact && w > 570) { ctrlIsCompact = false; document.body.classList.remove('ctrl-compact') }
})

// ── Fullscreen ─────────────────────────────────────────────────
function showControls() {
  controls.classList.add('controls-visible')
  clearTimeout(fsHideTimer)
  fsHideTimer = setTimeout(() => controls.classList.remove('controls-visible'), 3000)
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen()
  } else {
    document.exitFullscreen()
  }
}

document.addEventListener('fullscreenchange', () => {
  const isFs = !!document.fullscreenElement
  document.body.classList.toggle('fullscreen', isFs)
  if (isFs) showControls()
  else controls.classList.remove('controls-visible')
})

document.addEventListener('mousemove', () => {
  if (document.body.classList.contains('fullscreen')) showControls()
})

document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen)

// ── Recent files ───────────────────────────────────────────────
const RECENT_KEY = 'recentFiles'
const RECENT_MAX = 8

function getRecentFiles() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || [] } catch { return [] }
}

function addRecentFile(filePath) {
  let list = getRecentFiles().filter(p => p !== filePath)
  list.unshift(filePath)
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)))
}

function fileLabel(filePath) {
  const parts = filePath.replace(/\\/g, '/').split('/')
  return parts.length >= 2
    ? `<span class="rf-folder">${parts[parts.length - 2]}/</span><span class="rf-name">${parts[parts.length - 1]}</span>`
    : `<span class="rf-name">${parts[parts.length - 1]}</span>`
}

function renderRecentFiles() {
  const overlay = document.getElementById('recent-overlay')
  const list    = getRecentFiles()
  if (list.length === 0) { overlay.classList.add('hidden'); return }
  overlay.classList.remove('hidden')
  const ul = overlay.querySelector('#recent-list')
  ul.innerHTML = ''
  list.forEach(fp => {
    const li = document.createElement('li')
    li.innerHTML = fileLabel(fp)
    li.addEventListener('click', () => loadFile(fp))
    ul.appendChild(li)
  })
}

// ── File opening ───────────────────────────────────────────────
function formatPath(filePath) {
  const parts = filePath.replace(/\\/g, '/').split('/')
  if (parts.length >= 2) {
    return `<span>${parts[parts.length - 2]}/</span><strong>${parts[parts.length - 1]}</strong>`
  }
  return `<strong>${parts[parts.length - 1]}</strong>`
}

const SUPPORTED_EXTS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'flv', 'wmv'])

function isSupportedVideo(filePath) {
  const ext = filePath.split('.').pop().toLowerCase()
  return SUPPORTED_EXTS.has(ext)
}

function loadFile(filePath, forcePlay = false) {
  if (!isSupportedVideo(filePath)) {
    showToast('不支援的格式')
    return
  }
  currentFilePath = filePath
  addRecentFile(filePath)
  document.getElementById('recent-overlay').classList.add('hidden')
  video.src = 'file:///' + filePath.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')
  video.playbackRate = currentSpeed
  filenameEl.innerHTML = formatPath(filePath)
  if (forcePlay || config.autoPlay !== false) video.play().catch(() => { /* autoplay blocked — ignored */ })
}

document.getElementById('btn-open').addEventListener('click', async () => {
  const filePath = await window.electronAPI.openFile()
  if (filePath) loadFile(filePath)
})

document.addEventListener('dragover', (e) => { e.preventDefault(); dropOverlay.classList.add('active') })
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) dropOverlay.classList.remove('active') })
document.addEventListener('drop', (e) => {
  e.preventDefault()
  dropOverlay.classList.remove('active')
  const file = e.dataTransfer.files[0]
  if (file && file.path) loadFile(file.path)
})

// ── Window controls ────────────────────────────────────────────
document.getElementById('btn-minimize').addEventListener('click', () => window.electronAPI.winMinimize())
document.getElementById('btn-maximize').addEventListener('click', () => window.electronAPI.winMaximize())
document.getElementById('btn-close')   .addEventListener('click', () => window.electronAPI.winClose())

// ── Toast ──────────────────────────────────────────────────────
let toastTimer = null
function showToast(msg) {
  toastEl.textContent = msg
  toastEl.classList.remove('hidden', 'fade-out')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastEl.classList.add('fade-out')
    setTimeout(() => toastEl.classList.add('hidden'), 300)
  }, 1800)
}

// ── Screenshot / Crop ──────────────────────────────────────────
let cropStart        = null
let cropCtx          = null
let isCropping       = false
let cropWasPlaying   = false

function canvasPosFromEvent(e) {
  const rect = cropCanvas.getBoundingClientRect()
  return {
    x: clamp(e.clientX - rect.left, 0, cropCanvas.width),
    y: clamp(e.clientY - rect.top,  0, cropCanvas.height),
  }
}

function startCrop() {
  if (!video.src) return
  cropWasPlaying = !video.paused
  if (cropWasPlaying) video.pause()
  const container = cropCanvas.parentElement
  cropCanvas.width  = container.clientWidth
  cropCanvas.height = container.clientHeight
  cropCtx = cropCanvas.getContext('2d')
  cropCanvas.classList.add('active')
  cropStart  = null
  isCropping = false
}

function drawCropRect(x1, y1, x2, y2) {
  cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height)
  cropCtx.fillStyle = 'rgba(0,0,0,0.42)'
  cropCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height)
  const rx = Math.min(x1, x2), ry = Math.min(y1, y2)
  const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1)
  cropCtx.clearRect(rx, ry, rw, rh)
  cropCtx.strokeStyle = 'rgba(255,255,255,0.85)'
  cropCtx.lineWidth = 1.5
  cropCtx.strokeRect(rx + 0.5, ry + 0.5, rw, rh)
}

async function finalizeCrop(x1, y1, x2, y2) {
  cropCanvas.classList.remove('active')
  isCropping = false
  cropStart  = null
  if (cropWasPlaying && config.resumeAfterCrop) video.play()
  const rx = Math.min(x1, x2), ry = Math.min(y1, y2)
  const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1)
  if (rw < 4 || rh < 4) return

  const scaleX = video.videoWidth  / cropCanvas.width
  const scaleY = video.videoHeight / cropCanvas.height
  const sx = rx * scaleX, sy = ry * scaleY
  const sw = rw * scaleX, sh = rh * scaleY

  const offscreen = document.createElement('canvas')
  offscreen.width = Math.round(sw); offscreen.height = Math.round(sh)
  offscreen.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, offscreen.width, offscreen.height)
  offscreen.toBlob(async (blob) => {
    try {
      const buf = await blob.arrayBuffer()
      const result = await window.electronAPI.copyImage(new Uint8Array(buf))
      if (result && result.ok === false) throw new Error(result.error)
      showToast('已複製到剪貼簿')
    } catch (err) {
      console.error('[finalizeCrop]', err)
      showToast('截圖失敗')
    }
  }, 'image/png')
}

cropCanvas.addEventListener('mousedown', (e) => {
  e.preventDefault()
  const pos = canvasPosFromEvent(e)
  cropStart  = pos
  isCropping = true
  cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height)
})

document.addEventListener('mousemove', (e) => {
  if (!isCropping || !cropStart) return
  const pos = canvasPosFromEvent(e)
  drawCropRect(cropStart.x, cropStart.y, pos.x, pos.y)
})

document.addEventListener('mouseup', (e) => {
  if (!isCropping || !cropStart) return
  const pos = canvasPosFromEvent(e)
  finalizeCrop(cropStart.x, cropStart.y, pos.x, pos.y)
})

document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && cropCanvas.classList.contains('active')) {
    cropCanvas.classList.remove('active')
    isCropping = false
    cropStart  = null
    if (cropWasPlaying) video.play()
  }
})

document.getElementById('btn-screenshot').addEventListener('click', startCrop)

// ── Settings panel ─────────────────────────────────────────────
let editSpeeds    = []
let autoSaveTimer = null

function collectConfig() {
  return {
    speeds:          [...editSpeeds],
    jumpSeconds:     parseInt(jumpInput.value) || 10,
    defaultVolume:   parseInt(volDefaultInput.value),
    autoPlay:        document.getElementById('autoplay-input').checked,
    resumeAfterCrop: document.getElementById('resume-after-crop-input').checked,
    autoCheckUpdate: document.getElementById('auto-check-update-input').checked,
  }
}

async function autoSave() {
  if (!editSpeeds.length) return
  const newConfig = collectConfig()
  try {
    const result = await window.electronAPI.saveConfig(newConfig)
    if (result && result.ok === false) throw new Error(result.error)
    config = newConfig
    buildSpeedMenu()
    updateJumpLabels()
  } catch (err) {
    console.error('[autoSave]', err)
    showToast('儲存失敗')
  }
}

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(autoSave, 600)
}

function saveNow() {
  clearTimeout(autoSaveTimer)
  autoSave()
}

function buildSpeedChips() {
  speedChips.innerHTML = ''
  editSpeeds.forEach((s, i) => {
    const chip = document.createElement('div')
    chip.className = 'speed-chip'
    chip.innerHTML = `<span>${s}x</span><button class="speed-chip-remove" data-i="${i}">×</button>`
    chip.querySelector('.speed-chip-remove').addEventListener('click', () => {
      editSpeeds.splice(i, 1)
      buildSpeedChips()
      saveNow()
    })
    speedChips.appendChild(chip)
  })
}

function openSettings() {
  editSpeeds = [...config.speeds]
  buildSpeedChips()
  jumpInput.value = config.jumpSeconds
  volDefaultInput.value = config.defaultVolume
  volDefaultLabel.textContent = config.defaultVolume + '%'
  document.getElementById('autoplay-input').checked = config.autoPlay !== false
  document.getElementById('resume-after-crop-input').checked = !!config.resumeAfterCrop
  document.getElementById('auto-check-update-input').checked = config.autoCheckUpdate !== false
  settingsOverlay.classList.remove('hidden')
  requestAnimationFrame(() => settingsOverlay.classList.add('visible'))
}

function closeSettings() {
  clearTimeout(autoSaveTimer)
  autoSave()  // flush any pending change
  settingsOverlay.classList.remove('visible')
  settingsOverlay.addEventListener('transitionend', () => settingsOverlay.classList.add('hidden'), { once: true })
}

document.getElementById('btn-settings').addEventListener('click', openSettings)
document.getElementById('btn-settings-close').addEventListener('click', closeSettings)
settingsOverlay.addEventListener('click', (e) => { if (e.target === settingsOverlay) closeSettings() })

// Auto-save wiring
document.getElementById('autoplay-input').addEventListener('change', saveNow)
document.getElementById('resume-after-crop-input').addEventListener('change', saveNow)
document.getElementById('auto-check-update-input').addEventListener('change', saveNow)
jumpInput.addEventListener('input', scheduleAutoSave)
volDefaultInput.addEventListener('input', () => {
  volDefaultLabel.textContent = volDefaultInput.value + '%'
  scheduleAutoSave()
})

document.getElementById('btn-add-speed').addEventListener('click', () => {
  const v = parseFloat(speedInput.value)
  if (!v || v <= 0 || editSpeeds.includes(v)) return
  editSpeeds.push(v)
  editSpeeds.sort((a, b) => a - b)
  buildSpeedChips()
  speedInput.value = ''
  saveNow()
})
speedInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-add-speed').click()
})

document.getElementById('btn-set-default').addEventListener('click', async () => {
  const result = await window.electronAPI.openDefaultAppsSettings()
  if (result && result.platform === 'mac') {
    showToast('請在 Finder 中右鍵點擊影片檔案 → 打開方式 → 選擇 VideoPlayer → 全部更改')
  } else {
    showToast('請在 Windows 設定中找到 VideoPlayer 並完成設定')
  }
})

// ── Auto-updater UI ────────────────────────────────────────────
const updateStatusText    = document.getElementById('update-status-text')
const updateProgressWrap  = document.getElementById('update-progress-wrap')
const updateProgressFill  = document.getElementById('update-progress-fill')
const btnCheckUpdate      = document.getElementById('btn-check-update')
const btnDownloadUpdate   = document.getElementById('btn-download-update')
const btnInstallUpdate    = document.getElementById('btn-install-update')

function setUpdateUI(state, data = {}) {
  updateProgressWrap.classList.add('hidden')
  btnCheckUpdate.classList.remove('hidden')
  btnDownloadUpdate.classList.add('hidden')
  btnInstallUpdate.classList.add('hidden')
  btnCheckUpdate.disabled = false

  switch (state) {
    case 'checking':
      updateStatusText.textContent = '檢查中…'
      btnCheckUpdate.disabled = true
      break
    case 'up-to-date':
      updateStatusText.textContent = '已是最新版本 ✓'
      break
    case 'available':
      updateStatusText.textContent = `發現新版本 v${data.version}`
      btnCheckUpdate.classList.add('hidden')
      btnDownloadUpdate.classList.remove('hidden')
      break
    case 'downloading':
      updateStatusText.textContent = `下載中… ${data.percent ?? 0}%`
      updateProgressWrap.classList.remove('hidden')
      updateProgressFill.style.width = (data.percent ?? 0) + '%'
      btnCheckUpdate.classList.add('hidden')
      break
    case 'downloaded':
      updateStatusText.textContent = '下載完成，準備安裝'
      updateProgressFill.style.width = '100%'
      updateProgressWrap.classList.remove('hidden')
      btnCheckUpdate.classList.add('hidden')
      btnInstallUpdate.classList.remove('hidden')
      break
    case 'error':
      updateStatusText.textContent = `檢查失敗：${data.message ?? ''}`
      break
    default:
      updateStatusText.textContent = ''
  }
}

btnCheckUpdate.addEventListener('click', () => {
  setUpdateUI('checking')
  window.electronAPI.checkUpdate()
})
btnDownloadUpdate.addEventListener('click', () => {
  setUpdateUI('downloading', { percent: 0 })
  window.electronAPI.downloadUpdate()
})
btnInstallUpdate.addEventListener('click', () => window.electronAPI.installUpdate())

window.electronAPI.onUpdateStatus((status) => {
  setUpdateUI(status.state, status)
})

// ── Open via file association / double-click ───────────────────
window.electronAPI.onFileArg((filePath) => {
  loadFile(filePath, true)
})

// ── Init ───────────────────────────────────────────────────────
async function init() {
  try {
    const raw = await window.electronAPI.getConfig()
    config = normalizeConfig(raw)
  } catch (err) {
    console.error('[init] getConfig failed, using defaults', err)
    config = normalizeConfig(null)
  }

  // Restore saved speed (before buildSpeedMenu so active class is correct)
  const savedSpeed = parseFloat(localStorage.getItem('playbackSpeed'))
  if (savedSpeed > 0 && config.speeds.includes(savedSpeed)) {
    currentSpeed = savedSpeed
  }

  setVolume(config.defaultVolume / 100)
  buildSpeedMenu()
  updateJumpLabels()
  renderRecentFiles()

  video.playbackRate = currentSpeed
  btnSpeed.textContent = currentSpeed + 'x \u25BE'
  volResizeObserver.observe(controlsRight)
  ctrlResizeObserver.observe(btnRow)
  // Trigger initial checks
  applyVolCompact(controlsRight.offsetWidth < 320)
  if (btnRow.offsetWidth < 520) { ctrlIsCompact = true; document.body.classList.add('ctrl-compact') }

  try {
    const ver = await window.electronAPI.getVersion()
    document.getElementById('settings-version').textContent = 'v' + ver
  } catch { /* ignore */ }
}

init()
