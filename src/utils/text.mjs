export function ensureTrailingNewline(text) {
    return text.endsWith("\n") ? text : `${text}\n`;
}

export function stripHtmlTags(html) {
    return (html || "")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<\/section>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\r/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
}

export function splitParagraphs(text) {
    return stripHtmlTags(text)
        .split(/\n+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 12);
}

