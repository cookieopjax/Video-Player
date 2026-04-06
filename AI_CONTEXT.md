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
| Change config schema | `config.json` + `main.js:readConfig` defaults + `player.js:init()` + settings panel HTML/JS |
| Regenerate icon | `scripts/gen-icon.js` → `node scripts/gen-icon.js` |
| Add keyboard shortcut | `renderer/player.js` keydown handler |

## CSS layout (important — non-obvious)

The window is NOT a flex column. Body is `position: relative`. Everything is absolutely positioned:
- `#app-titlebar` → `position: absolute; top: 0; z-index: 10` (glass overlay on video)
- `#video-container` → `position: absolute; inset: 0` (full window)
- `#controls` → `position: absolute; bottom: 0; z-index: 10` (glass overlay on video)

In fullscreen, `#controls` switches to `position: fixed` and uses opacity/transform for auto-hide.

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

## State that lives in localStorage (renderer)

- `pos:<filePath>` → playback position (seconds, float). Saved every 4 s via debounce, restored on `loadedmetadata`.
- `recentFiles` → JSON array of file paths, max 8, newest first.

## Known patterns / gotchas

**Progress bar and volume hit area**: Both tracks are visually 3 px but the elements are 20 px tall. Visual bar is a `::before` pseudo-element centered at 50%. Fill/thumb use `position: absolute; top: 50%; transform: translateY(-50%)`. The `mousedown` for progress is on `#progress-wrap` (not `#progress-track`) for extra tolerance.

**Screenshot crop canvas dimensions**: `startCrop()` must use `cropCanvas.parentElement.clientWidth/Height`, NOT `getBoundingClientRect()` on the canvas itself — the canvas has `display: none` when inactive, which returns `{width:0, height:0}`.

**Crop drag events**: `mousedown` on canvas, but `mousemove` and `mouseup` on `document`. Otherwise fast mouse movement outside the canvas drops the drag. `isCropping` boolean gates the document listeners.

**Speed dropdown close**: Closed by any `document.click`. The button's own click calls `e.stopPropagation()` to prevent immediate re-close.

**Settings modal animation**: Uses opacity transition (not `display:none`/flex toggle). `hidden` class sets `display: none`. Open sequence: remove `hidden` → next rAF add `visible`. Close: remove `visible` → listen for `transitionend` → add `hidden`.

**utils.js dual export**: Must work both as a plain `<script>` in Electron renderer and as a CommonJS module in Jest. Pattern:
```js
if (typeof module !== 'undefined') module.exports = { formatTime, clamp }
```

**config.json location**: Same directory as `main.js` (project root). `__dirname` in main process resolves correctly. Do NOT put it inside `renderer/`.

## Current version: 1.1.0

### Changelog
- `1.0.0` — Initial: play/pause, progress, speed menu, keyboard, volume, file open/drop, custom titlebar, fullscreen, position memory, play/pause animation
- `1.1.0` — Screenshot crop tool, settings panel, recent files, overlay layout (glass over video), progress/vol hit area fix, removed dblclick fullscreen, settings animation, new Apple-style icon

## Suggested next features (not yet built)

- Subtitle support (.srt / .vtt)
- Picture-in-picture mode
- Playlist / queue
- Mouse wheel to seek (horizontal scroll)
- Window size memory
