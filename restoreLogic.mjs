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

export function sanitizeCwd(raw) {
    if (typeof raw !== "string") return null
    var n = raw.trim()
    if (n.length === 0 || n.length > 4096) return null
    if (n.charAt(0) !== "/") return null
    if (n.indexOf("\0") >= 0 || /[\x00-\x1f]/.test(n)) return null
    var parts = n.split("/")
    for (var i = 0; i < parts.length; i++) {
        if (parts[i] === "..") return null
    }
    return n
}

export function sanitizeLaunchCommand(raw, fallbackClass) {
    var src = raw || (fallbackClass ? fallbackClass.toLowerCase() : "")
    var tokens = String(src).split(/\s+/).filter(function (t) { return t.length > 0 })
    if (tokens.length === 0) return ""
    if (!/^(\.?\/)?[A-Za-z0-9_][A-Za-z0-9_.+/-]*$/.test(tokens[0])) return ""
    var out = []
    for (var i = 0; i < tokens.length; i++) {
        // A captured gtk-single-instance terminal is forwarded to an already
        // running ghostty/gtk process (wrong cwd, so project env like mise
        // [env] never loads). Drop it so restore starts a real new process.
        if (/^--gtk-single-instance(=true)?$/.test(tokens[i])) continue
        out.push(shellArg(tokens[i]))
    }
    return out.join(" ")
}

// Executable + flags only from a captured browser cmdline, discarding every
// bare positional argument (typically URLs).
//
// Once this tool has ever restored a browser window with `exec browser url1
// url2 ...`, that argv is baked into the running process's /proc/<pid>/cmdline
// permanently - `exec` replaces the process image, so the URLs stay in its
// cmdline for as long as the browser keeps running, often far longer than the
// tabs themselves stay open. If a later restore used that captured cmdline as
// the base and appended the newly-captured tabs, the old URL list would be
// replayed and grow on every single restore, compounding duplicate tabs
// indefinitely. Flag-style tokens (e.g. --profile-directory=Default) are kept
// since they can select the right browser profile; only bare positionals are
// dropped, because the caller is always about to supply the exact tab list to
// reopen. Returns "" if the executable token is unsafe, mirroring
// sanitizeLaunchCommand.
export function browserRelaunchBase(raw, fallbackClass) {
    var src = raw || (fallbackClass ? fallbackClass.toLowerCase() : "")
    var tokens = String(src).split(/\s+/).filter(function (t) { return t.length > 0 })
    if (tokens.length === 0) return ""
    if (!/^(\.?\/)?[A-Za-z0-9_][A-Za-z0-9_.+/-]*$/.test(tokens[0])) return ""
    var out = [shellArg(tokens[0])]
    for (var i = 1; i < tokens.length; i++) {
        if (tokens[i].charAt(0) === "-") out.push(shellArg(tokens[i]))
    }
    return out.join(" ")
}

// Omarchy web apps (and Chromium-family --app= windows in general) share the
// browser process, so /proc/<pid>/cmdline is just `chrome` / `brave` / etc.
// The window class is the durable identity:
//   <product>-<host>__-<Profile>     SSB / omarchy-launch-webapp
//   <product>-<32-char-id>-<Profile> installed PWA (--app-id)
// product is chrome, chromium, brave, msedge, vivaldi, opera, helium, ...
export function parseWebAppClass(cls) {
    if (typeof cls !== "string") return null
    var product = "(chrome|chromium|brave|brave-browser|msedge|microsoft-edge|vivaldi|vivaldi-stable|opera|helium|helium-browser)"
    var m = new RegExp("^" + product + "-([a-z0-9-]+(?:\\.[a-z0-9-]+)+)__-([A-Za-z0-9]{1,64})$", "i").exec(cls)
    if (m) {
        var host = m[2]
        if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,253}$/.test(host)) return null
        var url = "https://" + host + "/"
        if (safeUrl(url) === null) return null
        return { kind: "url", product: m[1].toLowerCase(), host: host.toLowerCase(), profile: m[3], url: url }
    }
    m = new RegExp("^" + product + "-([a-z0-9]{32})-([A-Za-z0-9]{1,64})$", "i").exec(cls)
    if (m) {
        return { kind: "appid", product: m[1].toLowerCase(), appId: m[2], profile: m[3] }
    }
    return null
}

