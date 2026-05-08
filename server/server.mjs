#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { DEFAULT_OUTPUT_DIR, INDEX_FILE_NAME } from "../src/config/constants.mjs";
import { analyzeArticle, isModelAnalysis, sanitizeModelAnalysis } from "../src/core/analyze-article.mjs";
import { captureArticleToLocal } from "../src/core/capture-article.mjs";
import { buildMarkdown } from "../src/core/export-article.mjs";
import { listAccountArticles } from "../src/core/list-account-articles.mjs";
import { readPersonalNote, writePersonalNote } from "../src/core/personal-note.mjs";
import { cleanAuthorName, loadArticleIndex, upsertIndexRecord } from "../src/storage/article-index.mjs";
import { buildIndexRecord } from "../src/storage/file-layout.mjs";
import { encodeLibraryPath, safeJoin } from "../src/storage/paths.mjs";
import { isWeChatArticleUrl } from "../src/utils/url.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const WEB_ROOT = path.join(PROJECT_ROOT, "webapp");
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4318);

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk;
            if (body.length > 1024 * 1024) {
                reject(new Error("请求体过大"));
            }
        });
        req.on("end", () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch {
                reject(new Error("无效的 JSON 请求体"));
            }
        });
        req.on("error", reject);
    });
}

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, statusCode, payload, contentType = "text/plain; charset=utf-8") {
    res.writeHead(statusCode, { "Content-Type": contentType });
    res.end(payload);
}

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case ".html": return "text/html; charset=utf-8";
        case ".js":
        case ".mjs": return "application/javascript; charset=utf-8";
        case ".css": return "text/css; charset=utf-8";
        case ".json": return "application/json; charset=utf-8";
        case ".md": return "text/markdown; charset=utf-8";
        case ".png": return "image/png";
        case ".jpg":
        case ".jpeg": return "image/jpeg";
        case ".webp": return "image/webp";
        case ".gif": return "image/gif";
        case ".svg": return "image/svg+xml";
        default: return "application/octet-stream";
    }
}

function loadIndex() {
    return loadArticleIndex(DEFAULT_OUTPUT_DIR).map((record) => {
        if (isModelAnalysis(record)) return record;
        return {
            ...record,
            keywords: [],
            sectors: [],
            stocks: [],
            sentiment: "",
            analysis_provider: "",
            analysis_model: "",
        };
    });
}

function loadArticleDetail(articleId) {
    const record = loadIndex().find((item) => item.article_id === articleId);
    if (!record) return null;

    const articleDir = safeJoin(DEFAULT_OUTPUT_DIR, record.article_dir);
    const meta = JSON.parse(fs.readFileSync(path.join(articleDir, "meta.json"), "utf-8"));
    const rawAnalysis = JSON.parse(fs.readFileSync(path.join(articleDir, "analysis.json"), "utf-8"));
    const analysis = sanitizeModelAnalysis(meta, rawAnalysis);
    const markdown = fs.readFileSync(path.join(articleDir, "article.md"), "utf-8");

    const encodedDir = encodeLibraryPath(record.article_dir);
    const imgDir = path.join(articleDir, "images");
    const imageUrls = fs.existsSync(imgDir)
        ? fs.readdirSync(imgDir)
            .filter((f) => /\.(webp|jpg|jpeg|png|gif|svg)$/i.test(f))
            .sort()
            .map((f) => `/library/${encodedDir}/images/${encodeURIComponent(f)}`)
        : [];

    return {
        ...record,
        meta,
        analysis,
        markdown,
        offline_html_url: `/library/${encodedDir}/offline_article.html`,
        image_urls: imageUrls,
    };
}

function loadArticleMetaForRecord(record, articleDir) {
    const metaPath = path.join(articleDir, "meta.json");
    if (fs.existsSync(metaPath)) {
        return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    }
    return {
        articleId: record.article_id,
        title: record.title,
        account: record.account,
        author: record.author,
        publishTime: record.publish_time,
        source: record.source_url,
    };
}

function getArticleNoteContext(articleId) {
    const record = loadIndex().find((item) => item.article_id === articleId);
    if (!record) return null;

    const articleDir = safeJoin(DEFAULT_OUTPUT_DIR, record.article_dir);
    return {
        articleDir,
        meta: loadArticleMetaForRecord(record, articleDir),
    };
}

