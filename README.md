# Session Restore

An [Omarchy](https://omarchy.org/) shell plugin (Quickshell) for Hyprland that
saves your open apps and window layout as named profiles and brings them
back — on demand, or **automatically after a reboot**.

> This is a fork of [Workspace Restorer](https://github.com/Davedes83/workspace-restorer)
> by Davedes83 (MIT). See [NOTICE](NOTICE) for what changed. The 2.x line adds
> automatic restore on login; see [CHANGELOG.md](CHANGELOG.md).

## Features

- **Save a session** — Capture every open window: app, workspace, screen
  position, size, floating/fullscreen state, working directory, and browser tabs
- **Restore on demand** — Re-launch missing apps directly onto the workspace
  they were on; move already-running windows back into place
- **Restore after reboot** — Name one profile as the *boot profile* and it
  reopens automatically a few seconds after you log in (once per login, not on
  a mid-session shell restart)
- **Conflict detection** — Avoids duplicate spawns; repositions existing windows
  instead of relaunching them
- **Desktop notifications** — Feedback on save / restore / delete

## Installation

```bash
omarchy plugin add https://github.com/dreed47/omarchy-session-restore
```

Or clone manually into the plugin directory:

```bash
git clone https://github.com/dreed47/omarchy-session-restore \
  ~/.config/omarchy/plugins/io.github.dreed47.session-restore
```

Then add it to your `~/.config/omarchy/shell.json`:

```json
{
  "bar": {
    "layout": {
      "right": [
        { "id": "io.github.dreed47.session-restore" }
      ]
    }
  }
}
```

Restart the shell:

```bash
omarchy restart shell
```

## Usage

1. Click the bar widget to open the panel
2. **Save current session** → name it (e.g. `coding`, `media`)
3. Click a session row to restore that layout now
4. **Pin** a row to have it restore automatically at login
5. Delete is a two-click confirm on the trash action

### Restore after reboot

Open the panel and click the **pin** on a saved session to arm it — that profile
now restores automatically a few seconds after each login. The pinned row is
tinted, and the header shows which profile is armed. Click the pin again (or the
**Auto-restore at login** toggle) to turn it off.

The pinned row also gets an **update** action that overwrites the profile with
your current window layout, so you can keep the login session current without
re-pinning.

From the CLI it's `bin/session-restore boot-profile <name>` /
`bin/session-restore boot-profile --clear`.

Login restore fires **once per login**. It does not re-run when the shell is
merely restarted mid-session: it checks the compositor came up moments ago and
writes a per-session stamp (keyed to the Hyprland instance) in
`$XDG_RUNTIME_DIR`.

To test the login path without logging out:

```bash
rm -f "$XDG_RUNTIME_DIR/session-restore/applied"
omarchy-shell session-restore.service applyLogin      # or: SESSION_RESTORE_BOOT_WINDOW=99999 bin/session-restore restore --boot
```

## How it works

- Profiles are saved as JSON in `~/.config/omarchy/session-restore/`
- State is captured via `hyprctl -j clients` and `hyprctl -j monitors`
- Command line and working directory are read per-process from `/proc/<pid>`
  (keyed by PID, so window data never misaligns)
- Restore uses the Omarchy Lua bridge (`hl.dsp.*` dispatchers) via
  `hyprctl dispatch` to move windows and workspaces
- Missing windows are launched by focusing their target workspace first, then
  starting the app — so each opens directly where it belongs
- A detached safety pass re-checks spawned windows and corrects any that ignore
  the focused workspace, without delaying the restore notification

## Limitations

The **tiled arrangement inside a workspace is not restored** - which window sits
left/right/top/bottom of which, and the split ratios between them. Tiled windows
are launched back onto their workspace and land wherever dwindle puts them.

This is deferred, not merely unbuilt: doing it properly needs Hyprland to expose
the dwindle split tree + ratios, which it does not yet
([hyprwm/Hyprland#13035](https://github.com/hyprwm/Hyprland/discussions/13035)).
See [docs/tiled-layout-restore.md](docs/tiled-layout-restore.md) for the full
rationale and the trigger condition for building it.

Restored today: workspace, monitor, floating position/size, fullscreen, browser
tabs, and relaunching whatever is missing.

## Requirements

- [Omarchy](https://omarchy.org/) Linux
- Hyprland compositor
- Quickshell (the Omarchy shell framework)
- `node` >= 18 (the restore engine) - `omarchy pkg add nodejs`
- `python3` (browser tab capture)

### Command-line use

The engine is also a standalone CLI, handy for scripts and the login hook:

```bash
bin/session-restore save coding        # capture the current layout
bin/session-restore restore coding     # reopen it
bin/session-restore list               # * marks the boot profile
bin/session-restore boot-profile coding
bin/session-restore restore --boot     # what the post-boot hook runs
```

## Development

```bash
npm install --ignore-scripts
npm test
```

## License

MIT — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
