export function sanitizeName(name) {
    return (name || "untitled")
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180);
}

export function slugify(value) {
    return sanitizeName(value)
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9\-\u4e00-\u9fff]/g, "")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80) || "untitled";
}

export function escapeHtml(text) {
    return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

