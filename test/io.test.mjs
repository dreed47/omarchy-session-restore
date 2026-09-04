import { test } from "node:test"
import assert from "node:assert/strict"
import { bashExit, currentSessionId } from "../lib/io.mjs"

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
