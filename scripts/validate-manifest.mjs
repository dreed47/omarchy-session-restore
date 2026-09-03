// Mirrors the checks the Omarchy plugin registry enforces
// (shell/services/PluginRegistry.qml) so CI fails before a broken manifest
// ever reaches `omarchy plugin add`.
import { readFileSync, existsSync } from "node:fs"

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"))

const problems = []

if (manifest.schemaVersion !== 1) problems.push("schemaVersion must be the number 1")

for (const field of ["id", "name", "version", "kinds", "entryPoints"]) {
    if (!(field in manifest)) problems.push(`missing required field '${field}'`)
}

if (typeof manifest.id === "string") {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(manifest.id)) problems.push(`invalid id '${manifest.id}'`)
    if (manifest.id.startsWith("omarchy.")) problems.push(`id '${manifest.id}' uses the reserved omarchy.* namespace`)
}

if (!Array.isArray(manifest.kinds) || manifest.kinds.length === 0) {
    problems.push("'kinds' must be a non-empty array")
}

if (manifest.entryPoints && typeof manifest.entryPoints === "object") {
    for (const [kind, ep] of Object.entries(manifest.entryPoints)) {
        if (typeof ep !== "string" || ep.startsWith("/") || ep.includes("..")) {
            problems.push(`entry point for '${kind}' is not a safe relative path: ${ep}`)
        } else if (!existsSync(new URL("../" + ep, import.meta.url))) {
            problems.push(`entry point file for '${kind}' does not exist: ${ep}`)
        }
    }
} else {
    problems.push("'entryPoints' must be an object")
}

if (problems.length > 0) {
    console.error("manifest.json invalid:")
    for (const p of problems) console.error("  - " + p)
    process.exit(1)
}

console.log("manifest.json OK")
