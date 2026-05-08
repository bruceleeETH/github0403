import fs from "node:fs";
import path from "node:path";
import { ensureTrailingNewline } from "../utils/text.mjs";

export const PERSONAL_NOTE_FILE_NAME = "personal_note.md";
export const PERSONAL_NOTE_MAX_BYTES = 512 * 1024;

function formatYamlValue(value) {
    if (Array.isArray(value)) {
        return `[${value.map((item) => JSON.stringify(String(item))).join(", ")}]`;
    }
    if (value === null || value === undefined) {
        return '""';
    }
    return JSON.stringify(String(value));
}

function todayInShanghai(date = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(date);
}

function normalizeMeta(meta = {}) {
    return {
        articleId: meta.articleId || meta.article_id || "",
        title: meta.title || "",
        account: meta.account || "",
        author: meta.author || meta.account || "",
        publishTime: meta.publishTime || meta.publish_time || "",
        source: meta.source || meta.source_url || "",
    };
}

export function buildPersonalNoteTemplate(meta, options = {}) {
    const normalized = normalizeMeta(meta);
    const noteDate = options.date || todayInShanghai(options.now || new Date());
    const frontmatter = [
        ["schema", "personal_note/v1"],
        ["article_id", normalized.articleId],
        ["title", normalized.title],
        ["account", normalized.account],
        ["author", normalized.author],
        ["publish_time", normalized.publishTime],
        ["source", normalized.source],
        ["created_at", noteDate],
        ["updated_at", noteDate],
        ["stance", ""],
        ["confidence", ""],
        ["tags", []],
        ["related_stocks", []],
        ["related_sectors", []],
        ["review_on", ""],
    ];

    return ensureTrailingNewline([
        "---",
        ...frontmatter.map(([key, value]) => `${key}: ${formatYamlValue(value)}`),
        "---",
        "",
        "# 我的理解",
        "",
        "## 一句话结论",
        "",
        "",
        "## 原文核心主张",
        "",
        "- ",
        "",
        "## 我的理解",
        "",
        "",
        "## 我赞同的地方",
        "",
        "- ",
        "",
        "## 我保留意见的地方",
        "",
        "- ",
        "",
        "## 可验证假设",
        "",
        "- 假设：",
        "  - 观察指标：",
        "  - 验证时间：",
        "  - 可能证伪信号：",
        "",
        "## 后续行动",
        "",
        "- [ ] ",
        "",
        "## 复盘记录",
        "",
    ].join("\n"));
}

export function resolvePersonalNotePath(articleDir) {
    return path.join(articleDir, PERSONAL_NOTE_FILE_NAME);
}

export function readPersonalNote(articleDir, meta, options = {}) {
    const notePath = resolvePersonalNotePath(articleDir);
    if (!fs.existsSync(notePath)) {
        return {
            exists: false,
            content: buildPersonalNoteTemplate(meta, options),
            updated_at: "",
            note_file: PERSONAL_NOTE_FILE_NAME,
        };
    }

    const stat = fs.statSync(notePath);
    return {
        exists: true,
        content: fs.readFileSync(notePath, "utf-8"),
        updated_at: stat.mtime.toISOString(),
        note_file: PERSONAL_NOTE_FILE_NAME,
    };
}

export function writePersonalNote(articleDir, content) {
    if (typeof content !== "string") {
        throw new Error("笔记内容必须是字符串");
    }
    if (Buffer.byteLength(content, "utf-8") > PERSONAL_NOTE_MAX_BYTES) {
        throw new Error("笔记内容过大");
    }

    const notePath = resolvePersonalNotePath(articleDir);
    const savedContent = ensureTrailingNewline(content);
    fs.writeFileSync(notePath, savedContent, "utf-8");
    const stat = fs.statSync(notePath);

    return {
        exists: true,
        content: savedContent,
        updated_at: stat.mtime.toISOString(),
        note_file: PERSONAL_NOTE_FILE_NAME,
    };
}
