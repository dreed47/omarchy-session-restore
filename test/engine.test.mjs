import { test } from "node:test"
import assert from "node:assert/strict"
import {
    resolveBrowserProfile,
    procInfoScript,
    parseProcInfo,
    assembleWindows,
    tabCaptureInvocations,
    parseTabResults,
    attachTabs,
    buildSnapshot,
    buildRestoreScript,
    wrapRestoreRunner,
    bootMarkerPath,
    parseEtimes,
    isFreshLogin,
    bootAppliedMarkerPath,
} from "../restoreLogic.mjs"

const HOME = "/home/user"
const DIR = "/home/user/.config/omarchy/session-restore"
// Same control-char separator the engine uses to key (browser, profile) pairs.
const SEP = "\u0001"

// --- resolveBrowserProfile ---

test("resolveBrowserProfile reads chromium --user-data-dir", () => {
    assert.equal(
        resolveBrowserProfile("chromium", "/usr/bin/brave --user-data-dir=/tmp/prof --type=x", HOME),
        "/tmp/prof"
    )
})

test("resolveBrowserProfile falls back to per-browser chromium defaults", () => {
    assert.equal(resolveBrowserProfile("chromium", "google-chrome-stable", HOME), HOME + "/.config/google-chrome")
    assert.equal(resolveBrowserProfile("chromium", "/opt/vivaldi/vivaldi-bin", HOME), HOME + "/.config/vivaldi")
    assert.equal(resolveBrowserProfile("chromium", "chromium --foo", HOME), HOME + "/.config/chromium")
})

test("resolveBrowserProfile recognises Google Chrome's real /opt path", () => {
    // /proc cmdline for a Linux Google Chrome window - no dash, no --user-data-dir
    assert.equal(resolveBrowserProfile("chromium", "/opt/google/chrome/chrome", HOME), HOME + "/.config/google-chrome")
    assert.equal(resolveBrowserProfile("chromium", "/opt/google/chrome/chrome --new-window", HOME), HOME + "/.config/google-chrome")
})

test("resolveBrowserProfile keeps branded forks off the chrome fallback", () => {
    assert.equal(resolveBrowserProfile("chromium", "/opt/brave.com/brave/brave", HOME), HOME + "/.config/BraveSoftware/Brave-Browser")
    assert.equal(resolveBrowserProfile("chromium", "/usr/lib/chromium/chromium", HOME), HOME + "/.config/chromium")
})

test("resolveBrowserProfile handles firefox -P and default base", () => {
    assert.equal(resolveBrowserProfile("firefox", "firefox --profile /tmp/ff", HOME), "/tmp/ff")
    assert.equal(resolveBrowserProfile("firefox", "firefox -P work", HOME), HOME + "/.mozilla/firefox/work")
    assert.equal(resolveBrowserProfile("firefox", "firefox", HOME), HOME + "/.mozilla/firefox")
})

test("resolveBrowserProfile returns null for non-browsers / unknown chromium", () => {
    assert.equal(resolveBrowserProfile(null, "kitty", HOME), null)
    assert.equal(resolveBrowserProfile("chromium", "some-unknown-thing", HOME), null)
})

// --- procInfoScript / parseProcInfo ---

test("procInfoScript embeds only numeric pids", () => {
    const s = procInfoScript([12, "34", "evil; rm -rf /", 56])
    assert.match(s, /pids="12 34 56"/)
    assert.doesNotMatch(s, /evil/)
})

test("parseProcInfo turns TSV into a pid-keyed map", () => {
    const text = "12\t/usr/bin/foo --bar\t/home/user\n34\tkitty\t/tmp\n\n"
    assert.deepEqual(parseProcInfo(text), {
        "12": { pid: "12", cmdline: "/usr/bin/foo --bar", cwd: "/home/user" },
        "34": { pid: "34", cmdline: "kitty", cwd: "/tmp" },
    })
})

test("parseProcInfo tolerates a missing cwd field", () => {
    assert.deepEqual(parseProcInfo("9\tfoo"), { "9": { pid: "9", cmdline: "foo", cwd: "" } })
})