function buildAuthorSummary(records) {
    const grouped = new Map();
    for (const record of records) {
        const key = cleanAuthorName(record.author, record.account, record.publish_time) || "未知作者";
        if (!grouped.has(key)) {
            grouped.set(key, {
                author: key,
                article_count: 0,
                latest_publish_time: "",
                keywords: new Map(),
                sectors: new Map(),
                stocks: new Map(),
                sentiments: { positive: 0, neutral: 0, negative: 0 },
            });
        }

        const summary = grouped.get(key);
        summary.article_count += 1;
        if (!summary.latest_publish_time || String(record.publish_time).localeCompare(summary.latest_publish_time) > 0) {
            summary.latest_publish_time = record.publish_time;
        }
        if (isModelAnalysis(record)) {
            for (const keyword of record.keywords || []) {
                summary.keywords.set(keyword, (summary.keywords.get(keyword) || 0) + 1);
            }
            for (const sector of record.sectors || []) {
                summary.sectors.set(sector, (summary.sectors.get(sector) || 0) + 1);
            }
            for (const stock of record.stocks || []) {
                summary.stocks.set(stock, (summary.stocks.get(stock) || 0) + 1);
            }
            summary.sentiments[record.sentiment || "neutral"] += 1;
        }
    }

    return [...grouped.values()]
        .map((item) => ({
            author: item.author,
            article_count: item.article_count,
            latest_publish_time: item.latest_publish_time,
            top_keywords: [...item.keywords.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([keyword]) => keyword),
            top_sectors: [...item.sectors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([sector]) => sector),
            top_stocks: [...item.stocks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([stock]) => stock),
            sentiments: item.sentiments,
        }))
        .sort((a, b) => String(b.latest_publish_time).localeCompare(String(a.latest_publish_time)));
}

function buildShareableHtml(articleId) {
    const record = loadIndex().find((item) => item.article_id === articleId);
    if (!record) return null;

    const articleDir = safeJoin(DEFAULT_OUTPUT_DIR, record.article_dir);
    const offlinePath = path.join(articleDir, "offline_article.html");
    if (!fs.existsSync(offlinePath)) return null;

    let html = fs.readFileSync(offlinePath, "utf-8");
    html = html.replace(/src="images\/([^"]+)"/g, (_match, filename) => {
        const imgPath = path.join(articleDir, "images", filename);
        if (!fs.existsSync(imgPath)) return _match;
        const ext = path.extname(filename).toLowerCase().replace(".", "");
        const mimeMap = { webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml" };
        const mime = mimeMap[ext] || "application/octet-stream";
        const base64 = fs.readFileSync(imgPath).toString("base64");
        return `src="data:${mime};base64,${base64}"`;
    });

    return { html, title: record.title || "article" };
}

async function analyzeStoredArticle(articleId) {
    const record = loadArticleIndex(DEFAULT_OUTPUT_DIR).find((item) => item.article_id === articleId);
    if (!record) {
        return { statusCode: 404, payload: { error: "文章不存在" } };
    }

    const articleDir = safeJoin(DEFAULT_OUTPUT_DIR, record.article_dir);
    const metaPath = path.join(articleDir, "meta.json");
    const contentPath = path.join(articleDir, "article_content.html");
    if (!fs.existsSync(metaPath) || !fs.existsSync(contentPath)) {
        return { statusCode: 404, payload: { error: "文章本地正文不存在，无法分析" } };
    }

    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    const contentHtml = fs.readFileSync(contentPath, "utf-8");
    const analysis = await analyzeArticle(meta, contentHtml);

    fs.writeFileSync(path.join(articleDir, "analysis.json"), JSON.stringify(analysis, null, 2), "utf-8");
    fs.writeFileSync(path.join(articleDir, "article.md"), buildMarkdown(meta, contentHtml, analysis), "utf-8");
    upsertIndexRecord(
        path.join(DEFAULT_OUTPUT_DIR, INDEX_FILE_NAME),
        buildIndexRecord(DEFAULT_OUTPUT_DIR, articleDir, meta, analysis)
    );

    if (!isModelAnalysis(analysis)) {
        const message = analysis.llm_fallback?.reason || analysis.analysis_note || "模型分析未完成";
        return {
            statusCode: analysis.analysis_status === "failed" ? 502 : 400,
            payload: { error: message, detail: loadArticleDetail(articleId) },
        };
    }

    return { statusCode: 200, payload: loadArticleDetail(articleId) };
}

