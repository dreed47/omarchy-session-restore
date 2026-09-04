import QtQuick
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

Panel {
    id: root

    moduleName: "io.github.dreed47.session-restore"
    ipcTarget: "session-restore"

    // --- state -----------------------------------------------------------
    property var profiles: []
    property string bootProfile: ""       // the profile armed for login, "" if none
    property bool bootProfileMissing: false
    property bool isSnapshotting: false
    property bool isRestoring: false
    property bool isBusy: false           // arm / clear / delete in flight
    property string lastAction: ""
    property bool showNameInput: false
    property bool cliMissing: false
    property string armedDelete: ""       // profile name awaiting a 2nd delete click
    property string hoverHint: ""         // contextual help shown at the panel foot

    readonly property bool anyBusy: isSnapshotting || isRestoring || isBusy

    // The restore engine. The widget only ever shells out to this; all the
    // snapshot/restore logic lives in bin/session-restore, so the bar and the
    // login service run exactly the same code path.
    property string cliPath: Qt.resolvedUrl("bin/session-restore").toString().replace(/^file:\/\//, "")

    implicitWidth: button.implicitWidth
    implicitHeight: button.implicitHeight

    Component.onCompleted: refreshStatus()

    // --- helpers -------------------------------------------------------------

    function notify(summary, body) {
        Quickshell.execDetached(["notify-send", "-a", "Session Restore",
            "-i", "preferences-desktop-workspaces", summary, body || ""])
    }

    // Mirrors sanitizeProfileName in restoreLogic.mjs; the CLI rejects bad
    // names too, this just gives instant feedback.
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

    function generateDefaultName() {
        var d = new Date()
        var pad = function (n) { return n < 10 ? "0" + n : "" + n }
        return "session-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
               "-" + pad(d.getHours()) + pad(d.getMinutes())
    }

    function relTime(ms) {
        if (!ms) return ""
        var s = Math.floor((Date.now() - ms) / 1000)
        if (s < 45) return "just now"
        if (s < 3600) return Math.floor(s / 60) + "m ago"
        if (s < 86400) return Math.floor(s / 3600) + "h ago"
        return Math.floor(s / 86400) + "d ago"
    }

    // --- bar button --------------------------------------------------------

    BarIconButton {
        id: button
        anchors.fill: parent
        bar: root.bar
        // FA "clone" (\uf24d): two overlapping rounded squares.
        text: "\uf24d"
        onPressed: function (b) { root.toggle() }
    }

    // Clears a half-committed delete after a couple of seconds.
    Timer {
        id: delArmTimer
        interval: 2500
        onTriggered: root.armedDelete = ""
    }

    // --- popup -----------------------------------------------------------

    KeyboardPanel {
        id: panel
        anchorItem: button
        owner: root
        bar: root.bar
        open: root.opened
        contentWidth: Style.space(330)
        contentHeight: Math.min(Style.space(840), body.implicitHeight + Style.space(64))

        PanelKeyCatcher {
            anchors.fill: parent
            onCloseRequested: {
                if (root.showNameInput) { root.showNameInput = false; return }
                root.close()
            }
        }

        Flickable {
            anchors.fill: parent
            contentWidth: width
            contentHeight: body.implicitHeight + Style.space(64)
            interactive: contentHeight > height
            clip: true
            boundsBehavior: Flickable.StopAtBounds

            ColumnLayout {
                id: body
                x: Style.space(14)
                y: Style.space(16)
                width: parent.width - Style.space(28)
                spacing: Style.space(10)

            PanelHero {
                Layout.fillWidth: true
                title: "Session Restore"
                detail: root.bootProfile !== "" ? root.bootProfile : ""
                meta: root.bootProfile === ""
                    ? "save your open apps and bring them back later"
                    : (root.bootProfileMissing
                        ? "pinned session is missing — pin another"
                        : "this session reopens at login")
            }

            PanelSeparator { Layout.fillWidth: true }

            // node missing --------------------------------------------------
            Rectangle {
                Layout.fillWidth: true
                visible: root.cliMissing
                implicitHeight: cliMsg.implicitHeight + Style.space(16)
                radius: Style.cornerRadius
                color: Util.alpha(Color.urgent, 0.14)
                Text {
                    id: cliMsg
                    anchors.fill: parent
                    anchors.margins: Style.space(8)
                    textFormat: Text.PlainText
                    text: "Node.js is required and was not found.\nInstall it with:  omarchy pkg add nodejs"
                    color: Color.foreground
                    font.family: Style.font.family
                    font.pixelSize: Style.font.caption
                    wrapMode: Text.WordWrap
                }
            }

            // primary action: save --------------------------------------------
            BorderSurface {
                id: saveBtn
                Layout.fillWidth: true
                implicitHeight: Style.space(40)
                radius: Style.cornerRadius
                enabled: !root.anyBusy && !root.cliMissing
                readonly property bool hot: saveMouse.containsMouse && enabled
                color: hot
                    ? Style.hoverFillFor(Color.foreground, Color.accent)
                    : Style.normalFillFor(Color.foreground, Color.accent)
                borderSpec: Border.controlSpec(hot ? "hover-cursor" : "normal", Color.foreground, Color.accent)
                opacity: enabled ? 1.0 : 0.5

                Row {
                    anchors.centerIn: parent
                    spacing: Style.space(8)
                    Text {
                        anchors.verticalCenter: parent.verticalCenter
                        text: "󰆓"
                        color: Color.foreground
                        font.family: Style.font.family
                        font.pixelSize: Style.font.icon
                    }
                    Text {
                        anchors.verticalCenter: parent.verticalCenter
                        text: root.isSnapshotting ? "Saving…" : "Save current session"
                        color: Color.foreground
                        font.family: Style.font.family
                        font.pixelSize: Style.font.body
                        font.bold: true
                    }
                }

                MouseArea {
                    id: saveMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: parent.enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                    enabled: parent.enabled
                    onClicked: root.beginSave()
                    onContainsMouseChanged: root.hoverHint = containsMouse
                        ? "Save every open window into a new named session" : ""
                }
            }

            // inline name entry --------------------------------------------
            ColumnLayout {
                Layout.fillWidth: true
                visible: root.showNameInput
                spacing: Style.space(8)

                TextField {
                    id: nameField
                    Layout.fillWidth: true
                    implicitHeight: Style.space(36)
                    placeholderText: "Name this session"
                    color: Color.foreground
                    font.family: Style.font.family
                    font.pixelSize: Style.font.body
                    leftPadding: Style.space(10)
                    background: BorderSurface {
                        color: Util.alpha(Color.foreground, 0.06)
                        radius: Style.cornerRadius
                        borderSpec: Border.controlSpec("normal", Color.foreground, Color.accent)
                    }
                    Keys.onReturnPressed: root.confirmSave()
                    Keys.onEnterPressed: root.confirmSave()
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: Style.space(8)

                    BorderSurface {
                        Layout.fillWidth: true
                        implicitHeight: Style.space(34)
                        radius: Style.cornerRadius
                        readonly property bool hot: okMouse.containsMouse
                        color: hot
                            ? Style.selectedFillFor(Color.foreground, Color.accent)
                            : Style.normalFillFor(Color.foreground, Color.accent)
                        borderSpec: Border.controlSpec(hot ? "hover-cursor" : "normal", Color.foreground, Color.accent)
                        Text {
                            anchors.centerIn: parent
                            text: "Save"
                            color: Color.foreground
                            font.family: Style.font.family
                            font.pixelSize: Style.font.body
                        }
                        MouseArea {
                            id: okMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: root.confirmSave()
                        }
                    }

                    BorderSurface {
                        Layout.fillWidth: true
                        implicitHeight: Style.space(34)
                        radius: Style.cornerRadius
                        readonly property bool hot: cancelMouse.containsMouse
                        color: hot ? Style.hoverFillFor(Color.foreground, Color.accent) : "transparent"
                        borderSpec: Border.controlSpec(hot ? "hover-cursor" : "normal", Color.foreground, Color.accent)
                        Text {
                            anchors.centerIn: parent
                            text: "Cancel"
                            color: Qt.darker(Color.foreground, 1.4)
                            font.family: Style.font.family
                            font.pixelSize: Style.font.body
                        }
                        MouseArea {
                            id: cancelMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: root.showNameInput = false
                        }
                    }
                }
            }

            PanelSectionHeader {
                Layout.fillWidth: true
                text: "Saved sessions"
            }

            Text {
                Layout.fillWidth: true
                visible: !root.cliMissing
                textFormat: Text.PlainText
                text: root.profiles.length === 0
                    ? "Save the current session above to get started."
                    : "A session is your open apps and where each one sits — workspace, monitor, size — plus browser tabs. Pin one (󰐃) to also reopen it automatically at login."
                color: Qt.darker(Color.foreground, 1.55)
                font.family: Style.font.family
                font.pixelSize: Style.font.caption
                lineHeight: 1.15
                wrapMode: Text.WordWrap
            }

            // profile list -----------------------------------------------
            ColumnLayout {
                id: rows
                Layout.fillWidth: true
                visible: root.profiles.length > 0
                spacing: Style.space(4)

                Repeater {
                    model: root.profiles

                    delegate: BorderSurface {
                            id: rowSurface
                            required property var modelData
                            required property int index
                            readonly property string pname: modelData.name
                            readonly property bool isBoot: pname === root.bootProfile
                            readonly property bool armed: pname === root.armedDelete
                            readonly property string subtitle: {
                                var w = modelData.windows || 0
                                var t = root.relTime(modelData.savedAt)
                                return w + (w === 1 ? " window" : " windows") + (t ? "  ·  " + t : "")
                            }

                            Layout.fillWidth: true
                            implicitHeight: Style.space(50)
                            radius: Style.cornerRadius
                            color: rowSurface.isBoot
                                ? Util.alpha(Color.accent, 0.12)
                                : (rowMouse.containsMouse
                                    ? Style.hoverFillFor(Color.foreground, Color.accent)
                                    : "transparent")
                            borderSpec: Border.controlSpec(
                                rowMouse.containsMouse ? "hover-cursor" : "normal",
                                Color.foreground, Color.accent)

                            // Whole-row click = restore. Declared before the
                            // RowLayout so the action buttons on top keep their
                            // own clicks.
                            MouseArea {
                                id: rowMouse
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                enabled: !root.anyBusy
                                onClicked: root.doRestore(rowSurface.pname)
                                onContainsMouseChanged: root.hoverHint = containsMouse
                                    ? ("Click to reopen “" + rowSurface.pname + "” now") : ""
                            }

                            RowLayout {
                                anchors.fill: parent
                                anchors.leftMargin: Style.space(6)
                                anchors.rightMargin: Style.space(4)
                                spacing: Style.space(4)

                                // pin / unpin for login
                                PanelActionButton {
                                    iconText: "󰐃"
                                    opacity: rowSurface.isBoot ? 1.0 : 0.5
                                    foreground: rowSurface.isBoot ? Color.accent : Qt.darker(Color.foreground, 1.5)
                                    hoverColor: Color.accent
                                    enabled: !root.anyBusy
                                    onHovered: root.hoverHint = isHovered
                                        ? (rowSurface.isBoot
                                            ? ("Unpin — stop reopening “" + rowSurface.pname + "” at login")
                                            : ("Pin — reopen “" + rowSurface.pname + "” automatically at login"))
                                        : ""
                                    onClicked: rowSurface.isBoot
                                        ? root.clearBoot()
                                        : root.setBoot(rowSurface.pname)
                                }

                                Column {
                                    Layout.fillWidth: true
                                    Layout.alignment: Qt.AlignVCenter
                                    spacing: Style.space(1)

                                    Text {
                                        width: parent.width
                                        textFormat: Text.PlainText
                                        text: rowSurface.pname
                                        color: Color.foreground
                                        font.family: Style.font.family
                                        font.pixelSize: Style.font.body
                                        elide: Text.ElideRight
                                    }
                                    Text {
                                        width: parent.width
                                        textFormat: Text.PlainText
                                        text: rowSurface.subtitle
                                        color: rowSurface.isBoot ? Color.accent : Qt.darker(Color.foreground, 1.5)
                                        font.family: Style.font.family
                                        font.pixelSize: Style.font.caption
                                        elide: Text.ElideRight
                                    }
                                }

                                // re-save the pinned session from the current layout
                                PanelActionButton {
                                    visible: rowSurface.isBoot
                                    iconText: "󰚰"
                                    hoverColor: Color.accent
                                    enabled: !root.anyBusy
                                    onHovered: root.hoverHint = isHovered
                                        ? "Re-save this session from the windows open right now" : ""
                                    onClicked: root.updateProfile(rowSurface.pname)
                                }

                                // delete (two-click)
                                PanelActionButton {
                                    iconText: rowSurface.armed ? "󰄬" : "󰆴"
                                    hoverColor: Color.urgent
                                    enabled: !root.anyBusy
                                    onHovered: root.hoverHint = isHovered
                                        ? (rowSurface.armed ? "Click again to delete" : "Delete this session") : ""
                                    onClicked: root.confirmDelete(rowSurface.pname)
                                }
                            }
                        }
                    }
                }

            PanelSeparator {
                Layout.fillWidth: true
                visible: root.profiles.length > 0
            }

            // foot: contextual hover help, else the last action, else a hint ---
            Text {
                Layout.fillWidth: true
                Layout.minimumHeight: Style.space(30)
                textFormat: Text.PlainText
                text: root.hoverHint !== "" ? root.hoverHint
                    : (root.lastAction !== "" ? root.lastAction
                        : (root.profiles.length > 0
                            ? "Click a session to reopen it · pin one to auto-restore at login"
                            : ""))
                color: root.hoverHint !== "" ? Color.accent : Qt.darker(Color.foreground, 1.5)
                font.family: Style.font.family
                font.pixelSize: Style.font.caption
                wrapMode: Text.WordWrap
                verticalAlignment: Text.AlignVCenter
            }
            }
        }
    }

    // --- engine calls -----------------------------------------------------
    // Every action is `node bin/session-restore <cmd> ...`; `node` is an
    // explicit argv[0] so a missing runtime is a clear error, not a no-op.

    function refreshStatus() {
        statusProc.command = ["node", root.cliPath, "status", "--json"]
        statusProc.running = true
    }

    Process {
        id: statusProc
        stdout: StdioCollector { id: statusOut; waitForEnd: true }
        stderr: StdioCollector { id: statusErr; waitForEnd: true }
        onExited: function (code) {
            if (code !== 0) {
                root.cliMissing = code === 127 || (statusErr.text || "").indexOf("not found") !== -1
                if (!root.cliMissing) root.lastAction = "Could not read profiles"
                root.profiles = []
                root.bootProfile = ""
                return
            }
            root.cliMissing = false
            try {
                var s = JSON.parse(statusOut.text)
                root.profiles = Array.isArray(s.profiles) ? s.profiles : []
                root.bootProfile = typeof s.boot === "string" ? s.boot : ""
                root.bootProfileMissing = root.bootProfile !== "" && s.bootExists === false
            } catch (e) {
                root.profiles = []
                root.bootProfile = ""
            }
        }
    }

    // "Save current session" opens the name prompt; the CLI takes the snapshot
    // when Save is confirmed, so it reflects the layout at that moment.
    function beginSave() {
        if (root.anyBusy) return
        nameField.text = root.generateDefaultName()
        root.showNameInput = true
        nameField.forceActiveFocus()
    }

    function confirmSave() {
        var name = nameField.text.trim()
        if (name.length === 0) return
        if (root.sanitizeProfileName(name) === null) {
            root.lastAction = "That name has characters that aren't allowed"
            return
        }
        root.runSave(name, false)
    }

    function updateProfile(name) {
        if (root.anyBusy) return
        root.runSave(name, true)
    }

    function runSave(name, isUpdate) {
        root.isSnapshotting = true
        root.lastAction = isUpdate ? ("Updating “" + name + "”…") : "Saving…"
        saveProc._name = name
        saveProc._update = isUpdate
        saveProc.command = ["node", root.cliPath, "save", name]
        saveProc.running = true
    }

    Process {
        id: saveProc
        property string _name: ""
        property bool _update: false
        stderr: StdioCollector { id: saveErr; waitForEnd: true }
        onExited: function (code) {
            root.isSnapshotting = false
            if (code !== 0) {
                root.lastAction = "Save failed"
                root.notify("Save failed", (saveErr.text || "").trim() || ("session-restore exited " + code))
                return
            }
            root.lastAction = saveProc._update
                ? ("Updated “" + saveProc._name + "”")
                : ("Saved “" + saveProc._name + "”")
            root.showNameInput = false
            root.refreshStatus()
            root.notify(root.lastAction, "")
        }
    }

    function doRestore(name) {
        if (root.anyBusy) return
        root.isRestoring = true
        root.lastAction = "Restoring “" + name + "”…"
        restoreProc.command = ["node", root.cliPath, "restore", name]
        restoreProc.running = true
    }

    Process {
        id: restoreProc
        stdout: StdioCollector { id: restoreOut; waitForEnd: true }
        stderr: StdioCollector { id: restoreErr; waitForEnd: true }
        onExited: function (code) {
            root.isRestoring = false
            if (code !== 0) {
                root.lastAction = "Restore failed"
                root.notify("Restore failed", (restoreErr.text || "").trim() || ("session-restore exited " + code))
                return
            }
            // The CLI fires its own success notification.
            root.lastAction = (restoreOut.text || "Restored").trim()
        }
    }

    function setBoot(name) {
        if (root.anyBusy) return
        root.isBusy = true
        bootProc._clear = false
        bootProc.command = ["node", root.cliPath, "boot-profile", name]
        bootProc.running = true
    }

    function clearBoot() {
        if (root.anyBusy) return
        root.isBusy = true
        bootProc._clear = true
        bootProc.command = ["node", root.cliPath, "boot-profile", "--clear"]
        bootProc.running = true
    }

    Process {
        id: bootProc
        property bool _clear: false
        stderr: StdioCollector { id: bootErr; waitForEnd: true }
        onExited: function (code) {
            root.isBusy = false
            if (code !== 0) {
                root.lastAction = "Could not change the login profile"
                root.notify("Session Restore", (bootErr.text || "").trim() || "boot-profile failed")
                return
            }
            root.lastAction = bootProc._clear
                ? "Login restore turned off"
                : "Will restore at login"
            root.refreshStatus()
        }
    }

    function confirmDelete(name) {
        if (root.anyBusy) return
        if (root.armedDelete !== name) {
            root.armedDelete = name
            delArmTimer.restart()
            return
        }
        delArmTimer.stop()
        root.armedDelete = ""
        root.isBusy = true
        deleteProc._name = name
        deleteProc.command = ["node", root.cliPath, "delete", name]
        deleteProc.running = true
    }

    Process {
        id: deleteProc
        property string _name: ""
        stderr: StdioCollector { id: deleteErr; waitForEnd: true }
        onExited: function (code) {
            root.isBusy = false
            if (code !== 0) {
                root.lastAction = "Delete failed"
                root.notify("Delete failed", (deleteErr.text || "").trim() || ("session-restore exited " + code))
                return
            }
            root.lastAction = "Deleted “" + deleteProc._name + "”"
            root.refreshStatus()
        }
    }
}
