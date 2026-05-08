import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "./constants.mjs";

let loaded = false;

function unquote(value) {
    const trimmed = String(value || "").trim();
    if (
        (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

export function loadLocalEnv() {
    if (loaded) return;
    loaded = true;

    for (const filename of [".env", ".env.local"]) {
        const envPath = path.join(PROJECT_ROOT, filename);
        if (!fs.existsSync(envPath)) continue;

        const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;

            const eqIndex = trimmed.indexOf("=");
            if (eqIndex <= 0) continue;

            const key = trimmed.slice(0, eqIndex).trim();
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
            if (process.env[key] !== undefined) continue;

            process.env[key] = unquote(trimmed.slice(eqIndex + 1));
        }
    }
}
