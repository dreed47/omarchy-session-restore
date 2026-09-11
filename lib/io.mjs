// Impure side of the engine: everything that talks to the system. Kept apart
// from restoreLogic.mjs so the builders there stay pure and unit-testable.

import { execFile, spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import {
    openSync,
    closeSync,
    readSync,
    writeSync,
    fsyncSync,
    fstatSync,
    lstatSync,
    mkdirSync,
    readdirSync,
    renameSync,
    unlinkSync,
    readFileSync,
    constants as fsConstants,
} from "node:fs"
import { basename, dirname, join } from "node:path"

import {
    sanitizeProfileName,
    validProfilePath,
    enforceProfileCardinality,
    MAX_PROFILE_BYTES,
    MAX_PROFILES,
} from "../restoreLogic.mjs"

const O_NOFOLLOW = fsConstants.O_NOFOLLOW || 0
const O_NONBLOCK = fsConstants.O_NONBLOCK || 0
const O_CLOEXEC = fsConstants.O_CLOEXEC || 0

export const SETTINGS_FILE = ".settings.json"
export const LEGACY_SETTINGS_FILE = "settings.json"
export const SETTINGS_MAX_BYTES = 64 * 1024

function uid() {
    return typeof process.getuid === "function" ? process.getuid() : null
}

function requireOwnedRegular(st, path) {
    if (!st.isFile()) throw new Error(`not a regular file: ${path}`)
    const u = uid()
    if (u !== null && st.uid !== u) throw new Error(`not owned by the user: ${path}`)
    return st
}

function requireOwnedDir(st, path) {
    if (st.isSymbolicLink()) throw new Error(`${path} is a symlink`)
    if (!st.isDirectory()) throw new Error(`${path} is not a directory`)
    const u = uid()
    if (u !== null && st.uid !== u) throw new Error(`${path} is not owned by the user`)
    return st
}

// Create `dir` if missing; refuse a symlink, a non-directory, or a dir owned
// by someone else. Login restore reads this path, so a planted symlink here
// is worse than in a click-to-restore widget.
export function ensureOwnedDir(dir) {
    try {
        requireOwnedDir(lstatSync(dir), dir)
        return dir
    } catch (e) {
        if (e.code !== "ENOENT") throw e
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    requireOwnedDir(lstatSync(dir), dir)
    return dir
}

// Read `path` without following a symlink, without blocking on a FIFO, and
// without exceeding `cap` bytes. The opened descriptor is fstat-checked to
// be a regular file owned by this user.
export function readRegularBounded(path, cap) {
    const flags = fsConstants.O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC
    const fd = openSync(path, flags)
    try {
        const st = requireOwnedRegular(fstatSync(fd), path)
        if (st.size > cap) throw new Error("file exceeds size bound")
        const chunks = []
        let total = 0
        const buf = Buffer.alloc(65536)
        for (;;) {
            let n
            try {
                n = readSync(fd, buf, 0, buf.length, null)
            } catch (e) {
                if (e.code === "EAGAIN" || e.code === "EWOULDBLOCK") {
                    throw new Error(`not a regular file: ${path}`)
                }
                throw e
            }
            if (n === 0) break
            total += n
            if (total > cap) throw new Error("file exceeds size bound")
            chunks.push(Buffer.from(buf.subarray(0, n)))
        }
        return Buffer.concat(chunks, total)
    } finally {
        closeSync(fd)
    }
}

// Write `data` via a same-directory exclusive temp file, then rename over
// `path`. Refuses to replace a symlink or a non-regular destination.
export function atomicWriteFile(path, data, { mode = 0o600 } = {}) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data))
    const dir = dirname(path)
    const tmp = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`)
    let fd
    try {
        fd = openSync(
            tmp,
            fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | O_NOFOLLOW | O_CLOEXEC,
            mode,
        )
        requireOwnedRegular(fstatSync(fd), tmp)
        let off = 0
        while (off < buf.length) {
            off += writeSync(fd, buf, off, buf.length - off)
        }
        fsyncSync(fd)
    } catch (e) {
        if (fd !== undefined) try { closeSync(fd) } catch { /* already closed */ }
        try { unlinkSync(tmp) } catch { /* best-effort */ }
        throw e
    }
    closeSync(fd)

    try {
        let destSt
        try {
            destSt = lstatSync(path)
        } catch (e) {
            if (e.code !== "ENOENT") throw e
            destSt = null
        }
        if (destSt) {
            if (destSt.isSymbolicLink()) throw new Error(`refusing to overwrite a symlink: ${path}`)
            if (!destSt.isFile()) throw new Error(`refusing to overwrite a non-regular file: ${path}`)
        }
        renameSync(tmp, path)
    } catch (e) {
        try { unlinkSync(tmp) } catch { /* best-effort */ }
        throw e
    }
}

export function unlinkRegular(path) {
    const st = lstatSync(path)
    if (st.isSymbolicLink()) throw new Error(`refusing to delete a symlink: ${path}`)
    if (st.isDirectory()) throw new Error(`refusing to delete a directory: ${path}`)
    if (!st.isFile()) throw new Error(`refusing to delete a non-regular file: ${path}`)
    const u = uid()
    if (u !== null && st.uid !== u) throw new Error(`refusing to delete a file not owned by the user: ${path}`)
    unlinkSync(path)
}

// At most MAX_PROFILES names. Skips symlinks, non-regular files, and anything
// that fails sanitizeProfileName (dotfiles including .settings.json).
export function listProfileNames(dir) {
    let entries
    try {
        requireOwnedDir(lstatSync(dir), dir)
        entries = readdirSync(dir, { withFileTypes: true })
    } catch (e) {
        if (e.code === "ENOENT") return []
        throw e
    }
    const out = []
    for (const ent of entries) {
        if (out.length >= MAX_PROFILES) break
        if (!ent.name.endsWith(".json")) continue
        const base = ent.name.slice(0, -5)
        if (sanitizeProfileName(base) !== base) continue
        if (ent.isSymbolicLink() || !ent.isFile()) continue
        out.push(base)
    }
    out.sort()
    return out
}

export function loadProfile(dir, name) {
    const path = validProfilePath(name, dir)
    if (path === null) throw new Error(`invalid profile name: ${name}`)
    requireOwnedDir(lstatSync(dir), dir)
    const raw = readRegularBounded(path, MAX_PROFILE_BYTES)
    let obj
    try {
        obj = JSON.parse(raw.toString("utf8"))
    } catch {
        throw new Error(`profile is not valid JSON: ${name}`)
    }
    if (enforceProfileCardinality(obj) === null) {
        throw new Error(`profile is malformed or exceeds bounds: ${name}`)
    }
    return obj
}

export function saveProfile(dir, name, obj) {
    ensureOwnedDir(dir)
    const path = validProfilePath(name, dir)
    if (path === null) throw new Error(`invalid profile name: ${name}`)
    if (enforceProfileCardinality(obj) === null) {
        throw new Error("profile is malformed or exceeds bounds")
    }
    const existing = listProfileNames(dir)
    if (!existing.includes(name) && existing.length >= MAX_PROFILES) {
        throw new Error(`too many profiles (limit ${MAX_PROFILES})`)
    }
    const payload = JSON.stringify(obj, null, 2) + "\n"
    if (Buffer.byteLength(payload) > MAX_PROFILE_BYTES) {
        throw new Error("profile too large")
    }
    atomicWriteFile(path, payload)
}

export function deleteProfile(dir, name) {
    const path = validProfilePath(name, dir)
    if (path === null) throw new Error(`invalid profile name: ${name}`)
    requireOwnedDir(lstatSync(dir), dir)
    unlinkRegular(path)
}

// Tab-restore used to write settings.json in the profile dir, which list
// treated as a session named "settings". Settings now live in .settings.json
// (rejected by sanitizeProfileName). A leftover settings.json that is the
// toggle (no windows array) is moved; a real session named "settings" is left.
export function migrateLegacySettings(dir) {
    const dest = join(dir, SETTINGS_FILE)
    const legacy = join(dir, LEGACY_SETTINGS_FILE)

    let destExists = false
    try {
        destExists = lstatSync(dest).isFile()
    } catch (e) {
        if (e.code !== "ENOENT") throw e
    }

    let legacyObj = null
    try {
        const raw = readRegularBounded(legacy, SETTINGS_MAX_BYTES)
        const obj = JSON.parse(raw.toString("utf8"))
        if (obj && typeof obj === "object" && !Array.isArray(obj) && !Array.isArray(obj.windows)) {
            legacyObj = obj
        }
    } catch {
        return
    }
    if (!legacyObj) return
    if (!destExists) {
        atomicWriteFile(dest, JSON.stringify(legacyObj, null, 2) + "\n")
    }
    unlinkRegular(legacy)
}

export function readSettings(dir) {
    try {
        requireOwnedDir(lstatSync(dir), dir)
    } catch (e) {
        if (e.code === "ENOENT") return {}
        throw e
    }
    migrateLegacySettings(dir)
    try {
        const s = JSON.parse(readRegularBounded(join(dir, SETTINGS_FILE), SETTINGS_MAX_BYTES).toString("utf8"))
        return (s && typeof s === "object" && !Array.isArray(s)) ? s : {}
    } catch {
        return {}
    }
}

export function writeSettings(dir, settings) {
    ensureOwnedDir(dir)
    migrateLegacySettings(dir)
    atomicWriteFile(join(dir, SETTINGS_FILE), JSON.stringify(settings, null, 2) + "\n")
}

// Run a command, capturing stdout/stderr. Never rejects on a non-zero exit;
// the caller inspects `code`. Rejects only if the binary cannot be spawned.
// A default timeout keeps a wedged hyprctl/bash from parking a login forever.
export function run(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const child = execFile(
            cmd,
            args,
            { maxBuffer: 64 * 1024 * 1024, encoding: "utf8", timeout: 30000, killSignal: "SIGKILL", ...opts },
            (err, stdout, stderr) => {
                if (err && err.code === "ENOENT") {
                    reject(new Error(`${cmd}: command not found`))
                    return
                }
                resolve({
                    code: err && typeof err.code === "number" ? err.code : err ? 1 : 0,
                    stdout: stdout || "",
                    stderr: stderr || "",
                })
            }
        )
        if (opts.input != null) {
            child.stdin.end(opts.input)
        }
    })
}

// `hyprctl -j <what>` parsed as JSON. Throws on a hyprctl failure or unparseable
// output so a bad capture never silently produces an empty profile.
export async function hyprctlJson(what) {
    const { code, stdout, stderr } = await run("hyprctl", ["-j", what])
    if (code !== 0) {
        throw new Error(`hyprctl -j ${what} failed (exit ${code}): ${stderr.trim()}`)
    }
    try {
        return JSON.parse(stdout)
    } catch {
        throw new Error(`hyprctl -j ${what} returned unparseable JSON`)
    }
}

// Run an arbitrary bash program and return its stdout (best-effort: a non-zero
// exit still resolves with whatever was captured).
export async function bash(program) {
    const { stdout } = await run("bash", ["-lc", program])
    return stdout
}

// Run `bash -c <program>` and return its exit code.
//
// Uses spawn with stdio "ignore", not execFile: the restore script launches
// apps in the background (`... &`), and if they inherited our stdout/stderr
// pipes, execFile's callback would not fire until every one of those apps
// exited - which for a browser is "never". With stdio ignored, "exit" fires
// when the foreground part of the script finishes. `detached` puts the script
// in its own process group so a timeout can kill the whole thing.
export function bashExit(program, { timeoutMs = 120000 } = {}) {
    return new Promise((resolve) => {
        let child
        try {
            child = spawn("bash", ["-c", program], { stdio: "ignore", detached: true })
        } catch {
            resolve(127)
            return
        }
        let settled = false
        const finish = (code) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve(code)
        }
        const timer = setTimeout(() => {
            try { process.kill(-child.pid, "SIGKILL") } catch { /* already gone */ }
            finish(124)
        }, timeoutMs)
        child.on("error", () => finish(127))
        child.on("exit", (code, signal) => finish(code == null ? (signal ? 143 : 1) : code))
    })
}

// Best-effort desktop notification. Silently does nothing if notify-send is
// missing (e.g. during a very early login).
export async function notify(summary, body = "") {
    try {
        await run("notify-send", [
            "-a", "Session Restore",
            "-i", "preferences-desktop-workspaces",
            summary,
            body,
        ])
    } catch {
        /* no notify-send - not fatal */
    }
}

// Is `node`'s companion `python3` available? Used for a friendly preflight.
export async function hasCommand(cmd) {
    try {
        const { code } = await run("sh", ["-c", `command -v ${cmd}`])
        return code === 0
    } catch {
        return false
    }
}

// A stable id for the current Hyprland session. HYPRLAND_INSTANCE_SIGNATURE is
// unique per Hyprland run (it embeds a timestamp) and is inherited by every
// child, so the shell - and this CLI, launched from it - both see it. Falls
// back to the kernel boot id plus the Hyprland pid when it is somehow absent.
export async function currentSessionId() {
    const sig = process.env.HYPRLAND_INSTANCE_SIGNATURE
    if (sig) return sig
    try {
        const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()
        const p = await run("pgrep", ["-x", "Hyprland"])
        const pid = (p.stdout || "").split("\n")[0].trim()
        if (bootId && /^[0-9]+$/.test(pid)) return `${bootId}:${pid}`
        if (bootId) return bootId
    } catch { /* fall through */ }
    return null
}

// Seconds since the Hyprland process started, or null if it cannot be read.
// Used by `restore --boot` to tell a fresh login from a mid-session shell
// restart.
export async function compositorAgeSeconds() {
    try {
        const p = await run("pgrep", ["-x", "Hyprland"])
        const pid = (p.stdout || "").split("\n")[0].trim()
        if (!/^[0-9]+$/.test(pid)) return null
        const ps = await run("ps", ["-o", "etimes=", "-p", pid])
        const t = (ps.stdout || "").trim()
        return /^[0-9]+$/.test(t) ? parseInt(t, 10) : null
    } catch {
        return null
    }
}
