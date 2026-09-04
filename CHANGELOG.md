# Changelog

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
