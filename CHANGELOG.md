# Changelog

All notable changes to this project are documented in this file.

## [2.0.0] - unreleased

Fork of [Workspace Restorer](https://github.com/Davedes83/workspace-restorer)
by Davedes83, renamed to **Session Restore**.

### Changed

- Plugin renamed: id `davedes.workspace-restorer` -> `io.github.dreed47.session-restore`,
  display name "Workspace Restorer" -> "Session Restore".
- Profile storage moved: `~/.config/omarchy/workspace-restorer/` ->
  `~/.config/omarchy/session-restore/`. Existing profiles are not migrated
  automatically; copy the directory across if you are coming from the
  upstream plugin.

### Planned in this line

- Automatic session restore after a reboot / login via an Omarchy `post-boot`
  hook, with a designated "boot profile".
- Standalone `bin/session-restore` CLI so restore does not depend on the
  shell being up.
- Bar-panel controls: pin boot profile, toggle restore-on-login, update boot
  profile from the current layout.

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
