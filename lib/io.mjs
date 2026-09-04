// Impure side of the engine: everything that talks to the system. Kept apart
// from restoreLogic.mjs so the builders there stay pure and unit-testable.

import { execFile } from "node:child_process"

// Run a command, capturing stdout/stderr. Never rejects on a non-zero exit;
// the caller inspects `code`. Rejects only if the binary cannot be spawned.
export function run(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const child = execFile(
            cmd,
            args,
            { maxBuffer: 64 * 1024 * 1024, encoding: "utf8", ...opts },
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

// Run `bash -c <program>` (login shell not needed) and return the exit code.
export async function bashExit(program) {
    const { code } = await run("bash", ["-c", program])
    return code
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
