# Changelog

## [2.0.4] - 2026-09-04

2.0.1-2.0.3 each patched a new cause of the same "browser tab restore
duplicates tabs" report, and a live user test after 2.0.3 still duplicated -
now with the pinned-tab count untouched and the open-tab count multiplying on
every single restore click. All five prior causes traced back to one
mechanism: closing and relaunching an *already-running* browser window to
force its tabs to match the saved snapshot. That depends on a multi-process
browser's shutdown and IPC-driven tab-adding finishing in a way a shell
script cannot fully observe or control, and kept finding new races no matter
how many of its individual failure modes got patched (cmdline pollution,
pinned tabs, Chrome's own crash-restore, the close/relaunch race).

### Changed

- **Removed the close-and-relaunch mechanism entirely.** Restore now leaves
  an already-running browser's tabs alone - the window is matched and moved
  to its saved workspace like any other window, nothing is closed and
  nothing is relaunched. Captured tabs are only ever launched for a browser
  window that is *not* currently running, which is the actual reboot /
  login-restore case this plugin exists for, where there's nothing already
  open to duplicate against. That spawn path is unchanged and keeps the
  cmdline-pollution strip (`browserRelaunchBase`) and Chrome crash-flag reset
  (`resetChromiumCrashFlagLines`) from 2.0.1/2.0.2.
- Removed the pid-wait-then-relaunch code added in 2.0.3
  (`waitForPidExitLines` and the close dispatch it supported) along with the
  mechanism it existed to make safer.

Verified live: restoring a session with an already-open, multi-tab Chrome
window no longer changes its tab count at all.

## [2.0.3] - 2026-09-04

Consolidates the 2.0.1-2.0.3 patch releases, all chasing the same user report
("browser tab restore is duplicating tabs") through five independent causes
found one after another as each earlier fix exposed the next.

### Fixed

- **Browser tab restore was opening far more tabs than it should, compounding
  on every restore.** Five causes, all in browser-tab handling:
  1. Once a browser window was ever restored via `exec browser url1 url2 ...`,
     that argv stayed in the process's `/proc/<pid>/cmdline` for as long as the
     browser kept running - `exec` replaces the process image. The *next*
     capture read that polluted cmdline back as the window's `command`, and
     restore used it as the launch base and appended the newly-captured tabs
     on top, so the old tab list was replayed and grew on every single
     restore. Fixed with `browserRelaunchBase`: for any browser window, the
     relaunch command now keeps only the executable and flag-style arguments
     (e.g. `--profile-directory=Default`) from the captured cmdline and
     discards every bare positional argument (i.e. URLs) - the tab list always
     comes fresh from the capture, never from history. Self-healing: this
     fixes restore for profiles saved before the fix too, since it operates at
     restore time.
  2. Pinned tabs were captured and restored like any other tab, even though
     Chrome/Firefox recreate pinned tabs on their own the next time a window
     opens - so restoring them too duplicated every pinned tab. Fixed in
     `scripts/capture_tabs.py`: Firefox tabs marked `pinned` in the session
     store are skipped, and Chromium/Chrome/Brave/Vivaldi pinned URLs (read
     from the profile's `Preferences` `pinned_tabs` list) are excluded from
     capture. This one only fixes *future* saves - profiles saved before this
     fix still have pinned URLs baked into their `tabs` array until re-saved.
  3. `buildTabUrls` now also collapses exact-duplicate URLs within one
     snapshot, so a tab is never listed twice regardless of cause.
  4. **The actual remaining cause after 1-3: Chrome/Chromium's own
     crash-restore.** Chrome auto-restores its previous session on launch
     whenever its profile's `Preferences` has `profile.exit_type` other than
     `"Normal"` - regardless of the URLs passed on the command line - and
     merges that restored session in with the tabs we explicitly asked for.
     A profile ends up in that state after any exit that was not Chrome's own
     clean quit, which an unclean shutdown (a reboot where Chrome did not get
     to exit first) reliably produces - exactly the login-restore case this
     plugin exists for. Fixed: before relaunching a Chromium-family browser,
     the restore script now resets `profile.exit_type` to `"Normal"` via
     `jq` (best-effort; a missing/unreadable Preferences file is skipped, not
     an error). Verified live: forcing `exit_type` to `"Crashed"` and
     restoring a 3-tab profile came back with exactly 3 tabs, not 6.
  5. **The real remaining cause, found from a live user report after 2.0.2:
     closing a matched browser window did not wait for the process to
     actually exit.** `hl.dsp.window.close` only sends a close request; the
     code then slept a fixed 1.5s before relaunching. Browsers are
     single-instance - if the old process had not actually quit in that
     window, the "relaunch" a moment later did not replace it, it attached to
     the still-open window over IPC and added the captured tabs as *new*
     tabs onto the ones already there, doubling every one (pinned tabs,
     already excluded by fix 2, were correctly unaffected - exactly what was
     reported: 3 tabs became 6, 9 pinned tabs stayed 9). Fixed: the restore
     script now polls `kill -0` on the closed window's pid (up to ~15s)
     before relaunching, instead of a fixed sleep. Verified live: 3
     consecutive real (non-`--dry-run`) restores in a row, tab count stayed
     flat.

- Capture no longer records the Omarchy shell's own bar/panel surfaces
  (window class `org.quickshell`) as if they were a user app. Restoring one
  used to spawn a redundant second shell instance and made restore report an
  extra "window" that was never a real app. Existing saved profiles still
  carry it until re-saved.

## [2.0.0] - 2026-09-03

Forked from [Workspace Restorer](https://github.com/Davedes83/workspace-restorer)
1.1.1 by Davedes83 and renamed to **Session Restore**. The snapshot/restore
engine, `scripts/capture_tabs.py`, and the pure helpers in `restoreLogic.mjs`
originate there (MIT — see [NOTICE](NOTICE)).

### Added

- **Standalone `bin/session-restore` CLI (Node)** — the single snapshot/restore
  engine. Subcommands: `save`, `restore`, `list`, `status`, `delete`,
  `boot-profile`, plus `restore --boot` for the login path and `--dry-run`.
  The bar widget and the login service both shell out to it.
- **Restore at login** via a `service` entry point
  (`kinds: ["bar-widget", "service"]`, `keepLoaded`). It runs `restore --boot`
  a few seconds after each shell start; the CLI acts only if the Hyprland
  instance is younger than `SESSION_RESTORE_BOOT_WINDOW` seconds (default 120)
  and it has not already run for this Hyprland instance — a stamp in
  `$XDG_RUNTIME_DIR/session-restore/applied` keyed to
  `$HYPRLAND_INSTANCE_SIGNATURE`, so a mid-session `omarchy restart shell` and
  a runtime dir that survived a fast relogin both do the right thing.
- **Three-pass window matching** on restore (exact class+title, then class +
  current workspace, then class only) so multi-window same-class apps no longer
  swap workspaces when their titles have drifted.
- **Bar panel rebuilt** on the Omarchy `Ui` kit: hero with the pinned-session
  name, "Save current session", per-row **pin** to arm/disarm login restore,
  an **update-from-current-layout** action on the pinned row, two-click delete,
  an explainer, a Node-missing banner, and a foot line that describes whatever
  control the mouse is over.
- Pure, unit-tested builders in `restoreLogic.mjs`: `assembleWindows`,
  `buildSnapshot`, `buildRestoreScript`, `wrapRestoreRunner`,
  `resolveBrowserProfile`, `procInfoScript` / `parseProcInfo`,
  `tabCaptureInvocations` / `parseTabResults` / `attachTabs`,
  `bootMarkerPath` / `bootMarkerMatches`, `isFreshLogin`.

### Changed

- Plugin renamed: id `davedes.workspace-restorer` → `io.github.dreed47.session-restore`.
- Profile storage moved `~/.config/omarchy/workspace-restorer/` →
  `~/.config/omarchy/session-restore/`. Existing profiles are not migrated —
  copy the directory across if you used the upstream plugin.
- New runtime requirement: `node` >= 18.
- `resolveBrowserProfile` recognises Google Chrome's real `/opt/google/chrome/chrome`
  command line (was `null`, which disabled tab capture for Chrome).
- App launches on restore are `setsid`-detached with closed stdio so a
  relaunched browser can't hold the caller open.

### Deferred — blocked on Hyprland core

- **Tiled layout restore** (window-beside-window, split ratios). Needs Hyprland
  to expose the dwindle tree + ratios, which it does not
  ([hyprwm/Hyprland#13035](https://github.com/hyprwm/Hyprland/discussions/13035);
  the `splitratio` dispatcher was also removed). Not being built as a geometry
  heuristic — see [docs/tiled-layout-restore.md](docs/tiled-layout-restore.md),
  which also carries the note to add on the upstream thread once this plugin is
  on the marketplace.

---

Pre-fork history (Workspace Restorer 1.0.0 – 1.1.1, 2026-08): initial release,
browser-tab restore fixes, and security hardening of the tab-capture inputs.
See the [upstream changelog](https://github.com/Davedes83/workspace-restorer/blob/master/CHANGELOG.md).
