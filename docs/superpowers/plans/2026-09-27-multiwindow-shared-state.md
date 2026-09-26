# Multi-window Shared State Implementation Plan

> **Goal:** Run every player window in one Electron process so all windows share one configuration and receive setting changes immediately.

**Architecture:** Replace the per-process `userData` workaround with Electron's single-instance coordinator. The primary process owns a window registry; every launch creates another `BrowserWindow`, and IPC resolves the window from the sending `webContents`. Persisted configuration remains process-global and updates are broadcast to peer renderers.

**Tech:** Electron 28, CommonJS, Jest

**Design:** [2026-09-27-multiwindow-audio-recovery-design.md](../specs/2026-09-27-multiwindow-audio-recovery-design.md)

## Constraints and review focus

- Preserve opening a video by file association or command-line argument.
- A second launch must create a new window, not focus or reuse an existing one.
- Window controls and dialogs must act on the sender's window.
- Configuration writes must be atomic from the primary process and broadcast to every other live window.
- Settings sync must not overwrite per-window playback position, playing state, mute state, volume, or speed while a video is active.

### Task 1: Extract testable window and launch helpers

**Files:**
- Create: `main/window-manager.js`
- Create: `tests/window-manager.test.js`
- Modify: `package.json`

1. Write failing tests for `findVideoFileArg(argv)` covering flags, blank launches, quoted paths, and the executable/script prefix.
2. Write failing tests for `createWindowManager({ BrowserWindow, createBrowserWindow })` covering registry add/remove, sender resolution, broadcasts excluding the sender, and destroyed windows.
3. Run `npm test -- --runInBand tests/window-manager.test.js` and confirm the new tests fail for missing behavior.
4. Implement:
   - `findVideoFileArg(argv)` returning the first supported non-flag file argument or `null`.
   - `createWindowManager(...)` with `createWindow(filePath)`, `getWindowForEvent(event)`, `broadcast(channel, payload, excludedWebContents)`, and `size`.
5. Add `main/**/*` to `build.files` so packaged builds include the module.
6. Re-run the focused tests and commit.

### Task 2: Move all launches into the primary Electron process

**Files:**
- Modify: `main.js`
- Modify: `main/window-manager.js`
- Modify: `tests/window-manager.test.js`

1. Add failing tests for `resolveSecondInstanceFile(additionalData, argv)` preferring validated `additionalData.filePath` and falling back to argv parsing.
2. Request the single-instance lock with the initial file path as `additionalData`; when denied, quit immediately.
3. Remove the PID-specific `userData` path and duplicate startup argument parsing.
4. Convert the existing window construction into a factory registered with the window manager.
5. On `second-instance`, always call `createWindow(resolvedFilePath)`.
6. Change minimize, maximize, close, dialogs, and other window-specific IPC handlers to use `BrowserWindow.fromWebContents(event.sender)` through the manager.
7. Broadcast updater state to every live window rather than a single global window.
8. Run focused tests plus `node --check main.js` and commit.

### Task 3: Synchronize settings immediately across windows

**Files:**
- Create: `renderer/config-sync.js`
- Create: `tests/config-sync.test.js`
- Modify: `renderer/index.html`
- Modify: `preload.js`
- Modify: `main.js`
- Modify: `renderer/player.js`

1. Write failing tests for `createConfigSync({ normalizeConfig, applyConfig })`: normalization, identical-update suppression, and applying changed settings once.
2. Implement the pure config synchronizer and load it before `player.js`.
3. Expose `onConfigUpdated(callback)` from preload and return an unsubscribe function.
4. After a successful `save-config`, update the process-global config and broadcast `config-updated` to peer windows, excluding the sender.
5. Centralize renderer configuration application so the initial load and broadcasts update menu mode, jump interval, glass settings, and other global preferences.
6. Keep live playback state local: do not replace current position, playing state, mute, active volume, or active speed on an already loaded video.
7. Add tests, run `npm test -- --runInBand tests/config-sync.test.js tests/window-manager.test.js`, then run the full suite and commit.

### Task 4: Multi-window integration verification

**Files:**
- Modify if required by failures: `main.js`, `preload.js`, `renderer/player.js`

1. Run all Jest tests.
2. Run syntax checks for every changed JavaScript file.
3. Build an unpacked Windows application.
4. Launch two windows through the packaged executable and verify that changing a global setting in one updates the other without losing either window's playback state.
5. Record any manual-only verification in the final handoff and commit fixes if required.

