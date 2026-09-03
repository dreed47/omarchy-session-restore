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
- **Restore after reboot** *(2.x)* — Pin one profile as the *boot profile* and
  have it reopen automatically a few seconds after you log in
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

### Restore after reboot *(2.x)*

1. Pin a profile as the boot profile (star toggle on the profile row)
2. Turn on **Restore on login** — this installs an Omarchy `post-boot` hook
3. On the next login the boot profile is restored automatically once Hyprland
   has settled

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

## Requirements

- [Omarchy](https://omarchy.org/) Linux
- Hyprland compositor
- Quickshell (the Omarchy shell framework)
- `python3` (browser tab capture)

## Development

```bash
npm install --ignore-scripts
npm test
```

## License

MIT — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
