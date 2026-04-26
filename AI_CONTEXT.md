# AI Context

Quick reference for any AI assistant resuming work on this project. Read this + ARCHITECTURE.md before making changes.

## What this project is

A personal Electron video player (Windows) built from scratch. The owner's specific pain points vs. market players:
1. Speed control buried in nested menus — here it's first-level UI, always visible
2. Keyboard shortcuts in other players control speed — here keyboard only controls seek (configurable jump seconds)
3. Everything is configurable via `config.json` or the in-app settings panel

## Owner preferences

- **UI style**: Apple minimal / liquid glass. `backdrop-filter: blur(48px)`, CSS vars for all colors, no gradients on UI elements (only on icon). Dark: `#1c1c1e` bg.
- **Accent color**: White (`rgba(255,255,255,0.88)`) — no colored accents in the UI itself
- **Code style**: Plain JS (no TypeScript, no bundler, no frameworks). Vanilla HTML/CSS/JS in renderer. ES6+ OK.
- **Responses**: Traditional Chinese (繁體中文)
- **Tone**: Concise. Don't explain obvious things. Don't add features beyond what's asked.

## File map (what to edit for what)

| Task | Files |
|------|-------|
| New IPC channel | `main.js` (add handler) + `preload.js` (expose) + `renderer/player.js` (call) |
| New UI element | `renderer/index.html` + `renderer/style.css` + `renderer/player.js` |
| Change visual style | `renderer/style.css` — CSS vars in `:root` are the main levers |
| Change config schema | `config.json` + `main.js` DEFAULTS + `renderer/utils.js:normalizeConfig()` + settings panel HTML/JS |
| Regenerate icon | `scripts/gen-icon.js` → `node scripts/gen-icon.js` |
| Add keyboard shortcut | `renderer/player.js` keydown handler |
| Add path/course utility | `renderer/utils.js` (also export for Jest) |

## CSS layout (important — non-obvious)

The window is NOT a flex column. Body is `position: relative`. Everything is absolutely positioned:
- `#app-titlebar` → `position: absolute; top: 0; z-index: 10` (glass overlay on video)
- `#video-container` → `position: absolute; inset: 0` (full window)
- `#controls` → `position: absolute; bottom: 0; z-index: 10` (glass overlay on video)

In fullscreen, `#controls` switches to `position: fixed` and uses opacity/transform for auto-hide.

**Compact mode**: ResizeObserver watches `#controls-right` and `#btn-row`:
- `vol-compact` class on body: compact ON < 320 px, OFF only when > 390 px (hysteresis prevents oscillation)
- `ctrl-compact` class on body: compact ON < 520 px, OFF > 570 px

## IPC pattern

All native OS access goes through IPC. Never give renderer direct Node access.

```js
// main.js
ipcMain.handle('channel-name', async (event, arg) => { /* ... */ return result })

// preload.js
contextBridge.exposeInMainWorld('electronAPI', {
  doThing: (arg) => ipcRenderer.invoke('channel-name', arg)
})

// player.js (renderer)
const result = await window.electronAPI.doThing(arg)
```

## Config schema (current)

Defined in `main.js` DEFAULTS and validated by `utils.js:normalizeConfig()`:

```json
{
  "speeds":          [0.75, 1, 1.25, 1.5, 2],
  "jumpSeconds":     15,
  "defaultVolume":   70,
  "autoPlay":        false,
  "resumeAfterCrop": false,
  "autoCheckUpdate": true,
  "hideDelay":       3,
  "glassOpacity":    42
}
```

**Config file path**: In dev, `config.json` at project root (`__dirname`). When packaged (`app.isPackaged`), it lives in `app.getPath('userData')`. The bundled `default-config.json` (via `extraResources`) is only read as a fallback for packaged builds with no user config.

## State that lives in localStorage (renderer)

- `pos:<filePath>` → playback position (seconds, float). Saved every 4 s via debounce, restored on `loadedmetadata`.
- `vol:<folderPath>` → per-folder volume (0–100 integer). Saved on mouseup after drag or wheel.
- `playbackSpeed` → last-used playback speed (float). Restored on init if it's in `config.speeds`.
- `courseData` → JSON object keyed by folder path. Each entry: `{ folderName, maxEpisodeIndex, maxEpisodeFile, totalFiles, playCount, lastAccessed }`.

