#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { captureArticleToLocal, listAccountArticles, DEFAULT_OUTPUT_DIR, INDEX_FILE_NAME, normalizeIndexRecords } from "./save_wechat_article_puppeteer.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_ROOT = path.join(__dirname, "webapp");
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

function safeJoin(baseDir, targetPath) {
    const resolved = path.resolve(baseDir, targetPath);
    if (!resolved.startsWith(path.resolve(baseDir))) {
        throw new Error("非法路径");
    }
    return resolved;
}

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case ".html": return "text/html; charset=utf-8";
        case ".js": return "application/javascript; charset=utf-8";
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
    const indexPath = path.join(DEFAULT_OUTPUT_DIR, INDEX_FILE_NAME);
    if (!fs.existsSync(indexPath)) return [];
    const records = fs
        .readFileSync(indexPath, "utf-8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    return normalizeIndexRecords(records);
}

function encodeLibraryPath(relPath) {
    return relPath.split("/").map(encodeURIComponent).join("/");
}

function loadArticleDetail(articleId) {
    const record = loadIndex().find((item) => item.article_id === articleId);
    if (!record) return null;

    const articleDir = safeJoin(DEFAULT_OUTPUT_DIR, record.article_dir);
    const meta = JSON.parse(fs.readFileSync(path.join(articleDir, "meta.json"), "utf-8"));
    const analysis = JSON.parse(fs.readFileSync(path.join(articleDir, "analysis.json"), "utf-8"));
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

function buildAuthorSummary(records) {
    const grouped = new Map();
    for (const record of records) {
        const key = record.author || record.account || "未知作者";
        if (!grouped.has(key)) {
            grouped.set(key, {
                author: key,
                article_count: 0,
                latest_publish_time: "",
                keywords: new Map(),
                sentiments: { positive: 0, neutral: 0, negative: 0 },
            });
        }

        const summary = grouped.get(key);
        summary.article_count += 1;
        if (!summary.latest_publish_time || String(record.publish_time).localeCompare(summary.latest_publish_time) > 0) {
            summary.latest_publish_time = record.publish_time;
        }
        for (const keyword of record.keywords || []) {
            summary.keywords.set(keyword, (summary.keywords.get(keyword) || 0) + 1);
        }
        summary.sentiments[record.sentiment || "neutral"] += 1;
    }

    return [...grouped.values()]
        .map((item) => ({
            author: item.author,
            article_count: item.article_count,
            latest_publish_time: item.latest_publish_time,
            top_keywords: [...item.keywords.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([keyword]) => keyword),
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

    // Replace local image paths with base64 Data URIs
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

async function handleApi(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/articles") {
        return sendJson(res, 200, { articles: loadIndex() });
    }

    if (req.method === "GET" && url.pathname === "/api/authors") {
        return sendJson(res, 200, { authors: buildAuthorSummary(loadIndex()) });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/articles/")) {
        const rest = decodeURIComponent(url.pathname.replace("/api/articles/", ""));

        // /api/articles/:id/share — self-contained HTML for sharing
        if (rest.endsWith("/share")) {
            const articleId = rest.slice(0, -"/share".length);
            const result = buildShareableHtml(articleId);
            if (!result) return sendJson(res, 404, { error: "文章不存在" });
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(result.html);
            return;
        }

        const detail = loadArticleDetail(rest);
        if (!detail) {
            return sendJson(res, 404, { error: "文章不存在" });
        }
        return sendJson(res, 200, detail);
    }

    if (req.method === "POST" && url.pathname === "/api/fetch") {
        try {
            const body = await readJsonBody(req);
            if (!body.url || !String(body.url).startsWith("https://mp.weixin.qq.com/")) {
                return sendJson(res, 400, { error: "仅支持 mp.weixin.qq.com 文章链接" });
            }

            const result = await captureArticleToLocal(body.url, { output: DEFAULT_OUTPUT_DIR });
            return sendJson(res, 200, {
                ok: true,
                article_id: result.meta.articleId,
                title: result.meta.title,
                article_dir: result.articleDir,
                markdown_path: result.markdownPath,
                offline_html_path: result.offlineHtmlPath,
            });
        } catch (error) {
            return sendJson(res, 500, { error: error.message || "抓取失败" });
        }
    }

    if (req.method === "GET" && url.pathname === "/api/account-articles") {
        const sourceUrl = url.searchParams.get("source_url");
        if (!sourceUrl || !sourceUrl.startsWith("https://mp.weixin.qq.com/")) {
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
                if (!String(articleUrl).startsWith("https://mp.weixin.qq.com/")) {
                    results.push({ url: articleUrl, ok: false, error: "链接格式不支持" });
                    continue;
                }
                try {
                    const result = await captureArticleToLocal(articleUrl, { output: DEFAULT_OUTPUT_DIR });
                    results.push({ url: articleUrl, ok: true, article_id: result.meta.articleId, title: result.meta.title });
                } catch (err) {
                    results.push({ url: articleUrl, ok: false, error: err.message || "抓取失败" });
                }
            }
            return sendJson(res, 200, { results });
        } catch (error) {
            return sendJson(res, 500, { error: error.message || "批量抓取失败" });
        }
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

const server = http.createServer(async (req, res) => {
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

server.listen(PORT, HOST, () => {
    console.log(`本地网页已启动: http://${HOST}:${PORT}`);
    console.log(`文章数据目录: ${DEFAULT_OUTPUT_DIR}`);
});