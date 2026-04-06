// ── Element refs ──────────────────────────────────────────────
const video        = document.getElementById('video')
const btnPlayPause = document.getElementById('btn-playpause')
const progressTrack = document.getElementById('progress-track')
const progressFill  = document.getElementById('progress-fill')
const progressThumb = document.getElementById('progress-thumb')
const timeDisplay   = document.getElementById('time-display')
const filenameEl    = document.getElementById('filename')
const dropOverlay   = document.getElementById('drop-overlay')
const btnSpeed      = document.getElementById('btn-speed')
const speedDropdown = document.getElementById('speed-dropdown')
const labelBackward = document.getElementById('label-backward')
const labelForward  = document.getElementById('label-forward')
const volTrack      = document.getElementById('vol-track')
const volFill       = document.getElementById('vol-fill')
const volThumb      = document.getElementById('vol-thumb')
const volLabel      = document.getElementById('vol-label')
const volIcon       = document.getElementById('vol-icon')

// ── State ──────────────────────────────────────────────────────
let config = { speeds: [0.5, 1.0, 1.5, 2.0], jumpSeconds: 10, defaultVolume: 70 }
let isDraggingProgress = false
let isDraggingVolume   = false
let currentSpeed       = 1.0

// ── Play / Pause ───────────────────────────────────────────────
function updatePlayButton() {
  btnPlayPause.textContent = video.paused ? '\u25B6' : '\u23F8'
}

btnPlayPause.addEventListener('click', () => {
  if (video.src) video.paused ? video.play() : video.pause()
})
video.addEventListener('play',  updatePlayButton)
video.addEventListener('pause', updatePlayButton)

// ── Progress bar ───────────────────────────────────────────────
function updateProgress() {
  if (!video.duration || isDraggingProgress) return
  const pct = (video.currentTime / video.duration) * 100
  progressFill.style.width = pct + '%'
  progressThumb.style.left = pct + '%'
  timeDisplay.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`
}

video.addEventListener('timeupdate', updateProgress)
video.addEventListener('loadedmetadata', () => {
  timeDisplay.textContent = `00:00 / ${formatTime(video.duration)}`
  updateProgress()
})

function seekFromEvent(e) {
  const rect = progressTrack.getBoundingClientRect()
  const pct  = clamp((e.clientX - rect.left) / rect.width, 0, 1)
  video.currentTime = pct * video.duration
}

progressTrack.addEventListener('mousedown', (e) => {
  isDraggingProgress = true
  seekFromEvent(e)
})
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
      document.querySelectorAll('.speed-item').forEach((el) => el.classList.remove('active'))
      item.classList.add('active')
      speedDropdown.classList.add('hidden')
    })
    speedDropdown.appendChild(item)
  })
}

btnSpeed.addEventListener('click', (e) => {
  e.stopPropagation()
  speedDropdown.classList.toggle('hidden')
})
document.addEventListener('click', () => speedDropdown.classList.add('hidden'))

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
  if (!video.src) return
  if (e.target.tagName === 'INPUT') return
  switch (e.code) {
    case 'Space':
      e.preventDefault()
      video.paused ? video.play() : video.pause()
      break
    case 'ArrowLeft':
      e.preventDefault()
      video.currentTime = clamp(video.currentTime - config.jumpSeconds, 0, video.duration)
      break
    case 'ArrowRight':
      e.preventDefault()
      video.currentTime = clamp(video.currentTime + config.jumpSeconds, 0, video.duration)
      break
  }
})

// ── Volume control ─────────────────────────────────────────────
function setVolume(v) {
  const vol = clamp(v, 0, 1)
  video.volume = vol
  const pct = Math.round(vol * 100)
  volFill.style.width  = pct + '%'
  volThumb.style.left  = pct + '%'
  volLabel.textContent = pct + '%'
}

function volumeFromEvent(e) {
  const rect = volTrack.getBoundingClientRect()
  setVolume((e.clientX - rect.left) / rect.width)
}

volTrack.addEventListener('mousedown', (e) => {
  isDraggingVolume = true
  volumeFromEvent(e)
})
document.addEventListener('mousemove', (e) => { if (isDraggingVolume) volumeFromEvent(e) })
document.addEventListener('mouseup',   ()  => { isDraggingVolume = false })

document.getElementById('volume-wrap').addEventListener('wheel', (e) => {
  e.preventDefault()
  setVolume(video.volume + (e.deltaY < 0 ? 0.05 : -0.05))
}, { passive: false })

volIcon.addEventListener('click', () => {
  video.muted = !video.muted
  volIcon.textContent = video.muted ? '\uD83D\uDD07' : '\uD83D\uDD0A'
})

// ── File opening ───────────────────────────────────────────────
function loadFile(filePath) {
  video.src = 'file:///' + filePath.replace(/\\/g, '/').replace(/ /g, '%20')
  filenameEl.textContent = '\uD83D\uDCC4 ' + filePath.split(/[\\/]/).pop()
  video.play()
}

document.getElementById('btn-open').addEventListener('click', async () => {
  const filePath = await window.electronAPI.openFile()
  if (filePath) loadFile(filePath)
})

document.addEventListener('dragover', (e) => {
  e.preventDefault()
  dropOverlay.classList.add('active')
})
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) dropOverlay.classList.remove('active')
})
document.addEventListener('drop', (e) => {
  e.preventDefault()
  dropOverlay.classList.remove('active')
  const file = e.dataTransfer.files[0]
  if (file) loadFile(file.path)
})

// ── Init ───────────────────────────────────────────────────────
async function init() {
  config = await window.electronAPI.getConfig()
  setVolume(config.defaultVolume / 100)
  buildSpeedMenu()
  updateJumpLabels()
}

init()
