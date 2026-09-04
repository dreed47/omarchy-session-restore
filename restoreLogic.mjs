export function sanitizeProfileName(name) {
    if (typeof name !== "string") return null
    var n = name.trim()
    if (n.length === 0 || n.length > 128) return null
    if (n === "." || n === "..") return null
    if (n.charAt(0) === ".") return null
    if (/[\/\\\x00-\x1f]/.test(n)) return null
    if (!/^[A-Za-z0-9][A-Za-z0-9._ \-]*$/.test(n)) return null
    return n
}

export function validProfilePath(name, profileDir) {
    var safe = sanitizeProfileName(name)
    if (safe === null) return null
    var base = profileDir
    var resolved = base + "/" + safe + ".json"
    if (resolved.indexOf(base) !== 0) return null
    return resolved
}

export function shellArg(s) {
    if (s === null || s === undefined) return "''"
    return "'" + String(s).replace(/'/g, "'\\''") + "'"
}

export function sanitizeLaunchCommand(raw, fallbackClass) {
    var src = raw || (fallbackClass ? fallbackClass.toLowerCase() : "")
    var tokens = String(src).split(/\s+/).filter(function (t) { return t.length > 0 })
    if (tokens.length === 0) return ""
    if (!/^(\.?\/)?[A-Za-z0-9_][A-Za-z0-9_.+/-]*$/.test(tokens[0])) return ""
    var out = []
    for (var i = 0; i < tokens.length; i++) out.push(shellArg(tokens[i]))
    return out.join(" ")
}

export function safeWorkspace(ws) {
    if (typeof ws !== "string") return null
    if (!/^[_a-z0-9]{1,32}$/i.test(ws)) return null
    return ws
}

export function safeClass(cls) {
    if (typeof cls !== "string") return null
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(cls)) return null
    return cls
}

export function numOr(v) {
    var n = Number(v)
    return isFinite(n) ? Math.round(n) : 0
}

export function profileIconFor(name) {
    var n = (name || "").toLowerCase()
    if (/code|dev|coding|prog|program|project/.test(n)) return "\ue796"
    if (/work|office|job/.test(n)) return "\uf0c0"
    if (/photo|image|picture|gimp|design|edit|art|draw/.test(n)) return "\uf1c5"
    if (/music|audio|song|media/.test(n)) return "\ue602"
    if (/game|play|gaming/.test(n)) return "\uf11b"
    if (/web|internet|www|browser|search/.test(n)) return "\ue700"
    if (/video|movie|film|stream/.test(n)) return "\uf03d"
    if (/term|shell|cli|console/.test(n)) return "\uf120"
    if (/chat|discord|telegram|message|slack/.test(n)) return "\uf086"
    if (/doc|note|write|text|paper/.test(n)) return "\uf15c"
    if (/file|folder|fm|nautilus|browse/.test(n)) return "\uf07b"
    if (/mail|email|gmail/.test(n)) return "\uf0e0"
    if (/home|default/.test(n)) return "\uf015"
    return "\uf2db"
}

export function generateDefaultName(date) {
    var d = date || new Date()
    var pad = function (n) { return n < 10 ? "0" + n : "" + n }
    return "snapshot-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
        "-" + pad(d.getHours()) + pad(d.getMinutes())
}

export function cleanCmd(raw) {
    if (!raw) return null
    var v = raw.replace(/\s+/g, " ").trim()
    return v.length ? v : null
}

export function buildMonitorMap(monitors) {
    var map = {}
    for (var i = 0; i < monitors.length; i++) {
        map[monitors[i].id] = monitors[i].name
    }
    return map
}

// Class-name sets for browser detection. Matches Firefox-family and
// Chromium-family browsers by their Hyprland window class.
const FIREFOX_CLASSES = /^(firefox|librewolf|waterfox|floorp|tor-browser|zen|palemoon|seamonkey)(\.|-|$)/i
const CHROMIUM_CLASSES = /(chrom|brave|vivaldi|edge|opera|electron)/i

