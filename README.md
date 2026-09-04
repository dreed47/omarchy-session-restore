# Session Restore

<p align="center"><img src="preview.png" alt="The Session Restore panel" width="360"></p>

An [Omarchy](https://omarchy.org/) shell plugin (Quickshell / Hyprland) that
saves your open apps and window layout as named **sessions** and brings them
back — on demand, or automatically after a reboot.

> Forked from [Workspace Restorer](https://github.com/Davedes83/workspace-restorer)
> by Davedes83 (MIT). What changed: see [NOTICE](NOTICE) and [CHANGELOG.md](CHANGELOG.md).

## What it does

- **Save a session** — a named snapshot of every open window: app, workspace,
  monitor, position, size, floating/fullscreen state, working directory, and
  (optionally, see [Browser tabs](#browser-tabs)) browser tabs.
- **Restore on demand** — relaunches whatever is closed onto the right
  workspace; repositions windows that are already open instead of duplicating
  them; chases slow apps (Electron) for ~15 s.
- **Restore at login** — pin one session and it reopens a few seconds after you
  log in. Once per login only — a mid-session `omarchy restart shell` will not
  re-trigger it, and neither will an already-armed session that was pinned
  earlier in the same session.

## What it does **not** do

- **Tiled layout within a workspace** — which window sits left/right/top/bottom
  of which, and the split ratios. Tiled windows come back onto their workspace
  and land wherever dwindle puts them. This is blocked on Hyprland, not just
  unbuilt — see [Limitations](#limitations).
- **Restore app *state*** — it relaunches apps, it does not reopen documents or
  scroll positions (browser tabs are the exception).
- **Run without `node`** — the restore engine is a Node script. `python3` is
  also needed for browser-tab capture, which is off by default; everything
  else works without it.

## Install

```bash
omarchy plugin add https://github.com/dreed47/omarchy-session-restore
```

Or clone into the plugin directory and enable it:

```bash
git clone https://github.com/dreed47/omarchy-session-restore \
  ~/.config/omarchy/plugins/io.github.dreed47.session-restore
```

```json
// ~/.config/omarchy/shell.json
{ "bar": { "layout": { "right": [ { "id": "io.github.dreed47.session-restore" } ] } } }
```

```bash
omarchy restart shell
```

## Remove

```bash
omarchy plugin remove io.github.dreed47.session-restore
omarchy restart shell
```

Removing the plugin takes the bar widget and the login service with it. Your
saved sessions in `~/.config/omarchy/session-restore/` are left in place —
delete that directory too if you don't want them.

## Requirements

- Omarchy with the Quickshell bar, Hyprland
- `node` >= 18 — `omarchy pkg add nodejs`
- `python3` (browser tab capture, off by default; the rest works without it)

## Using it

Click the bar icon to open the panel.

- **Save current session** → name it.
- **Click a session** to reopen it now.
- **Pin** (the pushpin on the left of a row) marks the session that reopens at
  login. The pinned row is tinted and the header shows its name; click the pin
  again to turn it off. One pinned at a time.
- The pinned row gets an **update** action (↻) that re-saves it from the windows
  open right now.
- **Delete** is a two-click confirm on the trash icon.
- **Restore browser tabs** toggle — off by default; see [Browser tabs](#browser-tabs).

Hovering any control shows what it does in the line at the foot of the panel.

## Browser tabs

Off by default. On, saving a session also captures each browser window's open
tabs, and restore reopens them explicitly — with no duplicates, this is
handled correctly regardless of whether the browser is already running.

The tradeoff: getting that right requires disarming Chrome's own
crash/session-restore for the windows this launches (otherwise Chrome's
restore and this plugin's explicit tab list both try to open the same tabs).
Pinned tabs are a casualty of that — they don't come back on their own the
way they do when you launch the browser yourself, since pinned-tab restore
rides the exact same mechanism. Turning tab restore on trades "your pinned
tabs return automatically" for "regular tabs are restored exactly, with no
duplicates."

Off (default), a browser window is treated like any other app: moved onto
its saved workspace if it's already running, launched bare if not — Chrome
is left completely alone, so its own restore (including pinned tabs) behaves
exactly as if you'd launched it yourself.

The setting applies to both save and restore, so switching it off stops a
previously-saved session's captured tabs from being replayed too — no need
to re-save.

```bash
bin/session-restore tab-restore          # print current setting
bin/session-restore tab-restore on
bin/session-restore tab-restore off
```

## Command line

The engine is a standalone CLI (this is also what the login service runs):

```bash
bin/session-restore save <name>        # capture the current layout
bin/session-restore restore <name>     # reopen it
bin/session-restore list               # saved sessions (* = pinned for login)
bin/session-restore status             # + which session is pinned
bin/session-restore delete <name>
bin/session-restore boot-profile <name>   # pin for login   (--clear to unpin)
bin/session-restore restore --boot        # what the login service runs
bin/session-restore tab-restore [on|off]  # browser tab capture/restore (default: off)
```

Profiles are JSON in `~/.config/omarchy/session-restore/` (override with
`SESSION_RESTORE_DIR`).

To test the login path without logging out:

```bash
rm -f "$XDG_RUNTIME_DIR/session-restore/applied"
omarchy-shell session-restore.service applyLogin
# or, bypassing the compositor-age guard:
SESSION_RESTORE_BOOT_WINDOW=99999 bin/session-restore restore --boot
```

## How it works

- Capture: `hyprctl -j clients` + `hyprctl -j monitors`, plus each window's
  command line and working directory from `/proc/<pid>` (keyed by PID so
  nothing misaligns), plus browser tabs via `scripts/capture_tabs.py` when
  the tab-restore setting is on (see [Browser tabs](#browser-tabs)).
- Restore: reads the profile, matches it against currently-open windows in
  three passes (exact class+title, then class + current workspace, then class
  only), moves the matched ones, and spawns the rest — focusing each target
  workspace first so windows open where they belong. A detached pass re-checks
  slow apps (Electron) for ~15s.
- All of that lives in `bin/session-restore`; the bar widget and the login
  `service` entry point both shell out to it, so there is one code path.
- Login trigger: the `service` half runs `restore --boot` a few seconds after
  each shell start. The CLI acts only if the Hyprland instance came up within
  `SESSION_RESTORE_BOOT_WINDOW` seconds (default 120) and it hasn't already run
  for this Hyprland instance (a stamp in `$XDG_RUNTIME_DIR`, keyed to
  `$HYPRLAND_INSTANCE_SIGNATURE`).

## Limitations

The **tiled arrangement inside a workspace is not restored**. Tiled windows
come back onto their workspace and land wherever dwindle puts them.

This is deferred, not merely unbuilt: it needs Hyprland to expose the dwindle
split tree and ratios, which it does not yet
([hyprwm/Hyprland#13035](https://github.com/hyprwm/Hyprland/discussions/13035);
the `splitratio` dispatcher was also removed). Building it as a geometry
heuristic is `io.github.imryiuk.workspace-profiles`' territory, not this
plugin's. Full rationale and the trigger condition:
[docs/tiled-layout-restore.md](docs/tiled-layout-restore.md).

## Development

```bash
npm test              # unit tests for the pure engine logic
npm run validate      # check manifest.json against the plugin schema
```

The bar widget has no automated check — after editing `BarWidget.qml`,
`rm -rf ~/.cache/quickshell && omarchy restart shell` (a plain
`rescanPlugins` does not reload QML).

## License

MIT — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
