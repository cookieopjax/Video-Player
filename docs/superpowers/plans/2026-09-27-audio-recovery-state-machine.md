# Audio Recovery State Machine Implementation Plan

> **Goal:** Keep video moving through short damaged-audio regions, play those regions silently, and restore audio automatically after the stream becomes healthy.

**Architecture:** Replace the overlapping media-error, stall, and manual-resync paths with one recovery controller. A pure policy produces deterministic actions; a media adapter owns every reload, seek, timer, and audio-track switch. Chromium's narrow `AudioVideoTracks` runtime feature enables actual audio-track disabling, which bypasses audio decoding rather than merely silencing output.

**Tech:** Electron 28 / Chromium 120, HTMLMediaElement, Blink `AudioVideoTracks`, Jest

**Design:** [2026-09-27-multiwindow-audio-recovery-design.md](../specs/2026-09-27-multiwindow-audio-recovery-design.md)

## Constraints and review focus

- Video continuity has priority over audio continuity.
- First recovery probe begins after 6 seconds of successful video-only media-time progress.
- Two seconds of successful progress with audio enabled confirms recovery.
- Failed probes retry after 6, 12, then 30 seconds, capped at 30 seconds.
- User mute is independent of recovery mute/track state.
- Every asynchronous callback is invalidated when a new source begins.
- Do not add FFmpeg or another external binary in this release.

### Task 1: Build the deterministic recovery policy

**Files:**
- Create: `renderer/media-recovery.js`
- Create: `tests/media-recovery.test.js`
- Modify: `renderer/index.html`

1. Write failing tests for `createRecoveryPolicy()`:
   - decode error requests one restart at current time + 0.25 seconds with audio disabled;
   - 6 seconds of video-only media progress requests an audio probe;
   - 2 seconds of probe progress returns to normal;
   - a failed probe disables audio immediately and increases retry delay through 6, 12, and 30 seconds;
   - first confirmed stall requests a normal restart;
   - a second nearby stall escalates to video-only;
   - meaningful healthy progress clears stall escalation.
2. Run the focused test and confirm it fails.
3. Implement the policy with `reset`, `decodeError`, `stall`, `progress`, `restartSucceeded`, `restartFailed`, and `snapshot`.
4. Keep it free of DOM and timer dependencies.
5. Re-run the focused test and commit.

### Task 2: Implement the single media recovery controller

**Files:**
- Modify: `renderer/media-recovery.js`
- Modify: `tests/media-recovery.test.js`

1. Add fake-media tests for `createMediaRecoveryController({ media, timers, onAction })`:
   - reload once, disable the actual audio track before seeking, restore playback rate, and resume play;
   - stale callbacks from a previous source do nothing;
   - an 8-second restart timeout clears its listeners and chooses a safe fallback;
   - missing `audioTracks` fails safely without looping;
   - an error while already video-only does not recursively reload forever;
   - user mute remains independent from track-disable recovery.
2. Implement controller methods `beginSource`, `cancel`, `handleError`, `handleWaiting`, `handlePlaying`, `handlePause`, `handleTimeUpdate`, `resync`, and `setUserMuted`.
3. Make the controller the only owner of recovery listeners, timers, reloads, and recovery seeks.
4. Guard every listener and timeout with a monotonically increasing source session token.
5. Re-run focused tests and commit.

### Task 3: Integrate recovery with the player

**Files:**
- Modify: `main.js`
- Modify: `renderer/index.html`
- Modify: `renderer/player.js`
- Modify: `tests/media-recovery.test.js`

1. Enable only `AudioVideoTracks` with `app.commandLine.appendSwitch('enable-blink-features', 'AudioVideoTracks')` before app readiness.
2. Instantiate one controller for the video element and map controller state/actions to concise toast messages.
3. Route `error`, `waiting`, `playing`, `pause`, and `timeupdate` events through the controller.
4. Delete the old decode-error counters, reload timers, seek-back stall workaround, and competing resync listeners.
5. Call `beginSource` for every new file and `cancel` when returning to the course panel.
6. Delegate manual resync to `controller.resync()`.
7. Route mute changes through `setUserMuted` without altering recovery track state.
8. Run focused tests, all Jest tests, and syntax checks; commit.

### Task 4: Documentation, version, CI, and release

**Files:**
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `AI_CONTEXT.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`
- Modify: `package-lock.json`

1. Document multi-window shared settings and automatic damaged-audio recovery.
2. Update architecture notes to describe the single-process window registry and recovery state machine.
3. Correct CI branch filters from `main` to the repository's actual default branch `master`.
4. Bump the application version from 1.5.1 to 1.5.2 in package metadata.
5. Run the full Jest suite, syntax checks, and `npm run build -- --dir "--config.win.signAndEditExecutable=false"`.
6. Inspect the complete diff for unrelated or generated changes.
7. Merge the isolated worktree branch into `master`, push `master`, create and push annotated tag `v1.5.2`.
8. Verify that the tag-triggered GitHub release workflow has started and report the run or release URL.

