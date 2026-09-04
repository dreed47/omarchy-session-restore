import QtQuick
import Quickshell
import Quickshell.Io

// Headless half of Session Restore.
//
// One job: a few seconds after the shell starts, poke
// `bin/session-restore restore --boot`. Everything that decides whether this
// start is actually a fresh login - compositor age, the once-per-session
// stamp, whether a boot profile is even set - lives in the CLI, which exits in
// milliseconds when the answer is "do nothing". Keeping it there means one
// place to reason about, and the shell carries no extra file watch or JSON
// parse.
Item {
    id: root

    // Qt hands back a percent-encoded file: URL; the plugin dir is whatever
    // path the user installed under, so decode before it becomes an argv entry.
    readonly property string pluginDir: decodeURIComponent(
        String(Qt.resolvedUrl(".")).replace(/^file:\/\//, "").replace(/\/$/, ""))
    readonly property string cliPath: pluginDir + "/bin/session-restore"

    function restoreBoot() {
        Quickshell.execDetached(["node", root.cliPath, "restore", "--boot"])
    }

    IpcHandler {
        // Distinct from the bar widget's "session-restore" target so the two
        // IpcHandlers do not collide.
        target: "session-restore.service"

        // Re-run the login path (guards and all) without logging out. Useful
        // for testing; a no-op if this session already restored once.
        function applyLogin(): void { root.restoreBoot() }
    }

    // The shell is started by Hyprland's autostart, so at Component.onCompleted
    // the compositor is up but workspaces may not have settled. A short wait
    // lets apps land on a stable desktop; the CLI's own compositor-age guard
    // still decides whether this counts as a login at all.
    Timer {
        interval: 3000
        repeat: false
        running: true
        onTriggered: root.restoreBoot()
    }
}