// --- assembleWindows ---

const CLIENTS = [
    {
        class: "code", title: "Editor", pid: 100, address: "0xaa",
        workspace: { name: "2", id: 2 }, monitor: 0,
        at: [10, 20], size: [800, 600], splitratio: 1, floating: false, fullscreen: 0,
    },
    {
        class: "firefox", title: "Web", pid: 200, address: "0xbb",
        workspace: { name: "1", id: 1 }, monitor: 1,
        at: [0, 0], size: [1920, 1080], splitratio: 1, floating: true, fullscreen: 0,
    },
]
const MONITORS = [{ id: 0, name: "DP-1" }, { id: 1, name: "HDMI-A-1" }]
const PROC = {
    "100": { pid: "100", cmdline: "/usr/share/code/code --unity-launch", cwd: "/home/user/p" },
    "200": { pid: "200", cmdline: "/usr/lib/firefox/firefox", cwd: "/home/user" },
}

test("assembleWindows maps clients to profile windows", () => {
    const w = assembleWindows({ clients: CLIENTS, monitors: MONITORS, procInfo: PROC, home: HOME })
    assert.equal(w.length, 2)
    assert.equal(w[0].class, "code")
    assert.equal(w[0].monitor, "DP-1")
    assert.equal(w[0].workspace, "2")
    assert.equal(w[0].command, "/usr/share/code/code --unity-launch")
    assert.equal(w[0].cwd, "/home/user/p")
    assert.deepEqual(w[0].position, [10, 20])
    assert.equal(w[0].browser, null)
})

test("assembleWindows detects browsers and resolves their profile dir", () => {
    const w = assembleWindows({ clients: CLIENTS, monitors: MONITORS, procInfo: PROC, home: HOME })
    assert.equal(w[1].browser, "firefox")
    assert.equal(w[1].browserProfile, HOME + "/.mozilla/firefox")
    assert.equal(w[1].tabs, null)
    assert.equal(w[1].floating, true)
})

test("assembleWindows falls back to raw monitor id and null command", () => {
    const w = assembleWindows({
        clients: [{ class: "x", title: "", pid: 1, address: "0x1", workspace: { name: "1", id: 1 }, monitor: 9, at: [0, 0], size: [1, 1] }],
        monitors: MONITORS, procInfo: {}, home: HOME,
    })
    assert.equal(w[0].monitor, "9")
    assert.equal(w[0].command, null)
})

// --- tab capture routing ---

