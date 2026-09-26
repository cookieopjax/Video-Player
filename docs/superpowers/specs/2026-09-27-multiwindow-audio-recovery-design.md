# Multi-window shared state and audio recovery design

Date: 2026-09-27
Target release: 1.5.2

## Intent

Video Player must support multiple independent playback windows without splitting user settings or saved playback state. When a damaged audio segment causes Chromium's media pipeline to fail, video playback must recover automatically, continue silently across the damaged span, and restore audio after the playhead has moved beyond it.

The user has authorized autonomous patch-version increments and release publication after verified completion. This change will therefore ship as v1.5.2 after tests, packaging checks, merge, push, tag creation, and confirmation that the GitHub Release workflow started.

## Root causes

### Multi-window state isolation

The current app deliberately starts every additional launch as a separate Electron process and changes its `userData` path to `userData-<pid>`. That avoids Chromium profile locking, but `userData` is also the default location for Electron session data such as localStorage. The packaged config path is derived from the same changed directory. Each extra window therefore receives a different config file, localStorage database, course history, positions, speed, and per-folder volume.

### Audio recovery loops

The current renderer has three independent mechanisms that mutate the same media element:

- the `error` handler reloads, seeks, and eventually sets `video.muted`;
- the `waiting` watchdog seeks backward;
- manual resync reloads and attaches another `canplay` handler.

Those mechanisms have separate counters, listeners, and timers, so stale callbacks can race with a new file or another recovery attempt. More importantly, `video.muted` only suppresses output. It does not remove the damaged audio track from Chromium's decode pipeline, so reloading the same source can fail again even while the UI claims to be in silent playback.

Electron 28 / Chromium 120 was probed directly. `HTMLMediaElement.audioTracks` is unavailable by default but is exposed by the narrow `--enable-blink-features=AudioVideoTracks` switch. Chromium forwards changes to the enabled audio-track IDs into its media player, which lets the app disable the audio track rather than merely mute its output.

## Approaches considered

### Selected: one Electron process, many windows; native audio-track fallback

The primary Electron process owns every BrowserWindow. Later executable launches send their file argument to the primary process through `second-instance`, then exit. Each request creates another playback window in the same Electron session. This follows Electron's single-instance coordination model while preserving the user's multi-window behavior.

For damaged audio, a single recovery controller owns all reloads, seeks, audio-track changes, and recovery timeouts. It disables the actual audio track during the damaged span, then probes audio again after media time has advanced.

Advantages:

- shared config and browser storage without cross-process synchronization;
- no Chromium profile-lock conflict;
- no new binary dependency or installer-size increase;
- deterministic ownership of media recovery actions;
- normal audio can return automatically after a short damaged interval.

Risk: `AudioVideoTracks` is a Chromium experimental Blink feature. The application pins Electron 28, and the capability was verified in that runtime. The controller will still fail safely if the API is unexpectedly unavailable.

### Rejected: keep many processes and synchronize their data

This would require a shared config location, atomic cross-process writes, an IPC or socket channel for immediate updates, and a separate replacement for localStorage. It retains the profile workaround while adding races and duplicated coordination infrastructure.

### Reserved fallback: bundle an FFmpeg executable and remux video-only copies

Removing audio with FFmpeg stream copy would be robust for files Chromium cannot recover itself, but it adds a platform-specific binary, packaging complexity, installer size, temporary-file lifecycle, and GPL distribution obligations for common static builds. This remains a future fallback if real damaged samples demonstrate that track disabling is insufficient.

## Multi-window architecture

### Instance lifecycle

1. Parse the launch file argument before requesting the single-instance lock.
2. The first process acquires the lock and initializes the app.
3. A later process passes its file path in `additionalData`, calls `app.quit()`, and does not initialize Chromium.
4. The primary process handles `second-instance` by creating a new BrowserWindow. A launch without a video creates a blank player window; a launch with a video opens it in the new window.
5. The primary process maintains a `Set` of open windows and removes entries on `closed`.

All BrowserWindows use the same default Electron session and stable `userData`, so config, localStorage, course history, positions, selected speed, and folder volume share one backing store.

### Window-scoped IPC

IPC handlers for minimize, maximize, and close resolve the calling window with `BrowserWindow.fromWebContents(event.sender)` instead of operating on one global `mainWin`. Update status is broadcast to all live windows.

### Immediate config synchronization

`save-config` writes the shared config once, then broadcasts `config-updated` to every other window. The preload exposes a subscription API. Each renderer normalizes the received config and reapplies settings that are safe to change live:

- speed-menu choices;
- jump interval and button labels;
- toolbar hide delay;
- glass opacity;
- autoplay, crop-resume, and updater preferences for subsequent actions;
- default volume for subsequently opened files.

Current playback position, pause state, playback speed, mute state, and current volume remain window-local so one player does not unexpectedly control another. Shared localStorage updates remain available to newly opened files and refreshed course panels.

