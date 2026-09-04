# Changelog

All notable changes to this project are documented in this file.

## [2.0.0] - unreleased

Fork of [Workspace Restorer](https://github.com/Davedes83/workspace-restorer)
by Davedes83, renamed to **Session Restore**.

### Added

- Standalone `bin/session-restore` CLI (Node) - the single snapshot/restore
  engine. Subcommands: `save`, `restore`, `list`, `delete`, `boot-profile`,
  plus `restore --boot` / `save --boot` for the login path and `--dry-run` to
  print the restore script without running it. This is what the post-boot
  hook will call, so login restore does not depend on the shell being up.
- Pure builders extracted into `restoreLogic.mjs` and unit-tested:
  `assembleWindows`, `buildSnapshot`, `buildRestoreScript`, `wrapRestoreRunner`,
  `resolveBrowserProfile`, `procInfoScript` / `parseProcInfo`,
  `tabCaptureInvocations` / `parseTabResults` / `attachTabs`, `bootMarkerPath`.
- `.boot-profile` marker file (in the profile dir) naming the profile to
  restore on login.
- **Automatic restore after reboot.** A `service` entry point
  (`kinds: ["bar-widget", "service"]`, `keepLoaded`) pokes
  `session-restore restore --boot` a few seconds after each shell start. The
  CLI owns the guards: it acts only if the compositor came up within
  `SESSION_RESTORE_BOOT_WINDOW` seconds (default 120) and no once-per-session
  stamp exists at `$XDG_RUNTIME_DIR/session-restore/applied`, so a mid-session
  `omarchy restart shell` does not re-fire it. Armed by setting a boot profile
  (`session-restore boot-profile <name>`); a no-op until then.
- `session-restore.service` IPC target with `applyLogin()` to test the login
  path without logging out.

### Changed

- `BarWidget.qml` now shells out to `bin/session-restore` for every action
  (list / save / restore / delete) instead of carrying its own copy of the
  snapshot and restore logic - one engine, shared with the login path.
  "Save Session" opens the name prompt first; the snapshot is taken by the
  CLI when Save is confirmed.
- Plugin renamed: id `davedes.workspace-restorer` -> `io.github.dreed47.session-restore`,
  display name "Workspace Restorer" -> "Session Restore".
- Profile storage moved: `~/.config/omarchy/workspace-restorer/` ->
  `~/.config/omarchy/session-restore/`. Existing profiles are not migrated
  automatically; copy the directory across if you are coming from the
  upstream plugin.
- New runtime requirement: `node` (>= 18) for the restore engine.

### Deferred - blocked on Hyprland core

- **Tiled layout restore** (which window is beside which, and split ratios).
  Needs Hyprland to expose the dwindle tree + ratios, which it does not
  ([hyprwm/Hyprland#13035](https://github.com/hyprwm/Hyprland/discussions/13035);
  the `splitratio` dispatcher was also removed). Not being built as a geometry
  heuristic - `io.github.imryiuk.workspace-profiles` already covers that. See
  [docs/tiled-layout-restore.md](docs/tiled-layout-restore.md) for the trigger
  condition and, when this plugin ships to the marketplace, the note to add on
  the upstream thread.

### Planned in this line

- Bar-panel controls: pin boot profile (star toggle on the profile row),
  toggle restore-on-login, and "update boot profile from the current layout".
  Until these land, the boot profile is set from the CLI.

## [1.1.1] - 2026-08-30

### Security hardening for browser tab capture

- Bounded all untrusted local browser inputs read during tab capture: the Chromium DevTools debug port is now constrained to a bare 1-5 digit number (so a crafted `DevToolsActivePort` can no longer redirect a snapshot request to an arbitrary host) and the CDP response is capped in size.
- Bounded Firefox session-store decoding: the compressed file is stat-limited before any read and its declared uncompressed size is validated against a ceiling before decompression, so a crafted `recovery.jsonlz4` cannot force an unbounded memory allocation. The fallback decoder's output is length-checked as well.

## [1.1.0] - 2026-08-30

### Browser tabs now restore correctly

- Fixed browser tab restore when browsers are already running: no more split-screen windows (Firefox), extra session-restore tabs (Vivaldi), or windows landing on the wrong workspace.
- Changed browser windows with captured tabs are now closed and relaunched fresh at restore time, so each opened window shows exactly the tabs from your snapshot — one window, no duplicates, on the correct workspace.
- Fixed a launch-script stall that could stop a restore partway through.

> **Note:** restoring a snapshot with browser tabs will close and reopen the matching browser window. Capture snapshots without browser tabs if you prefer not to have browsers relaunched.

## [1.0.0] - 2026-08-27

Initial release.
