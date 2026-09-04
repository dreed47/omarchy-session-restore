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
2. Click **Take Snapshot** to capture your current layout
3. Enter a name for the profile (e.g. `coding`, `media`)
4. Click a profile name to restore that layout
5. Click the delete action to remove a profile

### Restore after reboot

Pick the profile to bring back at login (the *boot profile*):

```bash
bin/session-restore boot-profile coding
```

That's the whole switch. The plugin's `service` half runs a few seconds after
each login and restores that profile — once. It does **not** re-fire when the
shell is merely restarted mid-session: it checks that the compositor came up
moments ago and drops a once-per-session stamp in `$XDG_RUNTIME_DIR`.

Clear it with `bin/session-restore boot-profile --clear`.

> A bar-panel toggle for this (pin star + "restore on login" switch) is coming;
> for now it's the CLI.

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
