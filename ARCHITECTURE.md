# Architecture

## Process model

Standard Electron two-process model:

```
┌─────────────────────────────────┐
│  Main process (main.js)         │
│  Node.js — full OS access       │
│  • BrowserWindow                │
│  • ipcMain handlers             │
│  • dialog, clipboard, fs        │
│  • electron-updater             │
└───────────────┬─────────────────┘
                │ IPC (invoke/handle + send/on)
                │ contextBridge
┌───────────────▼─────────────────┐
│  Renderer process               │
│  Chromium — no Node access      │
│  • index.html / style.css       │
│  • utils.js + player.js         │
│  • window.electronAPI (bridge)  │
└─────────────────────────────────┘
```

`nodeIntegration: false`, `contextIsolation: true`. The renderer never touches Node APIs directly — everything goes through `preload.js` via `contextBridge.exposeInMainWorld`.

## IPC surface (preload.js ↔ main.js)

### invoke/handle (request-response)

| Renderer call | IPC channel | Main handler |
|---------------|-------------|--------------|
| `electronAPI.getConfig()` | `get-config` | Reads and returns config (userData path when packaged, project root in dev) |
| `electronAPI.getVersion()` | `get-version` | Returns `app.getVersion()` |
| `electronAPI.openFile()` | `open-file` | `dialog.showOpenDialog`, returns path or null |
| `electronAPI.saveConfig(cfg)` | `save-config` | `fs.writeFileSync` to config path |
| `electronAPI.copyImage(bytes)` | `copy-image` | `nativeImage.createFromBuffer` + `clipboard.writeImage` |
| `electronAPI.winMinimize()` | `win-minimize` | `mainWin.minimize()` |
| `electronAPI.winMaximize()` | `win-maximize` | toggle maximize/unmaximize |
| `electronAPI.winClose()` | `win-close` | `mainWin.close()` |
| `electronAPI.checkUpdate()` | `check-update` | `autoUpdater.checkForUpdates()` (no-op in dev) |
| `electronAPI.downloadUpdate()` | `download-update` | `autoUpdater.downloadUpdate()` |
| `electronAPI.installUpdate()` | `install-update` | `autoUpdater.quitAndInstall()` |
| `electronAPI.openDefaultAppsSettings()` | `open-default-apps-settings` | Opens Windows `ms-settings:defaultapps` or returns `{platform:'mac'}` |
| `electronAPI.listFolderVideos(path)` | `list-folder-videos` | `fs.readdirSync` filtered to video exts, sorted natural order |

### send/on (push from main → renderer)

| Event | IPC channel | Payload |
|-------|-------------|---------|
| `electronAPI.onUpdateStatus(cb)` | `update-status` | `{ state, version?, percent?, message?, latestVersion? }` |
| `electronAPI.onFileArg(cb)` | `open-file-arg` | `filePath` string |

## Renderer layout (CSS)

The window is a `position: relative` body. All three layers are `position: absolute`:

```
body (position: relative, 100vw × 100vh)
├── #app-titlebar   (absolute, top: 0,    z-index: 10) ← glass overlay
├── #video-container (absolute, inset: 0)
│   ├── <video>
│   ├── #loading-overlay
│   ├── #playpause-anim
│   ├── #recent-overlay        ← course panel (shown when no video loaded)
│   └── #crop-canvas
└── #controls       (absolute, bottom: 0, z-index: 10) ← glass overlay
    ├── #progress-wrap
    ├── #btn-row               ← watched by ctrlResizeObserver
    └── #controls-right        ← watched by volResizeObserver
```

`#app-titlebar` and `#controls` float over the video with `backdrop-filter: blur(48px)`. `--glass-alpha` CSS var controls opacity (default 0.42, configurable via settings).

In fullscreen (`body.fullscreen`), `#app-titlebar` is hidden and `#controls` switches to `position: fixed` with opacity 0 by default; `controls-visible` class is toggled on mousemove with a configurable auto-hide timer (`config.hideDelay`, default 3 s).

## player.js — state and responsibilities

Global state:
```js
config              // loaded from main via IPC on init, normalised by normalizeConfig()
isDraggingProgress  // blocks timeupdate seeks during drag
isDraggingVolume    // horizontal volume track drag
isDraggingVolVert   // vertical popup volume track drag
currentSpeed        // current playback rate
currentFilePath     // key for localStorage position memory
saveTimer           // debounce handle for position writes
fsHideTimer         // fullscreen auto-hide timer
isAutoResyncing     // true during AV-sync watchdog seek (suppresses loading indicator)
lastSeekTimestamp   // ms of last jump/seek — togglePlay() ignores clicks within 400 ms
currentFolderFiles  // sorted video list for current folder (from list-folder-videos IPC)
currentFolderIndex  // index of currentFilePath in currentFolderFiles
// Course / watch-time
watchAccum          // accumulated play seconds for current file
watchPlayStart      // wall-clock ms of last play start (null if paused)
progressCommitted   // true once commitCourseProgress fired for this file load
```

