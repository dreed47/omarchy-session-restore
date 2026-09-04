import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

Panel {
    id: root

    moduleName: "io.github.dreed47.session-restore"
    ipcTarget: "session-restore"

    property var profiles: []
    property bool isSnapshotting: false
    property bool isRestoring: false
    property string lastAction: ""
    property string profileDir: Quickshell.env("HOME") + "/.config/omarchy/session-restore"
    property bool showingNameInput: false

    // The restore engine. The widget only ever shells out to this - all the
    // snapshot/restore logic lives in bin/session-restore (see restoreLogic.mjs),
    // so the bar and the login hook run exactly the same code path.
    property string cliPath: Qt.resolvedUrl("bin/session-restore").toString().replace(/^file:\/\//, "")
    property bool cliMissing: false

    readonly property color hoverBg: bar
        ? Style.hoverFillFor(bar.foreground, Color.accent)
        : Qt.darker(Color.bar.text, 1.1)
    readonly property color selectedBg: bar
        ? Style.selectedFillFor(bar.foreground, Color.accent)
        : Qt.darker(Color.bar.text, 1.15)

    implicitWidth: button.implicitWidth
    implicitHeight: button.implicitHeight

    Component.onCompleted: refreshProfiles()

    function notify(summary, body) {
        Quickshell.execDetached(["notify-send", "-a", "Session Restore", "-i", "preferences-desktop-workspaces", summary, body || ""])
    }

    // Client-side guard so obviously-bad names never reach the CLI (which
    // rejects them too). Mirrors sanitizeProfileName in restoreLogic.mjs.
    function sanitizeProfileName(name) {
        if (typeof name !== "string") return null
        var n = name.trim()
        if (n.length === 0 || n.length > 128) return null
        if (n === "." || n === "..") return null
        if (n.charAt(0) === ".") return null
        if (/[\/\\\x00-\x1f]/.test(n)) return null
        if (!/^[A-Za-z0-9][A-Za-z0-9._ \-]*$/.test(n)) return null
        return n
    }

    // Pick a Nerd Font glyph that fits a profile name, falling back to a
    // generic icon when no keyword matches.
    function profileIconFor(name) {
        var n = (name || "").toLowerCase()
        if (/code|dev|coding|prog|program|project/.test(n)) return ""            // code
        if (/work|office|job/.test(n)) return ""                                  // briefcase/users
        if (/photo|image|picture|gimp|design|edit|art|draw/.test(n)) return ""    // image
        if (/music|audio|song|media/.test(n)) return ""                           // music
        if (/game|play|gaming/.test(n)) return ""                                 // gamepad
        if (/web|internet|www|browser|search/.test(n)) return ""                  // globe
        if (/video|movie|film|stream/.test(n)) return ""                          // film
        if (/term|shell|cli|console/.test(n)) return ""                           // terminal
        if (/chat|discord|telegram|message|slack/.test(n)) return ""              // comments
        if (/doc|note|write|text|paper/.test(n)) return ""                        // file-text
        if (/file|folder|fm|nautilus|browse/.test(n)) return ""                   // folder
        if (/mail|email|gmail/.test(n)) return ""                                 // envelope
        if (/home|default/.test(n)) return ""                                     // home
        return ""                                                                 // fingerprint/workspaces default
    }

    function generateDefaultName() {
        var d = new Date()
        var pad = function(n) { return n < 10 ? "0" + n : "" + n }
        return "snapshot-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
               "-" + pad(d.getHours()) + pad(d.getMinutes())
    }

    // --- Bar Button ---

    BarIconButton {
        id: button
        anchors.fill: parent
        bar: root.bar
        text: "󰆞"
        onPressed: function(b) {
            root.toggle()
        }
    }

    // --- Popup Panel ---

    KeyboardPanel {
        id: panel
        anchorItem: button
        owner: root
        bar: root.bar
        open: root.opened
        contentWidth: 280
        contentHeight: showingNameInput ? 220 : 400

        PanelKeyCatcher {
            id: keyCatcher
            anchors.fill: parent
            onCloseRequested: root.close()
        }

        Column {
            anchors.fill: parent
            anchors.margins: 12
            spacing: 8
            visible: !root.showingNameInput

            PanelHero {
                title: root.isRestoring ? "Restoring..." : "Session Restore"
            }

            Rectangle {
                width: parent.width
                height: 1
                color: Qt.darker(Color.bar.text, 1.15)
            }

            Rectangle {
                width: parent.width
                height: 36
                radius: Style.cornerRadius
                color: root.isRestoring ? Qt.darker(Color.bar.background, 1.15) : root.hoverBg

                Row {
                    anchors.centerIn: parent
                    spacing: 6

                    Text {
                        text: root.isSnapshotting ? "󰏇" : root.isRestoring ? "󰑐" : "󰅧"
                        color: Color.bar.text
                        font.pixelSize: 14
                        anchors.verticalCenter: parent.verticalCenter
                    }

                    Text {
                        text: root.isSnapshotting ? "Saving..." : root.isRestoring ? "Restoring..." : "Save Session"
                        color: Color.bar.text
                        font.family: Style.font.family
                        font.pixelSize: Style.font.body
                        anchors.verticalCenter: parent.verticalCenter
                    }
                }

                MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    hoverEnabled: true
                    enabled: !root.isRestoring && !root.isSnapshotting
                    onContainsMouseChanged: parent.color = containsMouse ? root.selectedBg : root.hoverBg
                    onClicked: root.doSnapshot()
                }
            }

            PanelSectionHeader { text: "Profiles" }

            Column {
                width: parent.width
                spacing: 4

                Repeater {
                    model: root.profiles

                    delegate: Rectangle {
                        width: parent.width
                        height: 36
                        radius: Style.cornerRadius
                        color: Qt.darker(Color.bar.background, 1.05)

                        RowLayout {
                            anchors.fill: parent
                            anchors.margins: 6
                            spacing: 6

                            Text {
                                text: root.profileIconFor(modelData)
                                color: Qt.darker(Color.bar.text, 1.4)
                                font.pixelSize: 13
                                Layout.alignment: Qt.AlignVCenter
                            }

                            Text {
                                text: modelData
                                color: Color.bar.text
                                font.family: Style.font.family
                                font.pixelSize: Style.font.body
                                Layout.alignment: Qt.AlignVCenter
                                Layout.fillWidth: true
                                elide: Text.ElideRight

                                MouseArea {
                                    anchors.fill: parent
                                    cursorShape: Qt.PointingHandCursor
                                    hoverEnabled: true
                                    enabled: !root.isRestoring && !root.isSnapshotting
                                    onContainsMouseChanged: parent.parent.parent.color = containsMouse ? root.hoverBg : Qt.darker(Color.bar.background, 1.05)
                                    onClicked: root.doRestore(modelData)
                                }
                            }

                            Text {
                                text: "󰆴"
                                color: Qt.darker(Color.bar.text, 1.4)
                                font.pixelSize: 13
                                Layout.alignment: Qt.AlignVCenter

                                MouseArea {
                                    anchors.fill: parent
                                    cursorShape: Qt.PointingHandCursor
                                    hoverEnabled: true
                                    enabled: !root.isRestoring && !root.isSnapshotting
                                    onContainsMouseChanged: parent.parent.parent.color = containsMouse ? "#663333" : "transparent"
                                    onClicked: root.doDelete(modelData)
                                }
                            }
                        }
                    }
                }
            }

            Item { width: 1; height: 4 }

            Text {
                text: root.lastAction
                color: Qt.darker(Color.bar.text, 1.4)
                font.family: Style.font.family
                font.pixelSize: Style.font.body
                font.italic: true
                visible: root.lastAction !== ""
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
            }
        }

        // --- Name Input View ---

        Column {
            anchors.fill: parent
            anchors.margins: 12
            spacing: 10
            visible: root.showingNameInput

            PanelHero {
                title: "Save Session"
            }

            Rectangle {
                width: parent.width
                height: 1
                color: Qt.darker(Color.bar.text, 1.15)
            }

            TextField {
                id: saveNameField
                width: parent.width
                height: 36
                placeholderText: "Profile name"
                color: Color.bar.text
                font.family: Style.font.family
                font.pixelSize: Style.font.body
                leftPadding: 10
                background: Rectangle {
                    color: Qt.darker(Color.bar.background, 1.08)
                    radius: Style.cornerRadius
                    border.color: Qt.darker(Color.bar.text, 1.15)
                    border.width: 1
                }
                Keys.onReturnPressed: confirmSave()
                Keys.onEnterPressed: confirmSave()
            }

            Rectangle {
                width: parent.width
                height: 36
                radius: Style.cornerRadius
                color: root.hoverBg

                Text {
                    anchors.centerIn: parent
                    text: "  Save"
                    color: Color.bar.text
                    font.family: Style.font.family
                    font.pixelSize: Style.font.body
                }

                MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    hoverEnabled: true
                    onContainsMouseChanged: parent.color = containsMouse ? root.selectedBg : root.hoverBg
                    onClicked: confirmSave()
                }
            }

            Rectangle {
                width: parent.width
                height: 36
                radius: Style.cornerRadius
                color: Qt.darker(Color.bar.background, 1.05)

                Text {
                    anchors.centerIn: parent
                    text: "Cancel"
                    color: Qt.darker(Color.bar.text, 1.5)
                    font.family: Style.font.family
                    font.pixelSize: Style.font.body
                }

                MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    hoverEnabled: true
                    onContainsMouseChanged: parent.color = containsMouse ? Qt.darker(Color.bar.text, 1.1) : Qt.darker(Color.bar.background, 1.05)
                    onClicked: {
                        root.showingNameInput = false
                        root.lastAction = "Cancelled"
                    }
                }
            }
        }
    }

    // --- Engine calls -------------------------------------------------------
    // Every action is `node bin/session-restore <cmd> ...`. `node` is an
    // explicit argv[0] so a missing runtime surfaces as a clear error rather
    // than a silent no-op.

    function refreshProfiles() {
        listProc.command = ["node", root.cliPath, "list", "--json"]
        listProc.running = true
    }

    Process {
        id: listProc
        stdout: StdioCollector { id: listOut; waitForEnd: true }
        stderr: StdioCollector { id: listErr; waitForEnd: true }
        onExited: function(code) {
            if (code !== 0) {
                root.cliMissing = code === 127 || (listErr.text || "").indexOf("not found") !== -1
                root.lastAction = root.cliMissing
                    ? "node not found - run: omarchy pkg add nodejs"
                    : "Could not list profiles"
                root.profiles = []
                return
            }
            root.cliMissing = false
            try {
                var arr = JSON.parse(listOut.text)
                root.profiles = Array.isArray(arr) ? arr : []
            } catch (e) {
                root.profiles = []
            }
        }
    }

    // "Save Session" opens the name prompt; the snapshot itself is taken by
    // the CLI when Save is confirmed, so it reflects the layout at that moment.
    function doSnapshot() {
        if (root.isSnapshotting || root.isRestoring) return
        saveNameField.text = root.generateDefaultName()
        root.showingNameInput = true
    }

    function confirmSave() {
        var name = saveNameField.text.trim()
        if (name.length === 0) return
        if (root.sanitizeProfileName(name) === null) {
            root.lastAction = "Invalid profile name"
            return
        }
        root.doSave(name)
    }

    function doSave(name) {
        root.isSnapshotting = true
        root.lastAction = "Saving..."
        saveProc.command = ["node", root.cliPath, "save", name]
        saveProc.running = true
    }

    Process {
        id: saveProc
        stdout: StdioCollector { id: saveOut; waitForEnd: true }
        stderr: StdioCollector { id: saveErr; waitForEnd: true }
        onExited: function(code) {
            root.isSnapshotting = false
            if (code !== 0) {
                root.lastAction = "Save failed"
                root.notify("Save failed", (saveErr.text || "").trim() || ("session-restore exited " + code))
                return
            }
            root.lastAction = "Session saved"
            root.showingNameInput = false
            root.refreshProfiles()
            root.notify("Session saved", saveNameField.text)
        }
    }

    function doRestore(name) {
        if (root.isRestoring || root.isSnapshotting) return
        root.isRestoring = true
        root.lastAction = "Restoring..."
        restoreProc.command = ["node", root.cliPath, "restore", name]
        restoreProc.running = true
    }

    Process {
        id: restoreProc
        stdout: StdioCollector { id: restoreOut; waitForEnd: true }
        stderr: StdioCollector { id: restoreErr; waitForEnd: true }
        onExited: function(code) {
            root.isRestoring = false
            if (code !== 0) {
                root.lastAction = "Restore failed"
                root.notify("Restore failed", (restoreErr.text || "").trim() || ("session-restore exited " + code))
                return
            }
            // bin/session-restore fires its own success notification.
            root.lastAction = (restoreOut.text || "Restored").trim()
        }
    }

    function doDelete(name) {
        if (root.isRestoring || root.isSnapshotting) return
        deleteProc.command = ["node", root.cliPath, "delete", name]
        deleteProc.running = true
    }

    Process {
        id: deleteProc
        stderr: StdioCollector { id: deleteErr; waitForEnd: true }
        onExited: function(code) {
            if (code !== 0) {
                root.lastAction = "Delete failed"
                root.notify("Delete failed", (deleteErr.text || "").trim() || ("session-restore exited " + code))
                return
            }
            root.lastAction = "Deleted"
            root.refreshProfiles()
            root.notify("Profile deleted", "")
        }
    }
}
