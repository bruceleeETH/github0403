import crypto from "node:crypto";
import path from "node:path";
import { normalizeDateForId } from "../utils/date.mjs";
import { sanitizeName, slugify } from "../utils/sanitize.mjs";

export function buildArticleId(meta, contentHtml) {
    const datePart = normalizeDateForId(meta.publishTime).replace(/-/g, "");
    const accountPart = slugify(meta.account || meta.author || "wechat");
    const hash = crypto.createHash("sha1").update(contentHtml || meta.source).digest("hex").slice(0, 8);
    return `${datePart}_${accountPart}_${hash}`;
}

export function resolveArticleDir(baseOutputDir, meta) {
    const datePart = normalizeDateForId(meta.publishTime);
    const safeTitle = sanitizeName(meta.title);
    const safeAccount = sanitizeName(meta.account || meta.author || "wechat");
    return path.join(baseOutputDir, safeAccount, `${datePart}_${safeTitle || meta.articleId}`);
}

function buildIndexLabels(items, limit = 12) {
    if (!Array.isArray(items)) return [];
    return items
        .map((item) => {
            if (typeof item === "string") return item.trim();
            const name = String(item?.name || "").trim();
            const code = String(item?.code || "").trim();
            if (name && code) return `${name}(${code})`;
            return name || code;
        })
        .filter(Boolean)
        .slice(0, limit);
}

function isModelAnalysisRecord(analysis) {
    return Boolean(
        analysis?.analysis_provider &&
        analysis?.analysis_model &&
        analysis.analysis_provider !== "rule" &&
        analysis.analysis_status !== "failed"
    );
}

export function buildIndexRecord(baseOutputDir, articleDir, meta, analysis) {
    const hasModelAnalysis = isModelAnalysisRecord(analysis);
    return {
        article_id: meta.articleId,
        title: meta.title,
        author: meta.author,
        account: meta.account,
        publish_time: meta.publishTime,
        source_url: meta.source,
        article_dir: path.relative(baseOutputDir, articleDir),
        markdown_file: path.relative(baseOutputDir, path.join(articleDir, "article.md")),
        offline_html_file: path.relative(baseOutputDir, path.join(articleDir, "offline_article.html")),
        analysis_file: path.relative(baseOutputDir, path.join(articleDir, "analysis.json")),
        content_hash: meta.contentHash,
        captured_at: meta.savedAt,
        keywords: hasModelAnalysis ? analysis.keywords : [],
        sentiment: hasModelAnalysis ? analysis.sentiment : "",
        sectors: hasModelAnalysis ? buildIndexLabels(analysis.sectors, 8) : [],
        stocks: hasModelAnalysis ? buildIndexLabels(analysis.stocks, 12) : [],
        analysis_provider: hasModelAnalysis ? analysis.analysis_provider : "",
        analysis_model: hasModelAnalysis ? analysis.analysis_model : "",
        analysis_schema_version: analysis.analysis_schema_version || 1,
    };
}