Key responsibilities:
- **Playback**: `togglePlay()`, play/pause/ended listeners → `updatePlayButton()`. Quick-seek guard: ignores play/pause clicks within 400 ms of `lastSeekTimestamp`.
- **Progress**: `seekFromEvent()` uses `progressTrack.getBoundingClientRect()` for pixel-accurate seeks. `isDraggingProgress` blocks `timeupdate` updates during drag.
- **Position memory**: `timeupdate` debounces a 4 s write to `localStorage['pos:' + path]`. `loadedmetadata` restores if saved > 0 and < duration − 2 s.
- **AV-sync watchdog**: `scheduleAvResync()` sets a 60 s timer that force-seeks `video.currentTime = video.currentTime` to flush decoder drift. `isAutoResyncing` suppresses the loading overlay during this invisible seek.
- **Volume**: Horizontal track drag + vertical popup drag (compact mode) + wheel ±5%. `saveFolderVolume()` persists per folder on mouseup/wheel. `applyFolderVolume()` restores on file load.
- **Compact mode**: `volResizeObserver` on `#controls-right` toggles `vol-compact` body class (ON < 320 px, OFF > 390 px). `ctrlResizeObserver` on `#btn-row` toggles `ctrl-compact` (ON < 520 px, OFF > 570 px). Hysteresis prevents oscillation.
- **Speed**: `buildSpeedMenu()` populates the dropdown from `config.speeds`. Dropdown toggled by speed button, closed on any `document.click`.
- **Folder navigation**: `loadFolderContext()` fires on each `loadFile()` — calls `listFolderVideos` IPC, builds `currentFolderFiles`, enables/disables prev/next buttons. Prev/next buttons call `loadFile()` with adjacent path.
- **Course progress**: After `PROGRESS_MIN_SECS` (300 s) of actual playback, `commitCourseProgress()` writes to `localStorage['courseData']`. Entry tracks `maxEpisodeIndex`, `maxEpisodeFile`, `totalFiles`, `playCount`, `lastAccessed`.
- **Course panel**: `renderCoursePanel()` shown on home button click or when no video is loaded. Shows up to 6 course cards sorted by play count / last accessed.
- **Screenshot**: `startCrop()` sets canvas size from `parentElement.clientWidth/Height` (not `getBoundingClientRect` which returns 0 on hidden elements). Drag selection draws dimmed overlay with transparent cutout. `finalizeCrop()` draws to offscreen canvas at native video resolution and sends PNG bytes via `copyImage` IPC.
- **Settings**: Opens a modal, mirrors `config` into local state. Auto-saves 600 ms after any change via `scheduleAutoSave()`. Writes via `saveConfig` IPC and updates live state.
- **Auto-updater UI**: Listens to `onUpdateStatus` IPC events and updates the settings panel update section.

## utils.js — pure functions

All functions are available as globals in the renderer and as CommonJS exports for Jest.

| Function | Purpose |
|----------|---------|
| `formatTime(seconds)` | Formats `mm:ss` or `h:mm:ss` |
| `clamp(value, min, max)` | Clamps a number |
| `normalizeConfig(raw)` | Validates and fills defaults for a raw config object |
| `normalizePath(p)` | Converts backslashes to forward slashes |
| `getFolderPath(filePath)` | Returns directory portion of a file path |
| `getFolderName(folderPath)` | Returns last path segment |
| `escapeHtml(str)` | HTML-escapes a string for safe innerHTML |
| `getAdjacentEpisode(files, current, delta)` | Returns prev (−1) or next (+1) file in a list, or null |
| `buildCourseEntry(existing, files, idx, filePath, folderPath)` | Pure function — builds/updates a courseData entry |

## Hit areas

Both progress bar and volume track are visually 3 px but have a 20 px tall interaction zone:
- The `#progress-track` and `#vol-track` elements are `height: 20px`
- The visual bar is rendered by a `::before` pseudo-element (`height: 3px`, `top: 50%`)
- Fill and thumb use `position: absolute; top: 50%; transform: translateY(-50%)`
- `mousedown` on `#progress-wrap` (not `#progress-track`) gives additional vertical tolerance

## Config file

**Dev**: `config.json` at project root (`__dirname`).  
**Packaged**: `app.getPath('userData')/config.json`. If missing, falls back to `resources/default-config.json` (bundled via `extraResources`), then to hardcoded DEFAULTS.

`readConfig()` in main catches parse errors and falls back. `save-config` IPC handler creates the directory if needed, then overwrites with `JSON.stringify(cfg, null, 2)`.

## Auto-updater

Uses `electron-updater` pointed at GitHub Releases (`cookieopjax/Video-Player`).

- `autoDownload: false` — user must click Download in settings
- `autoInstallOnAppQuit: false` — user must click Install
- `Cache-Control: no-cache` request header prevents CDN-cached stale `latest.yml`
- In dev (`!app.isPackaged`), `check-update` IPC returns an error message without actually calling the updater
- Auto-check runs 3 s after app ready if `config.autoCheckUpdate !== false` (packaged only)

## File association / multi-window

No single-instance lock — multiple windows can open simultaneously (since v1.2.9).

On launch with a file argument (double-click or OS file association), `findFileArg(process.argv)` extracts the path. It's stored in `pendingFileArg` and sent to the renderer via `open-file-arg` IPC once `did-finish-load` fires.

## Icon generation

`scripts/gen-icon.js` draws a 512×512 PNG pixel-by-pixel using `pngjs`:
- Superellipse (squircle) shape with 4×4 MSAA
- Dark gradient background + specular highlights
- White anti-aliased play triangle, optically offset right

Run with `node scripts/gen-icon.js` to regenerate `assets/icon.png`.

## Build

`electron-builder` targets Windows NSIS + portable (`npm run build → dist/`).

```json
"files": ["main.js", "preload.js", "renderer/**/*"],
"extraResources": [{ "from": "config.json", "to": "default-config.json" }]
```

`node_modules` are excluded (devDependencies only, nothing runtime — except `electron-updater` which is a production dependency).
