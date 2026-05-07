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

export function buildIndexRecord(baseOutputDir, articleDir, meta, analysis) {
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
        keywords: analysis.keywords,
        sentiment: analysis.sentiment,
    };
}

