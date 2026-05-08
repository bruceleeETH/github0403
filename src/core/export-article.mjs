import fs from "node:fs";
import path from "node:path";
import TurndownService from "turndown";
import { escapeHtml } from "../utils/sanitize.mjs";
import { ensureTrailingNewline } from "../utils/text.mjs";

const turndown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
});

turndown.keep(["table"]);

export function formatFrontmatterValue(value) {
    if (Array.isArray(value)) {
        return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
    }
    if (value === null || value === undefined) {
        return '""';
    }
    return JSON.stringify(String(value));
}

export function formatFrontmatter(meta) {
    const entries = [
        ["article_id", meta.articleId],
        ["title", meta.title],
        ["account", meta.account],
        ["author", meta.author],
        ["publish_time", meta.publishTime],
        ["captured_at", meta.savedAt],
        ["source", meta.source],
        ["content_hash", meta.contentHash],
        ["keywords", meta.keywords || []],
        ["sectors", meta.sectors || []],
        ["stocks", meta.stocks || []],
        ["sentiment", meta.sentiment || "neutral"],
        ["summary", meta.summary || ""],
    ];

    return `---\n${entries.map(([key, value]) => `${key}: ${formatFrontmatterValue(value)}`).join("\n")}\n---\n\n`;
}

function formatIndicatorNames(items) {
    if (!Array.isArray(items)) return "";
    return items
        .map((item) => {
            if (typeof item === "string") return item.trim();
            const name = String(item?.name || "").trim();
            const code = String(item?.code || "").trim();
            if (name && code) return `${name}(${code})`;
            return name || code;
        })
        .filter(Boolean)
        .join("、");
}

function formatMarketEmotion(analysis) {
    const emotion = analysis.market_emotion || {};
    const label = emotion.label || "";
    const intensity = emotion.intensity ? ` / 强度 ${emotion.intensity}` : "";
    const description = emotion.description ? ` / ${emotion.description}` : "";
    return `${label}${intensity}${description}`;
}

function getAnalysisModelLabel(analysis) {
    return [analysis.analysis_provider, analysis.analysis_model].filter(Boolean).join(" / ");
}

export function buildMarkdown(meta, contentHtml, analysis) {
    const frontmatter = formatFrontmatter({
        ...meta,
        keywords: analysis.keywords,
        sectors: formatIndicatorNames(analysis.sectors).split("、").filter(Boolean),
        stocks: formatIndicatorNames(analysis.stocks).split("、").filter(Boolean),
        sentiment: analysis.sentiment,
        summary: analysis.summary,
    });

    const markdownBody = turndown.turndown(contentHtml || "").trim();
    const viewpoints = Array.isArray(analysis.viewpoints) ? analysis.viewpoints : [];
    const viewpointLines = viewpoints.length
        ? viewpoints.map((item) => `- ${item.text || ""}${item.evidence ? `（依据：${item.evidence}）` : ""}`)
        : ["- 暂无观点片段"];
    const header = [
        `# ${meta.title || "微信公众号文章"}`,
        "",
        `- 公众号：${meta.account || ""}`,
        `- 作者：${meta.author || meta.account || ""}`,
        `- 发布时间：${meta.publishTime || ""}`,
        `- 原文链接：${meta.source || ""}`,
        "",
        "## 模型分析",
        "",
        getAnalysisModelLabel(analysis)
            ? `以下内容经过 ${getAnalysisModelLabel(analysis)} 模型分析。`
            : "该文章尚未完成模型分析。",
        "",
        `- 摘要：${analysis.summary || ""}`,
        `- 情绪：${analysis.sentiment || "neutral"}`,
        `- 市场情绪：${formatMarketEmotion(analysis) || "unknown"}`,
        `- 板块：${formatIndicatorNames(analysis.sectors) || "无"}`,
        `- 个股：${formatIndicatorNames(analysis.stocks) || "无"}`,
        `- 关键词：${(analysis.keywords || []).join("、")}`,
        "",
        "### 核心观点",
        "",
        ...viewpointLines,
        "",
        "## 正文",
        "",
    ].join("\n");

    return ensureTrailingNewline(`${frontmatter}${header}${markdownBody}\n`);
}

export function buildOfflineHtml(meta, contentHtml) {
    const title = escapeHtml(meta.title || "微信公众号文章");
    const account = escapeHtml(meta.account || "");
    const publishTime = escapeHtml(meta.publishTime || "");
    const source = escapeHtml(meta.source || "");

    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { max-width: 840px; margin: 0 auto; padding: 20px; line-height: 1.75; color: #222; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", Arial, sans-serif; }
    h1 { font-size: 28px; line-height: 1.4; margin: 8px 0 12px; }
    .meta { color: #666; font-size: 14px; margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 12px; }
    img { max-width: 100%; height: auto; }
    video { max-width: 100%; }
    pre { white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="meta">
    <div>公众号：${account}</div>
    <div>发布时间：${publishTime}</div>
    <div>原文链接：<a href="${source}">${source}</a></div>
  </div>
  <article>${contentHtml || ""}</article>
</body>
</html>`;
}

export function writeArticleFiles({ articleDir, meta, analysis, localContentHtml, rawHtml, fullHtml }) {
    const offlineHtml = buildOfflineHtml(meta, localContentHtml);
    const markdown = buildMarkdown(meta, localContentHtml, analysis);
    const files = {
        meta: path.join(articleDir, "meta.json"),
        articleContent: path.join(articleDir, "article_content.html"),
        offlineHtml: path.join(articleDir, "offline_article.html"),
        rawPage: path.join(articleDir, "raw_page.html"),
        markdown: path.join(articleDir, "article.md"),
        analysis: path.join(articleDir, "analysis.json"),
    };

    fs.writeFileSync(files.meta, JSON.stringify(meta, null, 2), "utf-8");
    fs.writeFileSync(files.articleContent, localContentHtml || "", "utf-8");
    fs.writeFileSync(files.offlineHtml, offlineHtml, "utf-8");
    fs.writeFileSync(files.rawPage, rawHtml || fullHtml || "", "utf-8");
    fs.writeFileSync(files.markdown, markdown, "utf-8");
    fs.writeFileSync(files.analysis, JSON.stringify(analysis, null, 2), "utf-8");

    return files;
}
