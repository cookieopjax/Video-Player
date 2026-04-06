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
└───────────────┬─────────────────┘
                │ IPC (invoke/handle)
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

## IPC surface (preload.js → main.js)

| Renderer call | IPC channel | Main handler |
|---------------|-------------|--------------|
| `electronAPI.getConfig()` | `get-config` | Reads and returns `config.json` |
| `electronAPI.openFile()` | `open-file` | `dialog.showOpenDialog`, returns path or null |
| `electronAPI.saveConfig(cfg)` | `save-config` | `fs.writeFileSync` config.json |
| `electronAPI.copyImage(bytes)` | `copy-image` | `nativeImage.createFromBuffer` + `clipboard.writeImage` |
| `electronAPI.winMinimize()` | `win-minimize` | `mainWin.minimize()` |
| `electronAPI.winMaximize()` | `win-maximize` | toggle maximize/unmaximize |
| `electronAPI.winClose()` | `win-close` | `mainWin.close()` |

## Renderer layout (CSS)

The window is a `position: relative` body. All three layers are `position: absolute`:

```
body (position: relative, 100vw × 100vh)
├── #app-titlebar   (absolute, top: 0,    z-index: 10) ← glass overlay
├── #video-container (absolute, inset: 0)
│   ├── <video>
│   ├── #loading-overlay
│   ├── #playpause-anim
│   ├── #recent-overlay
│   └── #crop-canvas
└── #controls       (absolute, bottom: 0, z-index: 10) ← glass overlay
```

`#app-titlebar` and `#controls` float over the video with `backdrop-filter: blur(48px)`. The video renders underneath at full window size.

In fullscreen (`body.fullscreen`), `#app-titlebar` is hidden and `#controls` switches to `position: fixed` with opacity 0 by default; `controls-visible` class is toggled on mousemove with a 3 s auto-hide timer.

## player.js — state and responsibilities

Global state:
```js
config             // loaded from main via IPC on init
isDraggingProgress // prevents timeupdate seeking during drag
isDraggingVolume
currentSpeed
currentFilePath    // key for localStorage position memory
isCropping         // crop overlay active
editSpeeds         // temporary array during settings edit
```

Key responsibilities:
- **Playback**: `togglePlay()`, play/pause/ended listeners → `updatePlayButton()`
- **Progress**: `seekFromEvent()` uses `progressTrack.getBoundingClientRect()` for pixel-accurate seeks. `isDraggingProgress` blocks `timeupdate` updates during drag. Both bar mousedown and document mousemove/mouseup handle the drag.
- **Position memory**: `timeupdate` debounces a 4 s write to `localStorage['pos:' + path]`. `loadedmetadata` restores if saved > 0 and < duration − 2 s.
- **Volume**: same drag pattern as progress. Wheel event on `#volume-wrap` adjusts ±5%.
- **Speed**: `buildSpeedMenu()` populates the dropdown from `config.speeds`. Dropdown is toggled by the speed button, closed on any `document.click`.
- **Screenshot**: `startCrop()` sets canvas size from `parentElement.clientWidth/Height` (not `getBoundingClientRect` which returns 0 on hidden elements). Drag selection draws a dimmed overlay with a transparent cutout. `finalizeCrop()` draws to an offscreen canvas at native video resolution (`video.videoWidth/Height`) and sends PNG bytes to main via `copyImage` IPC.
- **Settings**: opens a modal, mirrors `config` into local `editSpeeds` array. Chips can be added/removed. On save, writes via `saveConfig` IPC and updates live state.
- **Recent files**: stored in `localStorage['recentFiles']` as a JSON array of up to 8 paths. Rendered on the `#recent-overlay` when no video is loaded.

## Hit areas

Both progress bar and volume track are visually 3 px but have a 20 px tall interaction zone:
- The `#progress-track` and `#vol-track` elements are `height: 20px`
- The visual bar is rendered by a `::before` pseudo-element (`height: 3px`, `top: 50%`)
- Fill and thumb use `position: absolute; top: 50%; transform: translateY(-50%)`
- `mousedown` on `#progress-wrap` (not `#progress-track`) gives additional vertical tolerance

## Config file

`config.json` is in the project root (next to `main.js`). `readConfig()` in main catches parse errors and falls back to defaults. `save-config` IPC handler overwrites the file with `JSON.stringify(cfg, null, 2)`.

## Icon generation

`scripts/gen-icon.js` draws a 256×256 PNG pixel-by-pixel using `pngjs`:
- Superellipse (squircle) shape with exponent N=5 and 4×4 MSAA
- Dark blue-gray gradient background
- Top-left specular highlight + top-edge rim highlight
- White anti-aliased play triangle, optically offset right

Run with `node scripts/gen-icon.js` to regenerate `assets/icon.png`.

## Build

`electron-builder` targets Windows NSIS (`npm run build → dist/`). The `build.files` array in `package.json` explicitly lists what gets bundled:
```json
["main.js", "preload.js", "renderer/**/*", "config.json"]
```
`node_modules` are excluded (devDependencies only, nothing runtime).
