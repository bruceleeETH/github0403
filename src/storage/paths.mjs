import fs from "node:fs";
import path from "node:path";

export function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

export function safeJoin(baseDir, targetPath) {
    const base = path.resolve(baseDir);
    const resolved = path.resolve(base, targetPath);
    const relative = path.relative(base, resolved);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
        return resolved;
    }
    throw new Error("非法路径");
}

export function encodeLibraryPath(relPath) {
    return relPath.split("/").map(encodeURIComponent).join("/");
}

