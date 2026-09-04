// Impure side of the engine: everything that talks to the system. Kept apart
// from restoreLogic.mjs so the builders there stay pure and unit-testable.

import { execFile, spawn } from "node:child_process"

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
import { readFileSync } from "node:fs"
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