// Return the browser engine type for a window class: "firefox", "chromium",
// or null if it isn't a browser we can tab-capture.
export function browserTypeForClass(cls) {
    if (typeof cls !== "string" || cls.length === 0) return null
    if (FIREFOX_CLASSES.test(cls)) return "firefox"
    if (CHROMIUM_CLASSES.test(cls)) return "chromium"
    return null
}

// Validate a tab URL before it is injected into a launch command. Accepts
// http/https and a conservative set of safe schemes, and rejects anything with
// shell metacharacters or whitespace so a crafted/compromised URL can never
// break out of the generated bash. Returns the trimmed URL or null.
export function safeUrl(url) {
    if (typeof url !== "string") return null
    var u = url.trim()
    if (u.length === 0 || u.length > 4096) return null
    // Scheme + rest; reject any shell metacharacters entirely.
    if (!/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(u)) {
        // Allow a few special no-host schemes browsers can show in tabs.
        if (/^(about|chrome|edge|brave|moz-extension|file|view-source|chrome-extension):/i.test(u)) {
            if (/[\s`$;|&<>"'\\\x00-\x1f]/.test(u)) return null
            return u
        }
        return null
    }
    if (/[\s`$;|&<>"'\\\x00-\x1f]/.test(u)) return null
    return u
}

// Build a list of shell-quoted, validated tab URLs (excluding new-tab/blank
// pages that we don't want to reopen) from a snapshot window's tabs array.
// Returns a string like "'url1' 'url2'", or "" if there are no usable tabs.
export function buildTabUrls(tabs) {
    if (!Array.isArray(tabs)) return ""
    var out = []
    for (var i = 0; i < tabs.length; i++) {
        var tab = tabs[i]
        if (!tab || typeof tab.url !== "string") continue
        var url = safeUrl(tab.url)
        if (url === null) continue
        var lower = url.toLowerCase()
        if (lower === "about:newtab" || lower === "about:blank" || lower === "") continue
        out.push(shellArg(url))
    }
    return out.join(" ")
}

// Given a base launch command string and a browser window snapshot, append the
// tab URLs with --new-window when tabs are present. Returns the augmented
// command ("" if nothing usable). Used by restore to reopen a browser's pages.
export function buildBrowserLaunchCommand(pureCommand, cls, tabs) {
    var cmd = pureCommand || ""
    var type = browserTypeForClass(cls)
    if (!type) return cmd
    var urls = buildTabUrls(tabs)
    if (urls.length === 0) return cmd
    // If the base command is empty, fall back to the browser executable name.
    var base = cmd.length > 0 ? cmd : "'" + cls.toLowerCase() + "'"
    // Strip a stale `--new-window <urls>` tail left over from a previous
    // restore (the captured /proc cmdline still carries it), otherwise we'd
    // append another URL list and reopen duplicates.
    var marker = base.indexOf(" --new-window ")
    if (marker !== -1) base = base.slice(0, marker)
    return base + " --new-window " + urls
}

// Like buildBrowserLaunchCommand but returns an array of shell commands to run
// in sequence (one launch step per element), which the restore script executes
// line by line.  When the browser is already running (the common case), passing
// `--new-window url1 url2` to Firefox opens ONE window per URL, and Vivaldi's
// own session restore may add extra tabs.  To avoid both problems we pass all
// URLs without `--new-window` so they open as tabs in the existing window
// (single window, all tabs, no duplicates).  When the browser is not running,
// the same command opens one fresh window with all tabs.
export function buildBrowserLaunchCommands(pureCommand, cls, tabs) {
    var cmd = pureCommand || ""
    var type = browserTypeForClass(cls)
    if (!type) return cmd ? [cmd] : []
    var urls = buildTabUrls(tabs)
    if (urls.length === 0) return cmd ? [cmd] : []
    var base = cmd.length > 0 ? cmd : "'" + cls.toLowerCase() + "'"
    var marker = base.indexOf(" --new-window ")
    if (marker !== -1) base = base.slice(0, marker)
    return [base + " " + urls]
}

// ---------------------------------------------------------------------------
// Snapshot assembly (pure). The impure parts - running hyprctl, reading
// /proc, invoking the tab-capture helper - live in lib/io.mjs and bin/
// session-restore. Everything below turns already-collected raw data into a
// profile object, and is unit-tested.
// ---------------------------------------------------------------------------

// Resolve the browser profile / user-data directory for a window from its
// captured /proc command line. Chromium: the --user-data-dir value or the
// per-browser default under `home`. Firefox: the -P/--profile path or the
// default ~/.mozilla/firefox base. Returns a path string or null. `home` is
// passed explicitly so this stays pure (the QML side reads Quickshell.env).
export function resolveBrowserProfile(btype, cmdline, home) {
    var h = home || ""
    var cmd = String(cmdline || "")
    var m
    if (btype === "chromium") {
        m = /--user-data-dir=("?)([^"\s]+)\1/.exec(cmd)
        if (m) return m[2]
        if (/google-chrome/i.test(cmd)) return h + "/.config/google-chrome"
        if (/chromium/i.test(cmd)) return h + "/.config/chromium"
        if (/brave/i.test(cmd)) return h + "/.config/BraveSoftware/Brave-Browser"
        if (/vivaldi/i.test(cmd)) return h + "/.config/vivaldi"
        if (/edge/i.test(cmd)) return h + "/.config/microsoft-edge"
        if (/opera/i.test(cmd)) return h + "/.config/opera"
        return null
    } else if (btype === "firefox") {
        m = /--profile(=|\s+)(\S+)/.exec(cmd)
        if (m) return m[2]
        m = /-P\s+(\S+)/.exec(cmd)
        if (m) return h + "/.mozilla/firefox/" + m[1]
        return h + "/.mozilla/firefox"
    }
    return null
}

// The bash program that reads /proc for a set of PIDs. Emits one
// "PID<TAB>cmdline<TAB>cwd" line per PID; tabs/newlines inside values are
// collapsed to spaces so the TSV stays parseable. PIDs are numeric (they come
// from `hyprctl -j clients`), and non-numeric entries are dropped defensively.
export function procInfoScript(pids) {
    var clean = (pids || [])
        .map(function (p) { return String(p) })
        .filter(function (p) { return /^[0-9]+$/.test(p) })
    return 'pids="' + clean.join(" ") + '"; ' +
        'for p in $pids; do ' +
        "  cmd=$(cat /proc/$p/cmdline 2>/dev/null | tr '\\0' ' ' | tr '\\t\\n' '  ' | sed 's/ *$//'); " +
        "  cwd=$(readlink /proc/$p/cwd 2>/dev/null | tr '\\t\\n' '  '); " +
        "  printf '%s\\t%s\\t%s\\n' \"$p\" \"$cmd\" \"$cwd\"; " +
        'done'
}

// Parse the output of procInfoScript() into { [pid]: {pid, cmdline, cwd} }.
export function parseProcInfo(text) {
    var infoMap = {}
    var lines = (text || "").split("\n")
    for (var l = 0; l < lines.length; l++) {
        var line = lines[l].trim()
        if (!line) continue
        var parts = line.split("\t")
        if (parts.length >= 1 && parts[0]) {
            infoMap[parts[0]] = { pid: parts[0], cmdline: parts[1] || "", cwd: parts[2] || "" }
        }
    }
    return infoMap
}

// Turn raw `hyprctl -j clients` + `hyprctl -j monitors` + parsed /proc info
// into the profile's window array. `procInfo` is the map from parseProcInfo();
// `home` is the user's home directory (for browser-profile resolution).
export function assembleWindows(opts) {
    var clients = (opts && opts.clients) || []
    var monitors = (opts && opts.monitors) || []
    var procInfo = (opts && opts.procInfo) || {}
    var home = (opts && opts.home) || ""

    var monMap = buildMonitorMap(monitors)
    var windows = []
    // Command cache per PID: split-screen windows sharing a PID must all get
    // the same launch command, or a later one falls back to class name.
    var pidCmd = {}

    for (var i = 0; i < clients.length; i++) {
        var c = clients[i]
        var info = procInfo[String(c.pid)]
        var rawCmd = (info && info.cmdline) ? info.cmdline.trim() : null
        var cwd = (info && info.cwd) ? info.cwd.trim() : null
        var monName = (monMap[c.monitor] !== undefined && monMap[c.monitor] !== null)
            ? monMap[c.monitor] : String(c.monitor)

        var cmd = pidCmd[c.pid]
        if (cmd === undefined) {
            cmd = cleanCmd(rawCmd)
            pidCmd[c.pid] = cmd
        }

        var btype = browserTypeForClass(c.class)
        var bprofile = btype ? resolveBrowserProfile(btype, rawCmd, home) : null

        windows.push({
            "class": c.class,
            "title": c.title,
            "pid": c.pid,
            "address": c.address,
            "workspace": c.workspace ? c.workspace.name : null,
            "workspaceId": c.workspace ? c.workspace.id : null,
            "monitor": monName,
            "monitorId": c.monitor,
            "command": cmd,
            "cwd": cwd,
            "position": [c.at ? c.at[0] : 0, c.at ? c.at[1] : 0],
            "size": [c.size ? c.size[0] : 0, c.size ? c.size[1] : 0],
            "splitRatio": c.splitratio,
            "floating": c.floating,
            "fullscreen": c.fullscreen,
            "browser": btype,
            "browserProfile": bprofile,
            "tabs": null
        })
    }
    return windows
}

// One tab-capture invocation string per unique (browser, profile) pair.
// `scriptPath` is the absolute path to scripts/capture_tabs.py. The trailing
// argument is the routing key the helper echoes back in its JSON `_profile`.
export function tabCaptureInvocations(windows, scriptPath) {
    var seen = {}
    var invocations = []
    for (var i = 0; i < windows.length; i++) {
        var w = windows[i]
        if (!w.browser || !w.browserProfile) continue
        var key = w.browser + "\u0001" + w.browserProfile
        if (seen[key]) continue
        seen[key] = true
        invocations.push("python3 " + shellArg(scriptPath) + " " +
            shellArg(w.browser) + " " + shellArg(w.browserProfile) + " " +
            shellArg(key))
    }
    return invocations
}

// Parse the newline-delimited JSON emitted by the tab-capture helper into
// { [key]: {ok, tabs, _profile} }.
export function parseTabResults(text) {
    var results = {}
    var lines = (text || "").split("\n")
    for (var r = 0; r < lines.length; r++) {
        var ln = lines[r].trim()
        if (!ln) continue
        try {
            var o = JSON.parse(ln)
            if (o && o._profile) results[o._profile] = o
        } catch (e) { /* ignore a malformed line */ }
    }
    return results
}

// Attach captured tabs onto the first window of each unique browser profile
// (so restore does not reopen the same pages from several windows sharing one
// browser process). Mutates and returns `windows`.
export function attachTabs(windows, tabResults) {
    var results = tabResults || {}
    var attached = {}
    for (var i = 0; i < windows.length; i++) {
        var w = windows[i]
        if (!w.browser || !w.browserProfile) continue
        var key = w.browser + "\u0001" + w.browserProfile
        if (attached[key]) continue
        attached[key] = true
        var res = results[key]
        w.tabs = (res && res.ok && Array.isArray(res.tabs)) ? res.tabs : []
    }
    return windows
}

// Full snapshot object from collected raw data.
export function buildSnapshot(opts) {
    var windows = assembleWindows(opts)
    attachTabs(windows, (opts && opts.tabResults) || {})
    return {
        "timestamp": (opts && opts.now) || Date.now(),
        "windows": windows,
        "monitors": (opts && opts.monitors) || []
    }
}

// ---------------------------------------------------------------------------
// Restore script builder (pure). Produces the bash program that moves matched
// windows and spawns missing ones via the Omarchy `hl.dsp.*` bridge. The
// returned `script` is what gets written to `$WSROOT/restore.sh`; wrap it with
// wrapRestoreRunner() to get the outer `bash -c` argument that creates the
// private temp dir. Ported verbatim from the QML widget so behaviour matches.
// ---------------------------------------------------------------------------
export function buildRestoreScript(profile, existing) {
    var lines = ["#!/bin/bash"]
    lines.push('LOGFILE="$WSROOT/restore.log"')
    lines.push("SAFETY_OWNED=0")
    lines.push("trap 'if [ \"$SAFETY_OWNED\" != \"1\" ]; then rm -rf \"$WSROOT\"; fi' EXIT")
    lines.push('echo "[start] wsroot=$WSROOT profile_windows=' + profile.windows.length +
        " existing=" + (existing ? existing.length : 0) + '" >> "$LOGFILE"')

    var matched = []
    for (var p0 = 0; p0 < profile.windows.length; p0++) matched[p0] = false

    var toMove = []
    var toFloat = []
    var matchedAddrs = []
    var browserCloseAddrs = []

    if (existing && existing.length > 0) {
        for (var i = 0; i < existing.length; i++) {
            var e = existing[i]
            var bestIdx = -1
            for (var p = 0; p < profile.windows.length; p++) {
                if (matched[p]) continue
                if (e.class === profile.windows[p].class) {
                    if (bestIdx === -1) bestIdx = p
                    if (e.title === profile.windows[p].title) {
                        bestIdx = p
                        break
                    }
                }
            }
            if (bestIdx >= 0) {
                var target = profile.windows[bestIdx]
                if (target.browser && target.tabs && target.tabs.length > 0) {
                    browserCloseAddrs.push(e.address)
                    continue
                }
                matched[bestIdx] = true
                matchedAddrs.push(e.address)
                var tws = safeWorkspace(target.workspace)
                if (tws !== null && String(e.workspace.name) !== String(target.workspace)) {
                    toMove.push({ addr: e.address, ws: tws, cls: e.class, splitRatio: target.splitRatio, fullscreen: target.fullscreen, e_floating: e.floating, e_fullscreen: e.fullscreen })
                }
                if (target.floating) {
                    toFloat.push({ addr: e.address, pos: target.position, size: target.size, e_floating: e.floating, e_fullscreen: e.fullscreen })
                }
            }
        }
    }

    // Phase 0: pin each snapshotted workspace to its capture-time monitor
    // before anything moves into it (Hyprland workspaces are global).
    var wsToMonitor = {}
    for (var wm = 0; wm < profile.windows.length; wm++) {
        var pws = safeWorkspace(profile.windows[wm].workspace)
        var pmon = profile.windows[wm].monitor
        if (pws !== null && pmon && /^[A-Za-z0-9-]{1,64}$/.test(pmon)) {
            wsToMonitor[pws] = pmon
        }
    }
    for (var wsName in wsToMonitor) {
        if (!wsToMonitor[wsName]) continue
        lines.push('echo "[pin] ws=' + wsName + " monitor=" + wsToMonitor[wsName] + '" >> "$LOGFILE"')
        lines.push("hyprctl dispatch \"hl.dsp.workspace.move({workspace='" + wsName + "', monitor='" + wsToMonitor[wsName] + "'})\" 2>>\"$LOGFILE\" || true")
    }

    // Phase 2: move matched windows to their workspaces.
    for (var m = 0; m < toMove.length; m++) {
        var mv = toMove[m]
        lines.push('echo "[move-existing] ws=' + mv.ws + " addr=" + mv.addr + '" >> "$LOGFILE"')
        lines.push("hyprctl dispatch \"hl.dsp.window.move({workspace='" + mv.ws + "', window='address:" + mv.addr + "', follow=false})\" 2>>\"$LOGFILE\" || true")
        if (mv.fullscreen && !mv.e_fullscreen) {
            lines.push("hyprctl dispatch \"hl.dsp.window.fullscreen({mode='fullscreen', window='address:" + mv.addr + "'})\" 2>>\"$LOGFILE\" || true")
        }
    }

    // Phase 2b: floating state + position/size.
    for (var f = 0; f < toFloat.length; f++) {
        var fl = toFloat[f]
        var fx = numOr(fl.pos[0])
        var fy = numOr(fl.pos[1])
        var fw = numOr(fl.size[0])
        var fh = numOr(fl.size[1])
        if (!fl.e_floating) {
            lines.push("hyprctl dispatch \"hl.dsp.window.float({action='toggle', window='address:" + fl.addr + "'})\" 2>>\"$LOGFILE\" || true")
        }
        lines.push("hyprctl dispatch \"hl.dsp.window.move({x=" + fx + ", y=" + fy + ", relative=false, window='address:" + fl.addr + "'})\" 2>>\"$LOGFILE\" || true")
        lines.push("hyprctl dispatch \"hl.dsp.window.resize({x=" + fw + ", y=" + fh + ", window='address:" + fl.addr + "'})\" 2>>\"$LOGFILE\" || true")
    }

    // Phase 2c: close existing browser windows whose snapshot carried tabs so
    // the browser process exits and Phase 3 can relaunch it clean.
    if (browserCloseAddrs.length > 0) {
        for (var bc = 0; bc < browserCloseAddrs.length; bc++) {
            lines.push('echo "[close-browser] addr=' + browserCloseAddrs[bc] + '" >> "$LOGFILE"')
            lines.push("hyprctl dispatch \"hl.dsp.window.close({window='address:" + browserCloseAddrs[bc] + "'})\" 2>>\"$LOGFILE\" || true")
        }
        lines.push("sleep 1.5")
    }

    // Phase 3: spawn missing windows onto their target workspace
    // (focus-then-launch).
    var spawnCount = 0
    var spawnTargets = []
    for (var j = 0; j < profile.windows.length; j++) {
        if (matched[j]) continue
        var w = profile.windows[j]
        var ws = safeWorkspace(w.workspace)
        var cls = safeClass(w.class)
        if (ws === null || cls === null) {
            lines.push('echo "[launch] skipped unsafe metadata" >> "$LOGFILE"')
            continue
        }
        var cmd = sanitizeLaunchCommand(w.command, cls)
        var cmds
        if (w.browser && (w.tabs && w.tabs.length > 0)) {
            cmds = buildBrowserLaunchCommands(cmd, cls, w.tabs)
        } else {
            cmds = cmd.length > 0 ? [cmd] : []
        }
        if (cmds.length === 0) {
            lines.push('echo "[launch] no safe command for ws=' + ws + '" >> "$LOGFILE"')
        }
        var steps = []
        for (var k = 0; k < cmds.length; k++) {
            if (k === 0 && cmds.length === 1) {
                steps.push("exec " + cmds[k])
            } else if (k === 0) {
                steps.push(cmds[k] + " &")
            } else {
                steps.push(cmds[k])
            }
            if (k < cmds.length - 1) steps.push("sleep 0.4")
        }
        var launchline = steps.length > 0 ? steps.join("\n") : "exit 1"
        lines.push('SPATH="$WSROOT/spawn-' + j + '.sh"')
        lines.push("printf '#!/bin/bash\\n%s\\n' " + shellArg(launchline) + ' > "$SPATH" && chmod 700 "$SPATH"')
        lines.push("hyprctl dispatch \"hl.dsp.focus({workspace='" + ws + "'})\" 2>>\"$LOGFILE\" || true")
        lines.push("sleep 0.3")
        lines.push('bash "$SPATH" &')
        lines.push('echo "[launch] ws=' + ws + " cmd='$SPATH'\" >> \"$LOGFILE\"")

        spawnTargets.push({
            cls: cls, ws: ws, floating: w.floating, fullscreen: w.fullscreen,
            splitRatio: w.splitRatio, pos: w.position, size: w.size
        })
        spawnCount++
    }

    // Phase 3b: detached class-based safety re-check for apps that ignore the
    // focused workspace on launch (Electron apps especially).
    if (spawnCount > 0) {
        var safety = []
        safety.push("#!/bin/bash")
        safety.push('LOGFILE="$WSROOT/restore.log"')
        safety.push("trap 'rm -rf \"$WSROOT\"' EXIT")
        safety.push('MATCHED_ADDRS="' + matchedAddrs.join(" ") + '"')
        safety.push("sleep 1")
        safety.push('MOVED_ADDRS=""')
        for (var s = 0; s < spawnTargets.length; s++) {
            var t = spawnTargets[s]
            var jqFilter = '.[] | select((.class | ascii_downcase | gsub("\\\\.desktop$"; "")) == "' + t.cls + '") | [.address, .workspace.name] | @tsv'
            safety.push("ATTEMPT=0")
            safety.push("HANDLED=0")
            safety.push("while [ $ATTEMPT -lt 30 ] && [ $HANDLED -eq 0 ]; do")
            safety.push("  MATCHES=$(hyprctl clients -j | jq -r '" + jqFilter + "' 2>>\"$LOGFILE\")")
            safety.push('  echo "[move-spawn] attempt=$ATTEMPT cls=' + t.cls + " ws=" + t.ws + ' matches=$MATCHES" >> "$LOGFILE"')
            safety.push("  while IFS=$'\\t' read -r A W; do")
            safety.push('    [ -z "$A" ] && continue')
            safety.push('    if [[ " $MOVED_ADDRS " == *" $A "* ]] || [[ " $MATCHED_ADDRS " == *" $A "* ]]; then continue; fi')
            safety.push('    MOVED_ADDRS="$MOVED_ADDRS $A"')
            safety.push('    if [ "$W" != "' + t.ws + '" ]; then')
            safety.push("      hyprctl dispatch \"hl.dsp.window.move({workspace='" + t.ws + "', window='address:$A', follow=false})\" 2>>\"$LOGFILE\" || true")
            if (t.floating) {
                var sx = numOr(t.pos[0])
                var sy = numOr(t.pos[1])
                var sw = numOr(t.size[0])
                var sh = numOr(t.size[1])
                safety.push("      hyprctl dispatch \"hl.dsp.window.float({action='toggle', window='address:$A'})\" 2>>\"$LOGFILE\" || true")
                safety.push("      hyprctl dispatch \"hl.dsp.window.move({x=" + sx + ", y=" + sy + ", relative=false, window='address:$A'})\" 2>>\"$LOGFILE\" || true")
                safety.push("      hyprctl dispatch \"hl.dsp.window.resize({x=" + sw + ", y=" + sh + ", window='address:$A'})\" 2>>\"$LOGFILE\" || true")
            }
            if (t.fullscreen) {
                safety.push("      hyprctl dispatch \"hl.dsp.window.fullscreen({mode='fullscreen', window='address:$A'})\" 2>>\"$LOGFILE\" || true")
            }
            safety.push("    fi")
            safety.push("    HANDLED=1")
            safety.push('  done <<< "$MATCHES"')
            safety.push("  ATTEMPT=$((ATTEMPT+1))")
            safety.push("  if [ $HANDLED -eq 0 ]; then sleep 0.5; fi")
            safety.push("done")
        }
        lines.push("SAFETY_OWNED=1")
        lines.push('SAFETY="$WSROOT/safety.sh"')
        lines.push("printf '%s\\n' " + shellArg(safety.join("\n")) + ' > "$SAFETY" && chmod 700 "$SAFETY"')
        lines.push('nohup bash "$SAFETY" >/dev/null 2>&1 &')
        lines.push("disown")
    }

    var totalCount = toMove.length + toFloat.length + spawnCount
    return { script: lines.join("\n"), count: totalCount }
}

// Wrap a restore script in the outer command that creates a private 0700
// temp dir, writes the script into it, and runs it. Returned string is meant
// for `bash -c <this>`.
export function wrapRestoreRunner(script) {
    return "set -o pipefail; " +
        "WSROOT=$(mktemp -d) || exit 1; " +
        "chmod 700 \"$WSROOT\" || exit 1; " +
        "umask 077; " +
        "export WSROOT; " +
        "printf '%s\\n' " + shellArg(script) + " > \"$WSROOT/restore.sh\" && " +
        "bash \"$WSROOT/restore.sh\""
}

// Path of the marker file naming the profile to restore on login.
export function bootMarkerPath(profileDir) {
    return profileDir + "/.boot-profile"
}

