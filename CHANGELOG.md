# Changelog

## [2.4.1] - 2026-09-14

### Security

- **Automatic restore no longer runs `mise env` in captured project directories.** Restore still `cd`s to the captured cwd, but it stopped evaluating `mise env -s bash` there — that ran unattended, with no trust check, so a project directory's own `mise.toml` (`[env]` exec templates, tasks, hooks) could get silent shell execution on every login/reboot restore, including one that was modified after being trusted for unrelated reasons. Project env (mise, direnv, ...) should now load through the user's own interactive shell activation in the spawned terminal, where its normal trust prompts still apply. (reported via marketplace review)

## [2.4.0] - 2026-09-11

### Added

- **Missing-monitor fallback.** If a saved output is gone (undocked laptop), workspaces that were on it are pinned to the focused remaining monitor instead of dispatching a move to a name Hyprland does not have.
- **Pinned session refreshes on logout.** The service registers a Hyprland `exec-shutdown` hook (once per compositor instance, so a mid-session shell restart does not add another) that runs `save --boot`. No pin set is a no-op.

### Changed

- Capture skips Hyprland special/scratchpad workspaces, xdg-desktop-portal, polkit, and notification daemons (`mako` / `dunst` / `swaync`), in addition to `org.quickshell`.
- `save` no longer warns about missing `python3` unless browser tab restore is on.
- README and NOTICE cover web-app restore, logout pin refresh, missing-monitor
  fallback, capture skips, and the `jq` requirement.

## [2.3.3] - 2026-09-11

### Fixed

- **Web apps still restored as extra normal browser windows, never as the app.** Execing `chrome --app=URL` (with or without waiting for session restore) does not create an Omarchy web-app window — that path is `omarchy-launch-webapp`, which goes through `uwsm-app` and the user's default Chromium-family browser. Restore now launches URL-style web-app classes (`chrome-youtube.com__-Default`, `brave-…`, `msedge-…`, `vivaldi-…`, `opera-…`, `helium-…`, `chromium-…`) with `omarchy-launch-webapp https://host/`, after the main browser window, and records that command at save time so they no longer share the browser's `/proc` cmdline.

## [2.3.2] - 2026-09-11

### Fixed

- **`--app=` as the first Chrome launch restored a normal Chrome window onto the web-app workspace.** Starting Chrome with `--app=https://youtube.com` makes that process the session-restore target, so the regular browser lands on ws6 instead of a YouTube app window. Restore now starts the main Chrome window first, waits briefly for the web-app class to appear from Chrome's own session, and only then runs `--app=` if it is still missing.

## [2.3.1] - 2026-09-11

### Fixed

- **Chrome web apps (YouTube, etc.) restored onto the wrong workspace.** A window like `chrome-youtube.com__-Default` shares Chrome's PID, so the captured command is bare `chrome` with no `--app`. Restore launched a second normal Chrome window, which Chrome's single-instance process opened on whichever workspace the first Chrome had mapped (usually ws1). Restore now rebuilds `--app=https://host` / `--app-id=` from the window class. The safety pass also polls every spawned class in one loop (a hashed Telegram app_id can no longer stall the Chrome moves behind a 15s timeout) and matches `initialClass` as well as `class`.

## [2.3.0] - 2026-09-11

### Fixed

- **`settings.json` showed up as a saved session.** Tab-restore stored its toggle as `settings.json` in the profile directory, and `list` treated every `*.json` as a session. Settings now live in `.settings.json` (hidden from list); an existing `settings.json` that is actually the toggle is migrated. A real session named `settings` is left alone.

### Security

- Profile directory reads, writes, and deletes go through a hardened store in `lib/io.mjs`: `O_NOFOLLOW` (never follow a symlink), fstat regular-file + owner, 8 MB byte cap, max 512 windows / 300 tabs / 256 profiles. Saves are atomic (same-dir exclusive temp + rename). A planted symlink or FIFO can no longer redirect a login restore.

### Changed

- **Dropped the `jq` rewrite of Chrome `Preferences` (`profile.exit_type`).** It did not stop Chrome 152 from restoring its own session (the `Sessions/Session_*` wipe is the fix that works) and it was the only write into another app's config. Tab restore still clears `Sessions/Session_*` + `Tabs_*` before launching an explicit tab list.

## [2.2.0] - 2026-09-06

### Fixed

- **Apps whose class ends in `.desktop` (e.g. Telegram, `org.telegram.desktop`) were left on the wrong workspace after a late map.** The Phase 3b safety pass strips `.desktop` and lowercases the *live* window class before comparing, but compared it against the unstripped saved class, so the match never fired. The saved class is now normalized the same way. (#1)
- **Restored OpenCode/Ghostty windows missed project `mise [env]` (e.g. `XAI_API_KEY`), so OpenCode failed with `unauthenticated:bad-credentials`.** Restore now `cd`s to the captured cwd and evals `mise env -s bash` before launching, but only for non-browser windows. (#2)

### Changed

- **Restore strips `--gtk-single-instance` / `--gtk-single-instance=true` from captured terminal commands.** Ghostty otherwise forwards the launch into an already-running process (wrong cwd, so mise env never loads). Each saved terminal window now comes back as its own process. This applies to every terminal restore, not only OpenCode. (#2)

## [2.1.0] - 2026-09-04

Browser tab capture/restore is now **off by default**, behind a new toggle.

2.0.4 fixed regular-tab duplication after reboot by deleting Chrome's own
`Sessions/Session_*`/`Tabs_*` snapshot before relaunching a captured tab
list. Live testing surfaced the real cost of that: pinned-tab restore turned
out to ride the exact same snapshot (confirmed live - a manually-launched
Chrome window restores pinned tabs on its first window; a restore-launched
one, with that snapshot cleared, does not). There is no way to get "no
duplicates" and "pinned tabs return automatically" at the same time, because
both behaviors are driven by the one mechanism this plugin has to disable
for the first. That tradeoff, plus the number of Chrome-internals edge
cases it took to get regular-tab restore merely correct (five, across
2.0.1-2.0.4), made the feature more confusing than it was worth as a
default.

### Changed

- **Browser tab capture/restore now defaults to off.** A browser window is
  treated like any other app: moved onto its saved workspace if already
  running, launched bare if not - Chrome is left completely alone, so its
  own restore (pinned tabs included) behaves exactly as if launched by
  hand.
- New panel toggle, **Restore browser tabs**, and CLI command
  `session-restore tab-restore [on|off]`. The setting governs both save
  (whether tabs are captured at all) and restore (a previously-saved
  profile's captured tabs are ignored while the setting is off, so turning
  it off does not require re-saving).
- On, behavior is unchanged from 2.0.4: tabs restore with no duplicates,
  regardless of whether the browser is already running; pinned tabs still
  do not auto-return, for the reason above.

### Fixed

- **Pinned-tab exclusion from capture was racy.** It read the profile's
  `Preferences` file's `pinned_tabs` list, which Chrome flushes to disk on
  its own debounced schedule - stale relative to a pin made shortly before
  a save, which then captured that tab as a regular one instead of
  excluding it (confirmed live: a session saved this way restored 10
  pinned tabs as regular, unpinned tabs). Fixed by reading pin state
  directly out of the same `Sessions/Session_*` SNSS snapshot the tab list
  itself comes from (`SetPinnedState`, command id 12: `{tab_id, pinned}`,
  last write wins) - same snapshot, no cross-file staleness possible.
  Verified live against a 12-tab window (10 pinned): decodes exactly right.

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