async function handleApi(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/articles") {
        return sendJson(res, 200, { articles: loadIndex() });
    }

    if (req.method === "GET" && url.pathname === "/api/authors") {
        return sendJson(res, 200, { authors: buildAuthorSummary(loadIndex()) });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/articles/")) {
        const rest = decodeURIComponent(url.pathname.replace("/api/articles/", ""));

        if (rest.endsWith("/share")) {
            const articleId = rest.slice(0, -"/share".length);
            const result = buildShareableHtml(articleId);
            if (!result) return sendJson(res, 404, { error: "文章不存在" });
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(result.html);
            return;
        }

        if (rest.endsWith("/note")) {
            const articleId = rest.slice(0, -"/note".length);
            const context = getArticleNoteContext(articleId);
            if (!context) return sendJson(res, 404, { error: "文章不存在" });
            return sendJson(res, 200, {
                article_id: articleId,
                ...readPersonalNote(context.articleDir, context.meta),
            });
        }

        const detail = loadArticleDetail(rest);
        if (!detail) {
            return sendJson(res, 404, { error: "文章不存在" });
        }
        return sendJson(res, 200, detail);
    }

    if (req.method === "PUT" && url.pathname.startsWith("/api/articles/")) {
        const rest = decodeURIComponent(url.pathname.replace("/api/articles/", ""));
        if (rest.endsWith("/note")) {
            const articleId = rest.slice(0, -"/note".length);
            const context = getArticleNoteContext(articleId);
            if (!context) return sendJson(res, 404, { error: "文章不存在" });

            try {
                const body = await readJsonBody(req);
                return sendJson(res, 200, {
                    article_id: articleId,
                    ...writePersonalNote(context.articleDir, body.content),
                });
            } catch (error) {
                return sendJson(res, 400, { error: error.message || "保存笔记失败" });
            }
        }
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/articles/")) {
        const rest = decodeURIComponent(url.pathname.replace("/api/articles/", ""));
        if (rest.endsWith("/analyze")) {
            const articleId = rest.slice(0, -"/analyze".length);
            try {
                const result = await analyzeStoredArticle(articleId);
                return sendJson(res, result.statusCode, result.payload);
            } catch (error) {
                return sendJson(res, 500, { error: error.message || "模型分析失败" });
            }
        }
    }

    if (req.method === "POST" && url.pathname === "/api/fetch") {
        try {
            const body = await readJsonBody(req);
            if (!isWeChatArticleUrl(body.url)) {
                return sendJson(res, 400, { error: "仅支持 mp.weixin.qq.com 文章链接" });
            }

            const result = await captureArticleToLocal(body.url, { output: DEFAULT_OUTPUT_DIR });
            return sendJson(res, 200, {
                ok: true,
                article_id: result.meta.articleId,
                title: result.meta.title,
                author: cleanAuthorName(result.meta.author, result.meta.account, result.meta.publishTime),
                account: result.meta.account,
                publish_time: result.meta.publishTime,
                source_url: result.meta.source,
                article_dir: result.articleDir,
                markdown_path: result.markdownPath,
                offline_html_path: result.offlineHtmlPath,
                analysis_provider: result.analysis.analysis_provider,
                analysis_model: result.analysis.analysis_model,
            });
        } catch (error) {
            return sendJson(res, 500, { error: error.message || "抓取失败" });
        }
    }

    if (req.method === "GET" && url.pathname === "/api/account-articles") {
        const sourceUrl = url.searchParams.get("source_url");
        if (!isWeChatArticleUrl(sourceUrl)) {
            return sendJson(res, 400, { error: "缺少或无效的 source_url 参数" });
        }
        try {
            const result = await listAccountArticles(sourceUrl, { maxPages: 6 });
            return sendJson(res, 200, result);
        } catch (error) {
            return sendJson(res, 500, { error: error.message || "获取文章列表失败" });
        }
    }

    if (req.method === "POST" && url.pathname === "/api/batch-fetch") {
        try {
            const body = await readJsonBody(req);
            const urls = Array.isArray(body.urls) ? body.urls : [];
            if (urls.length === 0) return sendJson(res, 400, { error: "urls 数组为空" });
            if (urls.length > 50) return sendJson(res, 400, { error: "单次最多 50 篇" });

            const results = [];
            for (const articleUrl of urls) {
                if (!isWeChatArticleUrl(articleUrl)) {
                    results.push({ url: articleUrl, ok: false, error: "链接格式不支持" });
                    continue;
                }
                try {
                    const result = await captureArticleToLocal(articleUrl, { output: DEFAULT_OUTPUT_DIR });
                    results.push({
                        url: articleUrl,
                        ok: true,
                        article_id: result.meta.articleId,
                        title: result.meta.title,
                        analysis_provider: result.analysis.analysis_provider,
                        analysis_model: result.analysis.analysis_model,
                    });
                } catch (err) {
                    results.push({ url: articleUrl, ok: false, error: err.message || "抓取失败" });
                }
            }
            return sendJson(res, 200, { results });
        } catch (error) {
            return sendJson(res, 500, { error: error.message || "批量抓取失败" });
        }
    }

    if (url.pathname.startsWith("/api/")) {
        return sendJson(res, 404, { error: "API 不存在", path: url.pathname });
    }

    return false;
}

function serveFile(res, filePath) {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        sendText(res, 404, "Not Found");
        return;
    }
    res.writeHead(200, { "Content-Type": getMimeType(filePath) });
    fs.createReadStream(filePath).pipe(res);
}

export const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    try {
        const handled = await handleApi(req, res, url);
        if (handled !== false) return;

        if (url.pathname.startsWith("/library/")) {
            const relativePath = decodeURIComponent(url.pathname.replace("/library/", ""));
            return serveFile(res, safeJoin(DEFAULT_OUTPUT_DIR, relativePath));
        }

        const requestedPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        return serveFile(res, safeJoin(WEB_ROOT, requestedPath));
    } catch (error) {
        sendJson(res, 500, { error: error.message || "服务异常" });
    }
});

export function startServer() {
    server.listen(PORT, HOST, () => {
        console.log(`本地网页已启动: http://${HOST}:${PORT}`);
        console.log(`文章数据目录: ${DEFAULT_OUTPUT_DIR}`);
    });
}

if (process.argv[1] === __filename) {
    startServer();
}