export function isWebAppClass(cls) {
    return parseWebAppClass(cls) !== null
}

// Command that actually creates the web-app window. URL-style apps go through
// omarchy-launch-webapp (uwsm-app + the user's default Chromium-family browser
// + --app=URL) — the same path the desktop launcher uses. Installed PWAs have
// no URL in the class; the caller appends --app-id= to the captured binary.
export function webAppLaunchCommand(cls) {
    var p = parseWebAppClass(cls)
    if (!p || p.kind !== "url") return null
    return "omarchy-launch-webapp " + p.url
}

// Class identity for matching: lowercase, strip a Wayland instance suffix
// (`org.telegram.desktop._<hex>` → `org.telegram.desktop`) then a trailing
// `.desktop` so org.telegram.desktop and org.telegram compare equal.
export function normClass(cls) {
    if (typeof cls !== "string" || cls.length === 0) return ""
    return cls.toLowerCase()
        .replace(/\._[0-9a-f]{8,}$/i, "")
        .replace(/\.desktop$/i, "")
}

function classKeys(w) {
    var keys = []
    var seen = {}
    function add(c) {
        var n = normClass(c)
        if (!n || seen[n]) return
        seen[n] = true
        keys.push(n)
    }
    add(w && w.class)
    add(w && w.initialClass)
    return keys
}

// True when two window records share a class or initialClass (after normClass).
export function classesMatch(a, b) {
    var ka = classKeys(a)
    var kb = classKeys(b)
    for (var i = 0; i < ka.length; i++) {
        for (var j = 0; j < kb.length; j++) {
            if (ka[i] === kb[j]) return true
        }
    }
    return false
}