test("tabCaptureInvocations emits one shell-quoted call per unique profile", () => {
    const windows = [
        { browser: "firefox", browserProfile: "/p/ff" },
        { browser: "firefox", browserProfile: "/p/ff" },
        { browser: "chromium", browserProfile: "/p/cr" },
        { browser: null, browserProfile: null },
    ]
    const inv = tabCaptureInvocations(windows, "/plug/scripts/capture_tabs.py")
    assert.equal(inv.length, 2)
    assert.match(inv[0], /^python3 '\/plug\/scripts\/capture_tabs\.py' 'firefox' '\/p\/ff' '/)
    assert.match(inv[1], /'chromium' '\/p\/cr'/)
})

test("parseTabResults routes NDJSON by _profile and skips junk", () => {
    const text =
        '{"ok":true,"tabs":[{"url":"https://a"}],"_profile":"k1"}\n' +
        "not json\n" +
        '{"ok":false,"_profile":"k2"}\n'
    const r = parseTabResults(text)
    assert.equal(r.k1.ok, true)
    assert.equal(r.k2.ok, false)
    assert.equal(Object.keys(r).length, 2)
})

test("attachTabs puts tabs on the first window of each profile only", () => {
    const windows = [
        { browser: "firefox", browserProfile: "/p/ff", tabs: null },
        { browser: "firefox", browserProfile: "/p/ff", tabs: null },
        { browser: "chromium", browserProfile: "/p/cr", tabs: null },
    ]
    const key = windows[0].browser + SEP + windows[0].browserProfile
    const res = { [key]: { ok: true, tabs: [{ url: "https://a" }] } }
    attachTabs(windows, res)
    assert.deepEqual(windows[0].tabs, [{ url: "https://a" }])
    assert.equal(windows[1].tabs, null) // second window of same profile untouched
    assert.deepEqual(windows[2].tabs, []) // no result -> empty
})

// --- buildSnapshot ---

test("buildSnapshot returns { timestamp, windows, monitors }", () => {
    const snap = buildSnapshot({ clients: CLIENTS, monitors: MONITORS, procInfo: PROC, home: HOME, now: 123 })
    assert.equal(snap.timestamp, 123)
    assert.equal(snap.windows.length, 2)
    assert.equal(snap.monitors, MONITORS)
})

// --- buildRestoreScript ---

const PROFILE = {
    windows: [
        { class: "code", title: "Editor", workspace: "2", monitor: "DP-1", command: "code", position: [0, 0], size: [800, 600], floating: false, fullscreen: 0, browser: null, tabs: null },
        { class: "kitty", title: "term", workspace: "3", monitor: "DP-1", command: "kitty", position: [5, 5], size: [700, 500], floating: true, fullscreen: 0, browser: null, tabs: null },
    ],
}

test("buildRestoreScript returns a script string and a count", () => {
    const { script, count } = buildRestoreScript(PROFILE, [])
    assert.equal(typeof script, "string")
    assert.ok(script.startsWith("#!/bin/bash"))
    assert.equal(typeof count, "number")
})

test("buildRestoreScript pins workspaces to monitors before moving anything", () => {
    const { script } = buildRestoreScript(PROFILE, [])
    assert.match(script, /hl\.dsp\.workspace\.move\(\{workspace='2', monitor='DP-1'\}\)/)
    assert.match(script, /hl\.dsp\.workspace\.move\(\{workspace='3', monitor='DP-1'\}\)/)
})

test("buildRestoreScript spawns windows that are not already open", () => {
    const { script, count } = buildRestoreScript(PROFILE, [])
    assert.match(script, /hl\.dsp\.focus\(\{workspace='2'\}\)/)
    assert.match(script, /SPATH="\$WSROOT\/spawn-0\.sh"/)
    assert.match(script, /nohup bash "\$SAFETY"/) // safety pass present when spawning
    assert.equal(count, 2)
})

test("buildRestoreScript moves an already-open window instead of spawning it", () => {
    const existing = [
        { class: "code", title: "Editor", address: "0xdead", workspace: { name: "9" }, floating: false, fullscreen: 0 },
    ]
    const { script, count } = buildRestoreScript(PROFILE, existing)
    assert.match(script, /hl\.dsp\.window\.move\(\{workspace='2', window='address:0xdead', follow=false\}\)/)
    assert.doesNotMatch(script, /spawn-0\.sh/) // code no longer spawned
    assert.match(script, /spawn-1\.sh/)        // kitty still spawned
    assert.equal(count, 2)                      // 1 move + 1 spawn
})

test("buildRestoreScript: two same-class windows keep their own workspaces when titles have drifted", () => {
    // Regression: a browser window saved on ws1 was being moved to ws6 because
    // its title no longer matched and the class-only fallback assigned by array
    // order. Pass 2 (class + current-workspace agreement) fixes it.
    const profile = {
        windows: [
            { class: "google-chrome", title: "Home Assistant - Chrome", workspace: "6", monitor: "M2", command: "chrome", position: [0, 0], size: [1, 1], floating: false, fullscreen: 0, browser: "chromium", tabs: null },
            { class: "google-chrome", title: "IPTV Manager - Chrome", workspace: "1", monitor: "M1", command: "chrome", position: [0, 0], size: [1, 1], floating: false, fullscreen: 0, browser: "chromium", tabs: null },
        ],
    }
    // Both chrome windows are already back on their right workspaces, but their
    // titles have changed since the snapshot (fresh session).
    const existing = [
        { class: "google-chrome", title: "New Tab", address: "0xIPTV", workspace: { name: "1" }, floating: false, fullscreen: 0 },
        { class: "google-chrome", title: "New Tab", address: "0xHASS", workspace: { name: "6" }, floating: false, fullscreen: 0 },
    ]
    const { script } = buildRestoreScript(profile, existing)
    // No window is moved off the workspace it is already on.
    assert.doesNotMatch(script, /window\.move\(\{workspace=/)
    // And neither profile window is treated as missing (no spawn).
    assert.doesNotMatch(script, /spawn-\d+\.sh/)
})

test("buildRestoreScript: exact title match wins over array order", () => {
    const profile = {
        windows: [
            { class: "foot", title: "term-A", workspace: "2", monitor: "M1", command: "foot", position: [0, 0], size: [1, 1], floating: false, fullscreen: 0, browser: null, tabs: null },
            { class: "foot", title: "term-B", workspace: "3", monitor: "M1", command: "foot", position: [0, 0], size: [1, 1], floating: false, fullscreen: 0, browser: null, tabs: null },
        ],
    }
    // One running foot, title matches the *second* profile entry, and it is on
    // the wrong workspace - it must move to ws3, not ws2.
    const existing = [
        { class: "foot", title: "term-B", address: "0xB", workspace: { name: "9" }, floating: false, fullscreen: 0 },
    ]
    const { script } = buildRestoreScript(profile, existing)
    assert.match(script, /window\.move\(\{workspace='3', window='address:0xB'/)
    assert.doesNotMatch(script, /workspace='2', window='address:0xB'/)
    assert.match(script, /spawn-0\.sh/) // term-A (ws2) still needs spawning
})

test("buildRestoreScript skips windows with unsafe metadata", () => {
    const bad = { windows: [{ class: "a b; rm", title: "x", workspace: "1", monitor: "DP-1", command: "x", position: [0, 0], size: [1, 1], floating: false, fullscreen: 0 }] }
    const { script, count } = buildRestoreScript(bad, [])
    assert.match(script, /skipped unsafe metadata/)
    assert.equal(count, 0)
})

// --- wrapRestoreRunner / bootMarkerPath ---

test("wrapRestoreRunner creates a private temp dir and runs the script", () => {
    const cmd = wrapRestoreRunner("#!/bin/bash\necho hi")
    assert.match(cmd, /WSROOT=\$\(mktemp -d\)/)
    assert.match(cmd, /chmod 700 "\$WSROOT"/)
    assert.match(cmd, /> "\$WSROOT\/restore\.sh"/)
    assert.match(cmd, /bash "\$WSROOT\/restore\.sh"/)
})

test("bootMarkerPath is a dotfile inside the profile dir", () => {
    assert.equal(bootMarkerPath(DIR), DIR + "/.boot-profile")
})

// --- login guards ---

test("parseEtimes reads a plain seconds count", () => {
    assert.equal(parseEtimes("  42\n"), 42)
    assert.equal(parseEtimes("0"), 0)
})

test("parseEtimes returns null for anything non-numeric", () => {
    assert.equal(parseEtimes(""), null)
    assert.equal(parseEtimes("12:34"), null)   // ps etime (not etimes) format
    assert.equal(parseEtimes("  "), null)
    assert.equal(parseEtimes(null), null)
    assert.equal(parseEtimes(undefined), null)
})

test("isFreshLogin: young compositor is a login, old one is not", () => {
    assert.equal(isFreshLogin(10, 120), true)
    assert.equal(isFreshLogin(120, 120), true)
    assert.equal(isFreshLogin(121, 120), false)
    assert.equal(isFreshLogin(99999, 120), false)
})

test("isFreshLogin: unknown age is treated as a login", () => {
    assert.equal(isFreshLogin(null, 120), true)
    assert.equal(isFreshLogin(undefined, 120), true)
})

test("bootAppliedMarkerPath lives under the runtime dir", () => {
    assert.equal(bootAppliedMarkerPath("/run/user/1000"), "/run/user/1000/session-restore/applied")
    assert.equal(bootAppliedMarkerPath("/run/user/1000/"), "/run/user/1000/session-restore/applied")
})