## Known patterns / gotchas

**Progress bar and volume hit area**: Both tracks are visually 3 px but the elements are 20 px tall. Visual bar is a `::before` pseudo-element centered at 50%. Fill/thumb use `position: absolute; top: 50%; transform: translateY(-50%)`. The `mousedown` for progress is on `#progress-wrap` (not `#progress-track`) for extra tolerance.

**Screenshot crop canvas dimensions**: `startCrop()` must use `cropCanvas.parentElement.clientWidth/Height`, NOT `getBoundingClientRect()` on the canvas itself — the canvas has `display: none` when inactive, which returns `{width:0, height:0}`.

**Crop drag events**: `mousedown` on canvas, but `mousemove` and `mouseup` on `document`. Otherwise fast mouse movement outside the canvas drops the drag. `isCropping` boolean gates the document listeners.

**Speed dropdown close**: Closed by any `document.click`. The button's own click calls `e.stopPropagation()` to prevent immediate re-close.

**Settings modal animation**: Uses opacity transition (not `display:none`/flex toggle). `hidden` class sets `display: none`. Open sequence: remove `hidden` → next rAF add `visible`. Close: remove `visible` → listen for `transitionend` → add `hidden`.

**utils.js dual export**: Must work both as a plain `<script>` in Electron renderer and as a CommonJS module in Jest. Pattern:
```js
if (typeof module !== 'undefined') module.exports = { formatTime, clamp, ... }
```

**Quick-seek debounce**: Jump buttons and arrow keys set `lastSeekTimestamp = Date.now()`. `togglePlay()` ignores clicks within 400 ms of a seek to prevent accidental play/pause when tapping jump buttons fast.

**AV-sync watchdog**: While playing, a 60 s timer force-seeks to `video.currentTime` to flush decoder drift. `isAutoResyncing` flag suppresses the loading indicator during these invisible seeks.

**Course progress commit**: Triggered after `PROGRESS_MIN_SECS` (300 s) of actual playback. Uses `watchAccum` + `watchPlayStart` wall-clock tracking. `progressCommitted` flag prevents duplicate writes per file load.

**Folder navigation**: `loadFolderContext()` fires and forgets on every `loadFile()`, calling `list-folder-videos` IPC to get a sorted list of videos in the same folder. Prev/next buttons are enabled/disabled based on `currentFolderIndex`.

**Auto-updater**: Uses `electron-updater`. `autoDownload` is false — user must click Download. In dev mode (`!app.isPackaged`), `check-update` returns an error message instead of actually checking. `Cache-Control: no-cache` header prevents CDN from serving stale `latest.yml`.

**Volume popup (compact mode)**: When `vol-compact` class is on body, the volume icon click toggles `#vol-popup` (vertical slider) instead of muting. `volPopup.addEventListener('click', e => e.stopPropagation())` prevents the document click handler from immediately closing the popup.

## Current version: 1.3.0

### Changelog
- `1.0.0` — Initial: play/pause, progress, speed menu, keyboard, volume, file open/drop, custom titlebar, fullscreen, position memory, play/pause animation
- `1.1.0` — Screenshot crop tool, settings panel, recent files, overlay layout (glass over video), progress/vol hit area fix, removed dblclick fullscreen, settings animation, new Apple-style icon
- `1.2.x` — Auto-updater (electron-updater + GitHub Releases), file-association / double-click open, folder/episode navigation (prev/next), course progress panel (replaces recent files), per-folder volume, compact responsive layout (ResizeObserver), new config fields (autoPlay, resumeAfterCrop, autoCheckUpdate, hideDelay, glassOpacity), packaged config path moved to userData, multiple-window support (removed single-instance lock)
- `1.3.0` — AV-sync watchdog (60 s force-seek), quick-seek debounce for play/pause, UI redesign

## Suggested next features (not yet built)

- Subtitle support (.srt / .vtt)
- Picture-in-picture mode
- Playlist / queue
- Mouse wheel to seek (horizontal scroll)
- Window size memory