// Chrome auto-restores old tabs from Sessions/Session_* + Tabs_* after an
// abrupt exit (reboot where Chrome was killed rather than quit), and merges
// that with any URLs this plugin passes on the command line. Resetting
// profile.exit_type in Preferences does not stop it (verified on Chrome 152)
// and was a write into another app's config, so it is gone. Deleting the
// snapshot files before launch is the fix that actually works. Best-effort:
// a missing Sessions dir is a no-op.
export function clearChromiumSessionSnapshotLines(browserProfile, cls) {
    if (!browserProfile || browserTypeForClass(cls) !== "chromium") return []
    var base = String(browserProfile).replace(/\/$/, "")
    // Quoted directory + unquoted glob suffix: the shell concatenates them
    // into one word before pathname expansion, so the glob still expands
    // (an entirely single-quoted path would not).
    var sessions = shellArg(base + "/Default/Sessions")
    return [
        "rm -f " + sessions + "/Session_* " + sessions + "/Tabs_* 2>/dev/null || true",
    ]
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

function isLiveMonitor(m) {
    if (!m || m.disabled) return false
    return typeof m.name === "string" && /^[A-Za-z0-9-]{1,64}$/.test(m.name)
}

export function liveMonitorNames(monitors) {
    var names = []
    if (!monitors) return names
    for (var i = 0; i < monitors.length; i++) {
        if (isLiveMonitor(monitors[i])) names.push(monitors[i].name)
    }
    return names
}

// Monitor to pin onto when a saved output is gone (undocked laptop). Focused
// first, then the first enabled output.
export function pickFallbackMonitor(monitors) {
    if (!monitors) return null
    var first = null
    for (var i = 0; i < monitors.length; i++) {
        var m = monitors[i]
        if (!isLiveMonitor(m)) continue
        if (m.focused) return m.name
        if (first === null) first = m.name
    }
    return first
}

// Keep the saved name when that output is still connected; otherwise the
// fallback. With no live list, return the saved name unchanged (tests / dry
// runs that do not pass monitors).
export function resolveMonitorName(saved, liveMonitors) {
    if (!liveMonitors || liveMonitors.length === 0) {
        return (typeof saved === "string" && /^[A-Za-z0-9-]{1,64}$/.test(saved)) ? saved : null
    }
    var names = liveMonitorNames(liveMonitors)
    if (typeof saved === "string" && names.indexOf(saved) >= 0) return saved
    return pickFallbackMonitor(liveMonitors)
}

// Shell chrome that should never be captured or restored: the Omarchy bar,
// Hyprland special/scratchpad workspaces, portals, polkit, notification daemons.
export function isInfrastructureWindow(c) {
    if (!c) return true
    if (c.class === "org.quickshell") return true
    var ws = c.workspace && (typeof c.workspace === "object" ? c.workspace.name : c.workspace)
    if (typeof ws === "string" && /^special(:|$)/.test(ws)) return true
    var blob = String(c.class || "") + " " + String(c.initialClass || "")
    if (/portal/i.test(blob)) return true
    if (/polkit/i.test(blob)) return true
    if (/notif/i.test(blob)) return true
    if (/^(mako|dunst|swaync)$/i.test(String(c.class || ""))) return true
    return false
}

// Cardinality / size bounds applied to any profile before it is used to
// generate restore commands. A profile is command-launch input, so window
// and tab counts are capped even when it was authored or edited by hand.
export const MAX_WINDOWS = 512
export const MAX_TABS_PER_WINDOW = 300
export const MAX_PROFILES = 256
export const MAX_PROFILE_BYTES = 8 * 1024 * 1024

// Validate a parsed profile object's window/tab cardinality. Returns the
// profile unchanged, or null if it is malformed or exceeds the bounds.
export function enforceProfileCardinality(profile) {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) return null
    if (!Array.isArray(profile.windows)) return null
    if (profile.windows.length > MAX_WINDOWS) return null
    for (var i = 0; i < profile.windows.length; i++) {
        var w = profile.windows[i]
        if (!w || typeof w !== "object" || Array.isArray(w)) return null
        if (!Array.isArray(w.tabs)) continue
        if (w.tabs.length > MAX_TABS_PER_WINDOW) return null
    }
    return profile
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
// pages that we don't want to reopen, and collapsing repeats of the same URL
// within the snapshot) from a snapshot window's tabs array. Returns a string
// like "'url1' 'url2'", or "" if there are no usable tabs.
export function buildTabUrls(tabs) {
    if (!Array.isArray(tabs)) return ""
    var out = []
    var seen = {}
    for (var i = 0; i < tabs.length; i++) {
        var tab = tabs[i]
        if (!tab || typeof tab.url !== "string") continue
        var url = safeUrl(tab.url)
        if (url === null) continue
        var lower = url.toLowerCase()
        if (lower === "about:newtab" || lower === "about:blank" || lower === "") continue
        if (Object.prototype.hasOwnProperty.call(seen, url)) continue
        seen[url] = true
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
        // Order matters: the branded chromium forks all contain "chrom" in
        // their path, so they are checked before the generic chrome fallback.
        if (/brave/i.test(cmd)) return h + "/.config/BraveSoftware/Brave-Browser"
        if (/vivaldi/i.test(cmd)) return h + "/.config/vivaldi"
        if (/edge/i.test(cmd)) return h + "/.config/microsoft-edge"
        if (/opera/i.test(cmd)) return h + "/.config/opera"
        if (/chromium/i.test(cmd)) return h + "/.config/chromium"
        // Google Chrome ships at /opt/google/chrome/chrome (no dash, no
        // --user-data-dir), so match "chrome" anywhere in the command line.
        if (/chrome/i.test(cmd)) return h + "/.config/google-chrome"
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
        if (isInfrastructureWindow(c)) continue
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

        // Web-app windows share the browser PID, so the cached cmdline is the
        // browser binary with no --app. Rebuild the real launcher from class
        // and do not treat them as tab-restore browser windows.
        var webCmd = webAppLaunchCommand(c.class)
        var btype = webCmd ? null : browserTypeForClass(c.class)
        var bprofile = btype ? resolveBrowserProfile(btype, rawCmd, home) : null
        if (webCmd) cmd = webCmd

        windows.push({
            "class": c.class,
            "initialClass": c.initialClass || c.class,
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
        if (isWebAppClass(w.class)) continue
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
        if (isWebAppClass(w.class)) continue
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
export function buildRestoreScript(profile, existing, liveMonitors) {
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

    // Match running windows to profile windows in three passes, most confident
    // first, so multi-window same-class apps (two browser windows, three
    // terminals) are not shuffled between workspaces when their titles have
    // drifted since the snapshot. Each existing window and each profile window
    // is claimed at most once.
    if (existing && existing.length > 0) {
        var eUsed = []
        for (var eu = 0; eu < existing.length; eu++) eUsed[eu] = false

        // Bind existing window `e` to profile window index `pIdx`: moved into
        // place like any other matched window.
        //
        // A browser window is deliberately treated no differently here - an
        // *already-running* browser's tabs are left alone. Closing and
        // relaunching it with the captured tab list to force an exact match
        // was tried (and iterated on repeatedly: cmdline pollution, pinned
        // tabs, Chrome's own crash-restore, a close/relaunch race) and kept
        // finding new ways to duplicate tabs, because it depends on a
        // multi-process browser's shutdown and IPC-driven tab-adding
        // finishing in a way this script cannot fully observe or control.
        // Tabs are only ever launched explicitly in Phase 3, for a browser
        // window that is not currently running - the reboot / cold-start
        // case this plugin exists for, where there is nothing already open
        // to duplicate against.
        var claim = function (e, pIdx) {
            var target = profile.windows[pIdx]
            matched[pIdx] = true
            matchedAddrs.push(e.address)
            var eWs = e.workspace ? String(e.workspace.name) : ""
            var tws = safeWorkspace(target.workspace)
            if (tws !== null && eWs !== String(target.workspace)) {
                toMove.push({ addr: e.address, ws: tws, cls: e.class, fullscreen: target.fullscreen, e_floating: e.floating, e_fullscreen: e.fullscreen })
            }
            if (target.floating) {
                toFloat.push({ addr: e.address, pos: target.position, size: target.size, e_floating: e.floating, e_fullscreen: e.fullscreen })
            }
        }

        // Run `pick(e)` for every still-free existing window; a non-negative
        // return is the profile index to bind it to.
        var pass = function (pick) {
            for (var i = 0; i < existing.length; i++) {
                if (eUsed[i]) continue
                var idx = pick(existing[i])
                if (idx < 0) continue
                eUsed[i] = true
                claim(existing[i], idx)
            }
        }

        // 1. exact class + title - the confident match.
        pass(function (e) {
            for (var p = 0; p < profile.windows.length; p++) {
                if (!matched[p] && classesMatch(e, profile.windows[p]) && e.title === profile.windows[p].title) return p
            }
            return -1
        })

        // 2. same class, already on the workspace the profile wants it on.
        //    Disambiguates same-class windows whose titles no longer match.
        pass(function (e) {
            var ews = e.workspace ? String(e.workspace.name) : ""
            for (var p = 0; p < profile.windows.length; p++) {
                if (!matched[p] && classesMatch(e, profile.windows[p]) && ews === String(profile.windows[p].workspace)) return p
            }
            return -1
        })

        // 3. same class, first free slot - arbitrary order, last resort.
        pass(function (e) {
            for (var p = 0; p < profile.windows.length; p++) {
                if (!matched[p] && classesMatch(e, profile.windows[p])) return p
            }
            return -1
        })
    }

    // Phase 0: pin each snapshotted workspace to its capture-time monitor
    // before anything moves into it (Hyprland workspaces are global). A
    // saved output that is gone (undocked) is remapped to the focused /
    // remaining monitor so the pin does not target a name Hyprland lacks.
    var wsToMonitor = {}
    for (var wm = 0; wm < profile.windows.length; wm++) {
        var pws = safeWorkspace(profile.windows[wm].workspace)
        var pmon = resolveMonitorName(profile.windows[wm].monitor, liveMonitors)
        if (pws !== null && pmon) {
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


    // Phase 3: spawn missing windows onto their target workspace
    // (focus-then-launch). Chrome web apps are launched AFTER the main
    // browser: `--app=` as the process that *starts* Chrome dumps session
    // restore onto that workspace as a normal Chrome window.
    var spawnCount = 0
    var spawnTargets = []
    var spawnSpecs = []
    for (var j = 0; j < profile.windows.length; j++) {
        if (matched[j]) continue
        var w = profile.windows[j]
        var ws = safeWorkspace(w.workspace)
        var cls = safeClass(w.class)
        if (ws === null || cls === null) {
            lines.push('echo "[launch] skipped unsafe metadata" >> "$LOGFILE"')
            continue
        }
        var cmds
        var parsedWeb = parseWebAppClass(w.class)
        var isWebApp = parsedWeb !== null
        if (isWebApp && parsedWeb.kind === "url") {
            // Same launcher the desktop file uses. Do not exec the browser
            // binary with --app= — that starts a normal window, not an app.
            var webCmd = webAppLaunchCommand(w.class) || w.command
            var webLaunch = sanitizeLaunchCommand(webCmd)
            cmds = webLaunch.length > 0 ? [webLaunch] : []
        } else if (isWebApp && parsedWeb.kind === "appid") {
            var appBase = browserRelaunchBase(w.command, cls)
            cmds = appBase.length > 0
                ? [appBase + " " + shellArg("--app-id=" + parsedWeb.appId) + " " + shellArg("--profile-directory=" + parsedWeb.profile)]
                : []
        } else if (w.browser) {
            // Never trust bare positional args (i.e. URLs) from a browser's
            // captured cmdline as launch arguments - see browserRelaunchBase.
            var browserBase = browserRelaunchBase(w.command, cls)
            cmds = (w.tabs && w.tabs.length > 0)
                ? buildBrowserLaunchCommands(browserBase, cls, w.tabs)
                : (browserBase.length > 0 ? [browserBase] : [])
        } else {
            var cmd = sanitizeLaunchCommand(w.command, cls)
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
        var cwd = !w.browser ? sanitizeCwd(w.cwd) : null
        if (cwd) {
            // cwd alone is not enough: ghostty -e runs the binary without a
            // shell, so mise [env] (project API keys) never loads. Eval after
            // cd so the exec'd process inherits directory-scoped env.
            launchline = "cd " + shellArg(cwd) + " 2>/dev/null || true\n" +
                'command -v mise >/dev/null 2>&1 && eval "$(mise env -s bash 2>/dev/null)" || true\n' +
                launchline
        }
        spawnSpecs.push({
            j: j, w: w, ws: ws, cls: cls, launchline: launchline,
            isWebApp: isWebApp,
            floating: w.floating, fullscreen: w.fullscreen,
            pos: w.position, size: w.size,
        })
    }

    function jqClassMatchFilter(clsNorm) {
        var jqNorm = 'ascii_downcase | gsub("\\\\._[0-9a-f]{8,}$"; "") | gsub("\\\\.desktop$"; "")'
        return '.[] | select((( (.class // "") | ' + jqNorm + ' ) == "' + clsNorm + '") or (( (.initialClass // "") | ' + jqNorm + ' ) == "' + clsNorm + '"))'
    }

    function emitSpawn(spec) {
        var w = spec.w
        var cls = spec.cls
        if (w.browser && w.tabs && w.tabs.length > 0) {
            var clearLines = clearChromiumSessionSnapshotLines(w.browserProfile, cls)
            for (var c2 = 0; c2 < clearLines.length; c2++) lines.push(clearLines[c2])
        }
        lines.push('SPATH="$WSROOT/spawn-' + spec.j + '.sh"')
        lines.push("printf '#!/bin/bash\\n%s\\n' " + shellArg(spec.launchline) + ' > "$SPATH" && chmod 700 "$SPATH"')
        lines.push("hyprctl dispatch \"hl.dsp.focus({workspace='" + spec.ws + "'})\" 2>>\"$LOGFILE\" || true")
        lines.push("sleep 0.3")
        lines.push('setsid bash "$SPATH" >/dev/null 2>&1 &')
        lines.push('echo "[launch] ws=' + spec.ws + " cmd='$SPATH'\" >> \"$LOGFILE\"")

        spawnTargets.push({
            cls: spec.cls, ws: spec.ws, floating: spec.floating, fullscreen: spec.fullscreen,
            pos: spec.pos, size: spec.size
        })
        spawnCount++
    }

    // Web apps last so the browser process is up; omarchy-launch-webapp then
    // opens an --app= window on the already-running browser instead of
    // becoming the process that session-restores normal windows.
    var webAppSpecs = []
    for (var si = 0; si < spawnSpecs.length; si++) {
        if (spawnSpecs[si].isWebApp) webAppSpecs.push(spawnSpecs[si])
        else emitSpawn(spawnSpecs[si])
    }
    if (webAppSpecs.length > 0 && spawnCount > 0) {
        lines.push("sleep 0.8")
    }
    for (var wi = 0; wi < webAppSpecs.length; wi++) {
        emitSpawn(webAppSpecs[wi])
    }

    // Phase 3b: detached class-based safety re-check for apps that ignore the
    // focused workspace on launch (Electron, Chrome web apps). All targets are
    // polled in one loop so a class that never maps (e.g. a hashed telegram
    // app_id) cannot stall the YouTube/Chrome moves behind a 15s timeout.
    if (spawnCount > 0) {
        var safety = []
        safety.push("#!/bin/bash")
        safety.push('LOGFILE="$WSROOT/restore.log"')
        safety.push("trap 'rm -rf \"$WSROOT\"' EXIT")
        safety.push('MATCHED_ADDRS="' + matchedAddrs.join(" ") + '"')
        safety.push("sleep 1")
        safety.push('MOVED_ADDRS=""')
        for (var s0 = 0; s0 < spawnTargets.length; s0++) {
            safety.push("HANDLED" + s0 + "=0")
        }
        safety.push("ATTEMPT=0")
        safety.push("while [ $ATTEMPT -lt 30 ]; do")
        safety.push("  PENDING=0")
        for (var s = 0; s < spawnTargets.length; s++) {
            var t = spawnTargets[s]
            var clsNorm = normClass(t.cls)
            var jqFilter = jqClassMatchFilter(clsNorm) + " | [.address, .workspace.name] | @tsv"
            safety.push("  if [ $HANDLED" + s + " -eq 0 ]; then")
            safety.push("    PENDING=1")
            safety.push("    MATCHES=$(hyprctl clients -j | jq -r '" + jqFilter + "' 2>>\"$LOGFILE\")")
            safety.push('    echo "[move-spawn] attempt=$ATTEMPT cls=' + t.cls + " ws=" + t.ws + ' matches=$MATCHES" >> "$LOGFILE"')
            safety.push("    while IFS=$'\\t' read -r A W; do")
            safety.push('      [ -z "$A" ] && continue')
            safety.push('      if [[ " $MOVED_ADDRS " == *" $A "* ]] || [[ " $MATCHED_ADDRS " == *" $A "* ]]; then continue; fi')
            safety.push('      MOVED_ADDRS="$MOVED_ADDRS $A"')
            safety.push('      if [ "$W" != "' + t.ws + '" ]; then')
            safety.push("        hyprctl dispatch \"hl.dsp.window.move({workspace='" + t.ws + "', window='address:$A', follow=false})\" 2>>\"$LOGFILE\" || true")
            if (t.floating) {
                var sx = numOr(t.pos[0])
                var sy = numOr(t.pos[1])
                var sw = numOr(t.size[0])
                var sh = numOr(t.size[1])
                safety.push("        hyprctl dispatch \"hl.dsp.window.float({action='toggle', window='address:$A'})\" 2>>\"$LOGFILE\" || true")
                safety.push("        hyprctl dispatch \"hl.dsp.window.move({x=" + sx + ", y=" + sy + ", relative=false, window='address:$A'})\" 2>>\"$LOGFILE\" || true")
                safety.push("        hyprctl dispatch \"hl.dsp.window.resize({x=" + sw + ", y=" + sh + ", window='address:$A'})\" 2>>\"$LOGFILE\" || true")
            }
            if (t.fullscreen) {
                safety.push("        hyprctl dispatch \"hl.dsp.window.fullscreen({mode='fullscreen', window='address:$A'})\" 2>>\"$LOGFILE\" || true")
            }
            safety.push("      fi")
            safety.push("      HANDLED" + s + "=1")
            safety.push("      break")
            safety.push('    done <<< "$MATCHES"')
            safety.push("  fi")
        }
        safety.push("  if [ $PENDING -eq 0 ]; then break; fi")
        safety.push("  ATTEMPT=$((ATTEMPT+1))")
        safety.push("  sleep 0.5")
        safety.push("done")
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

// ---------------------------------------------------------------------------
// Login-trigger guards (pure). The `service` entry point pokes
// `session-restore restore --boot` on every shell start; these decide whether
// that start is actually a fresh login worth acting on.
// ---------------------------------------------------------------------------

// Seconds from `ps -o etimes= -p <pid>` output (leading/trailing space, digits).
// Returns a non-negative integer, or null if it cannot be read.
export function parseEtimes(s) {
    if (typeof s !== "string") return null
    var t = s.trim()
    if (!/^[0-9]+$/.test(t)) return null
    return parseInt(t, 10)
}

// A shell start counts as a login only if the compositor came up moments ago.
// A null age (cannot read it) is treated as a login rather than refusing to
// restore - mirrors how the compositor-age check degrades in practice.
export function isFreshLogin(ageSeconds, windowSeconds) {
    if (ageSeconds === null || ageSeconds === undefined) return true
    return ageSeconds <= windowSeconds
}

// The once-per-session stamp. Lives in $XDG_RUNTIME_DIR, and holds the current
// Hyprland instance signature. Keying it to the signature - not to the file
// merely existing - is what makes it survive a $XDG_RUNTIME_DIR that a
// logout/login did NOT clear (fast relogin, lingering session): a stale stamp
// from a previous Hyprland run carries the old signature and is simply
// overwritten, while a shell restart inside the same session finds a matching
// signature and stands down.
export function bootAppliedMarkerPath(runtimeDir) {
    return runtimeDir.replace(/\/$/, "") + "/session-restore/applied"
}

// Once-per-Hyprland-instance stamp so we only register exec-shutdown once,
// not on every mid-session `omarchy restart shell`.
export function shutdownHookMarkerPath(runtimeDir) {
    return runtimeDir.replace(/\/$/, "") + "/session-restore/shutdown-hook"
}

// True when the stamp was written by the Hyprland session identified by
// `sessionId` - i.e. this login has already been handled.
export function bootMarkerMatches(markerContent, sessionId) {
    if (!sessionId) return false
    if (typeof markerContent !== "string") return false
    return markerContent.trim() === String(sessionId).trim()
}