## Audio recovery architecture

### Single owner

A new renderer module provides a testable recovery state machine and controller. `player.js` delegates media errors, stalls, manual resync, file changes, and progress updates to it. No other code may call `video.load()` or perform recovery seeks.

Each loaded file receives a monotonically increasing session token. Every asynchronous listener and timeout captures that token and becomes a no-op after a file change, return to the course panel, or controller cancellation.

### States

- `normal`: audio and video tracks enabled.
- `restarting`: controlled pipeline reload and seek in progress.
- `video-only`: audio tracks disabled; video continues across the damaged span.
- `probing-audio`: audio track re-enabled at the current playhead to test whether the damaged span has passed.
- `failed`: recovery could not produce playable video; timers stop and the UI remains interactive.

### Decode-error flow

1. A `MEDIA_ERR_DECODE` in `normal` records the failure media time and starts a controlled restart.
2. The controller rebuilds the resource pipeline, disables all audio tracks as soon as tracks are available, seeks just beyond the failing packet, and resumes video.
3. The renderer shows a persistent but non-blocking message that audio is temporarily unavailable and will be retried automatically.
4. After the playhead advances six seconds, the controller enters `probing-audio` and re-enables audio tracks without rewinding the video.
5. If playback advances normally for two seconds, recovery returns to `normal` and the user is notified that audio has recovered.
6. If another decode error occurs during the probe, audio is disabled immediately. The next probe is delayed by another six seconds. Repeated failures back off to 12 and then 30 seconds to prevent a retry loop while still allowing later recovery.
7. User mute is independent of forced video-only mode. Restoring an audio track never unmutes a window the user intentionally muted.

### Stall flow

`waiting` alone is not treated as corruption. A progress watchdog records the last observed media time and wall-clock progress. It acts only while playback is requested, after initial metadata has loaded, and when media time has failed to advance for a sustained interval.

- The first confirmed stall performs one controlled normal restart slightly ahead of the current time.
- A second confirmed stall near the same media position enters the same video-only flow as a decode error.
- `playing`, meaningful `timeupdate`, pause, seek completion, file change, and course-panel navigation cancel the relevant watchdog state.

This removes the unconditional seek-back behavior that can repeatedly re-enter the same damaged packets.

### Controlled restart sequence

The controller owns one restart sequence at a time:

1. cancel prior recovery listeners and timers;
2. capture source, requested play state, playback rate, user mute, target time, and session token;
3. reassign the source to clear the fatal decoder state;
4. on metadata, apply the requested audio-track mode;
5. seek to the bounded target;
6. after seek completion, restore rate and user mute, then resume if previously playing;
7. abort with an actionable error after eight seconds if metadata or seek completion never arrives.

Manual resync uses this same sequence and preserves the current audio mode. It cannot race with automatic recovery.

## Failure behavior

- Unsupported formats and non-decode media errors remain terminal and show their existing diagnostic details.
- If audio-track control is unavailable, the controller attempts one bounded forward restart and then reports that video-only recovery is unavailable; it does not loop.
- If video-only playback also decodes unsuccessfully, the controller stops recovery, clears the loading overlay, preserves navigation controls, and offers copyable diagnostics.
- Opening another file always resets recovery state and restores normal audio-track selection.

## Testing strategy

### Multi-window tests

- a secondary launch creates a new window in the primary process;
- file arguments are routed to the correct new window;
- window-control IPC targets the sender's BrowserWindow;
- config updates are broadcast to other windows but do not echo indefinitely;
- closing one window does not affect the others.

Electron-specific code will use small injected collaborators or exported pure helpers so Jest can exercise coordination without launching a GUI.

### Recovery-state tests

Using a fake media adapter and fake timers:

- decode error enters video-only restart;
- audio stays disabled while media time advances through the six-second window;
- the controller probes audio after the threshold;
- two seconds of successful progress restores normal mode;
- a failed probe immediately returns to video-only mode and backs off;
- stale callbacks from an earlier file cannot seek or play the current file;
- initial loading does not trigger stall recovery;
- repeated stalls escalate once and cannot create overlapping restarts;
- manual resync and automatic recovery share one restart owner;
- terminal recovery clears timers and leaves the player controllable.

Existing utility tests and a full packaging build remain required. The direct Electron capability probe for `AudioVideoTracks` is documented as runtime evidence; CI unit tests cover the controller behavior through its adapter boundary.

## Documentation and release

Update README, architecture notes, and AI context to describe:

- one process with multiple BrowserWindows;
- shared versus window-local state;
- the audio recovery states and automatic restoration;
- the narrow Chromium feature flag;
- release version 1.5.2.

After implementation, run the complete Jest suite, JavaScript syntax checks, and packaging verification. Merge to `master`, push, create lightweight tag `v1.5.2`, push the tag, and verify that the GitHub Release workflow has started.
