import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
    mkdtempSync,
    writeFileSync,
    symlinkSync,
    lstatSync,
    truncateSync,
    rmSync,
    readFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
    bashExit,
    currentSessionId,
    ensureOwnedDir,
    readRegularBounded,
    atomicWriteFile,
    unlinkRegular,
    listProfileNames,
    loadProfile,
    saveProfile,
    deleteProfile,
    migrateLegacySettings,
    readSettings,
    writeSettings,
    SETTINGS_FILE,
    LEGACY_SETTINGS_FILE,
} from "../lib/io.mjs"
import { MAX_PROFILES } from "../restoreLogic.mjs"

function mkfifoSync(path) {
    const r = spawnSync("mkfifo", [path])
    assert.equal(r.status, 0, "mkfifo should succeed")
}

function tmpStore() {
    const dir = mkdtempSync(join(tmpdir(), "session-restore-test-"))
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const valid = { windows: [{ class: "org.gnome.Nautilus", workspace: "3" }] }

test("bashExit returns the script's exit code", async () => {
    assert.equal(await bashExit("exit 0"), 0)
    assert.equal(await bashExit("exit 7"), 7)
})

test("bashExit does not wait for backgrounded children", async () => {
    // The restore script backgrounds app launches; bashExit must resolve when
    // the foreground part finishes, not when a `sleep 30 &` (a stand-in for a
    // launched browser) exits.
    const start = Date.now()
    const code = await bashExit("sleep 30 & echo started; exit 0")
    assert.equal(code, 0)
    assert.ok(Date.now() - start < 5000, "resolved promptly despite the background sleep")
})

test("bashExit kills a runaway script on timeout", async () => {
    const start = Date.now()
    const code = await bashExit("sleep 30", { timeoutMs: 300 })
    assert.equal(code, 124)
    assert.ok(Date.now() - start < 3000)
})

test("currentSessionId uses HYPRLAND_INSTANCE_SIGNATURE when present", async () => {
    const saved = process.env.HYPRLAND_INSTANCE_SIGNATURE
    process.env.HYPRLAND_INSTANCE_SIGNATURE = "test_sig_123"
    try {
        assert.equal(await currentSessionId(), "test_sig_123")
    } finally {
        if (saved === undefined) delete process.env.HYPRLAND_INSTANCE_SIGNATURE
        else process.env.HYPRLAND_INSTANCE_SIGNATURE = saved
    }
})

// --- profile store ---

test("save, list, load, delete round trip", () => {
    const { dir, cleanup } = tmpStore()
    try {
        saveProfile(dir, "my-work", valid)
        assert.deepEqual(listProfileNames(dir), ["my-work"])
        assert.deepEqual(loadProfile(dir, "my-work"), valid)
        deleteProfile(dir, "my-work")
        assert.deepEqual(listProfileNames(dir), [])
    } finally {
        cleanup()
    }
})

test("list skips .settings.json and other unsanitized names", () => {
    const { dir, cleanup } = tmpStore()
    try {
        saveProfile(dir, "coding", valid)
        writeFileSync(join(dir, SETTINGS_FILE), JSON.stringify({ browserTabRestore: true }))
        writeFileSync(join(dir, ".hidden.json"), JSON.stringify(valid))
        assert.deepEqual(listProfileNames(dir), ["coding"])
    } finally {
        cleanup()
    }
})

test("legacy settings.json is not listed and migrates to .settings.json", () => {
    const { dir, cleanup } = tmpStore()
    try {
        writeFileSync(join(dir, LEGACY_SETTINGS_FILE), JSON.stringify({ browserTabRestore: true }))
        migrateLegacySettings(dir)
        assert.equal(readSettings(dir).browserTabRestore, true)
        assert.deepEqual(listProfileNames(dir), [])
        assert.equal(readFileSync(join(dir, SETTINGS_FILE), "utf8").includes("browserTabRestore"), true)
        assert.throws(() => lstatSync(join(dir, LEGACY_SETTINGS_FILE)), { code: "ENOENT" })
    } finally {
        cleanup()
    }
})

test("a real session named settings is not stolen as the toggle", () => {
    const { dir, cleanup } = tmpStore()
    try {
        saveProfile(dir, "settings", valid)
        migrateLegacySettings(dir)
        assert.deepEqual(listProfileNames(dir), ["settings"])
        assert.deepEqual(loadProfile(dir, "settings"), valid)
    } finally {
        cleanup()
    }
})

test("writeSettings does not create a listable session", () => {
    const { dir, cleanup } = tmpStore()
    try {
        writeSettings(dir, { browserTabRestore: true })
        assert.deepEqual(listProfileNames(dir), [])
        assert.equal(readSettings(dir).browserTabRestore, true)
    } finally {
        cleanup()
    }
})

test("save refuses to follow a planted symlink", () => {
    const { dir, cleanup } = tmpStore()
    try {
        ensureOwnedDir(dir)
        symlinkSync("/etc/passwd", join(dir, "evil.json"))
        assert.throws(() => saveProfile(dir, "evil", valid))
        assert.equal(lstatSync(join(dir, "evil.json")).isSymbolicLink(), true)
    } finally {
        cleanup()
    }
})

test("load and delete refuse a symlink", () => {
    const { dir, cleanup } = tmpStore()
    try {
        ensureOwnedDir(dir)
        symlinkSync("/etc/passwd", join(dir, "evil.json"))
        assert.throws(() => loadProfile(dir, "evil"))
        assert.throws(() => deleteProfile(dir, "evil"))
        assert.equal(lstatSync(join(dir, "evil.json")).isSymbolicLink(), true)
    } finally {
        cleanup()
    }
})

test("load does not block on a FIFO", () => {
    const { dir, cleanup } = tmpStore()
    try {
        ensureOwnedDir(dir)
        mkfifoSync(join(dir, "pipe.json"))
        assert.throws(() => loadProfile(dir, "pipe"))
    } finally {
        cleanup()
    }
})

test("load rejects an oversized profile file", () => {
    const { dir, cleanup } = tmpStore()
    try {
        saveProfile(dir, "big", valid)
        truncateSync(join(dir, "big.json"), 9 * 1024 * 1024)
        assert.throws(() => loadProfile(dir, "big"), /size bound/)
    } finally {
        cleanup()
    }
})

test("save rejects profiles that exceed cardinality bounds", () => {
    const { dir, cleanup } = tmpStore()
    try {
        assert.throws(() => saveProfile(dir, "many", { windows: Array.from({ length: 600 }, () => ({})) }))
        assert.throws(() => saveProfile(dir, "manytabs", { windows: [{ tabs: Array.from({ length: 400 }, () => ({})) }] }))
        assert.throws(() => saveProfile(dir, "arr", [1, 2, 3]))
        assert.throws(() => saveProfile(dir, "../escape", valid), /invalid profile name/)
    } finally {
        cleanup()
    }
})

test("save rejects beyond the profile cap, overwrite still allowed", () => {
    const { dir, cleanup } = tmpStore()
    try {
        for (let i = 0; i < MAX_PROFILES; i++) {
            saveProfile(dir, `p${String(i).padStart(3, "0")}`, valid)
        }
        assert.equal(listProfileNames(dir).length, MAX_PROFILES)
        assert.throws(() => saveProfile(dir, "overflow", valid), /too many profiles/)
        saveProfile(dir, "p000", valid)
    } finally {
        cleanup()
    }
})

test("ensureOwnedDir refuses a symlinked profile dir", () => {
    const { dir, cleanup } = tmpStore()
    try {
        const target = join(dir, "real")
        const link = join(dir, "link")
        ensureOwnedDir(target)
        symlinkSync(target, link)
        assert.throws(() => ensureOwnedDir(link), /symlink/)
    } finally {
        cleanup()
    }
})

test("atomicWriteFile then readRegularBounded round trip", () => {
    const { dir, cleanup } = tmpStore()
    try {
        const path = join(dir, "x.json")
        atomicWriteFile(path, "hello\n")
        assert.equal(readRegularBounded(path, 100).toString("utf8"), "hello\n")
        assert.throws(() => unlinkRegular(path + ".missing"), { code: "ENOENT" })
        unlinkRegular(path)
    } finally {
        cleanup()
    }
})
