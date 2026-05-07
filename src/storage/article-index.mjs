import fs from "node:fs";
import path from "node:path";
import { INDEX_FILE_NAME } from "../config/constants.mjs";
import { ensureTrailingNewline } from "../utils/text.mjs";
import { ensureDir } from "./paths.mjs";

export function normalizeAuthorName(author, account, publishTime) {
    const candidate = String(author || "").trim();
    if (!candidate) return account || "";
    if (candidate === account) return candidate;
    if (candidate === publishTime) return account || candidate;
    if (/\d{4}\D+\d{1,2}\D+\d{1,2}/.test(candidate)) return account || candidate;
    return candidate;
}

export function normalizeIndexRecord(record) {
    return {
        ...record,
        author: normalizeAuthorName(record.author, record.account, record.publish_time),
    };
}

export function scoreIndexRecord(record) {
    let score = 0;
    if (record.author && record.author !== record.publish_time) score += 2;
    if (record.author && record.author === record.account) score += 1;
    if (Array.isArray(record.keywords) && record.keywords.length > 0) score += 1;
    if (record.analysis_file) score += 1;
    if (record.markdown_file) score += 1;
    return score;
}

export function normalizeIndexRecords(records) {
    const grouped = new Map();

    for (const rawRecord of records) {
        const record = normalizeIndexRecord(rawRecord);
        const key = record.source_url || record.article_id;
        const existing = grouped.get(key);
        if (!existing) {
            grouped.set(key, record);
            continue;
        }

        const currentScore = scoreIndexRecord(record);
        const existingScore = scoreIndexRecord(existing);
        if (currentScore > existingScore) {
            grouped.set(key, record);
            continue;
        }

        if (currentScore === existingScore) {
            const currentCapturedAt = String(record.captured_at || "");
            const existingCapturedAt = String(existing.captured_at || "");
            if (currentCapturedAt.localeCompare(existingCapturedAt) >= 0) {
                grouped.set(key, record);
            }
        }
    }

    return [...grouped.values()].sort((left, right) =>
        String(right.publish_time || "").localeCompare(String(left.publish_time || ""))
    );
}

export function readIndexRecords(indexPath) {
    if (!fs.existsSync(indexPath)) return [];
    return fs
        .readFileSync(indexPath, "utf-8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

export function loadArticleIndex(outputDir) {
    const indexPath = path.join(outputDir, INDEX_FILE_NAME);
    return normalizeIndexRecords(readIndexRecords(indexPath));
}

export function upsertIndexRecord(indexPath, record) {
    ensureDir(path.dirname(indexPath));
    const existing = readIndexRecords(indexPath);
    const filtered = existing.filter(
        (item) => item.article_id !== record.article_id && item.source_url !== record.source_url
    );
    filtered.push(record);

    const normalized = normalizeIndexRecords(filtered);
    const output = normalized.map((item) => JSON.stringify(item)).join("\n");
    const tmpPath = `${indexPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, ensureTrailingNewline(output), "utf-8");
    fs.renameSync(tmpPath, indexPath);
}

