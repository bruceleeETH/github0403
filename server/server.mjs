#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DEFAULT_OUTPUT_DIR, INDEX_FILE_NAME, STOCK_TRACKING_DIR } from "../src/config/constants.mjs";
import { analyzeArticle, isModelAnalysis, sanitizeModelAnalysis } from "../src/core/analyze-article.mjs";
import { captureArticleToLocal } from "../src/core/capture-article.mjs";
import { getDeepSeekConfig } from "../src/core/deepseek-analyzer.mjs";
import { buildMarkdown } from "../src/core/export-article.mjs";
import { listAccountArticles } from "../src/core/list-account-articles.mjs";
import { readPersonalNote, writePersonalNote } from "../src/core/personal-note.mjs";
import { buildSectorDashboard, loadSectorDetail } from "../src/core/sector-tracker.mjs";
import {
    addStock,
    archiveStock,
    buildReviewQueue,
    getStockCatalogStatus,
    getStockPriceStatus,
    loadStockDashboard,
    loadStockDetail,
    readDailyPrices,
    readStockNote,
    readStocks,
    searchStockCatalog,
    updateStock,
    writeStockNote,
} from "../src/core/stock-tracker.mjs";
import { cleanAuthorName, loadArticleIndex, upsertIndexRecord } from "../src/storage/article-index.mjs";
import { buildIndexRecord } from "../src/storage/file-layout.mjs";
import { encodeLibraryPath, safeJoin } from "../src/storage/paths.mjs";
import { getErrorPayload, HttpError, readJsonBody, requireMethod, sendJson, sendText } from "../src/server/http-utils.mjs";
import { SerialTaskRunner, TaskBusyError, taskBusyPayload } from "../src/server/task-queue.mjs";
import { isWeChatArticleUrl } from "../src/utils/url.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const WEB_ROOT = path.join(PROJECT_ROOT, "webapp");
const STOCK_CATALOG_UPDATE_SCRIPT = path.join(PROJECT_ROOT, "scripts", "update_stock_catalog.py");
const STOCK_PRICE_UPDATE_SCRIPT = path.join(PROJECT_ROOT, "scripts", "update_stock_prices.py");
const PROJECT_VENV_PYTHON = path.join(PROJECT_ROOT, ".venv", "bin", "python");
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4318);
const execFileAsync = promisify(execFile);
const captureRunner = new SerialTaskRunner("capture");
const stockCatalogRunner = new SerialTaskRunner("stock_catalog_update");
const stockPriceRunner = new SerialTaskRunner("stock_price_update");

function buildHealthPayload() {
    const deepseek = getDeepSeekConfig();
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : PORT;
    return {
        ok: true,
        server: "wechat-article-saver",
        port: actualPort,
        data_dir: DEFAULT_OUTPUT_DIR,
        stock_tracking_dir: STOCK_TRACKING_DIR,
        deepseek: {
            configured: Boolean(deepseek.apiKey),
            model: deepseek.model,
            base_url: deepseek.baseUrl,
        },
        features: {
            article_capture: true,
            article_analyze: true,
            stock_tracking: true,
            sector_tracking: true,
        },
    };
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

function loadAnalyzedArticleRecords() {
    return loadIndex().map((record) => {
        const articleDir = safeJoin(DEFAULT_OUTPUT_DIR, record.article_dir);
        const analysisPath = path.join(articleDir, "analysis.json");
        if (!fs.existsSync(analysisPath)) return record;
        try {
            return {
                ...record,
                analysis: JSON.parse(fs.readFileSync(analysisPath, "utf-8")),
            };
        } catch {
            return record;
        }
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

function findRelatedArticlesForStock(stock, limit = 20) {
    const code = String(stock.code || "").trim();
    const name = String(stock.name || "").trim();
    if (!code && !name) return [];

    return loadIndex()
        .filter((record) => {
            const stocks = Array.isArray(record.stocks) ? record.stocks : [];
            return stocks.some((item) => {
                const label = String(item || "");
                return (name && label.includes(name)) || (code && label.includes(code));
            });
        })
        .slice(0, limit)
        .map((record) => ({
            article_id: record.article_id,
            title: record.title,
            author: record.author || record.account,
            account: record.account,
            publish_time: record.publish_time,
            source_url: record.source_url,
            stocks: record.stocks || [],
        }));
}

function parseArticleStockLabel(label) {
    if (label && typeof label === "object") {
        return {
            name: String(label.name || "").trim(),
            code: String(label.code || "").trim(),
        };
    }
    const text = String(label || "").trim();
    const match = text.match(/^(.+?)\(([^()]+)\)$/);
    if (match) {
        return {
            name: match[1].trim(),
            code: match[2].trim(),
        };
    }
    return { name: text, code: "" };
}

function buildArticleStockMentions(records, stocks) {
    const activeStocks = stocks.filter((stock) => stock.status !== "archived");
    const byCode = new Set(activeStocks.map((stock) => String(stock.code || "")));
    const byName = new Set(activeStocks.map((stock) => String(stock.name || "")));
    const grouped = new Map();

    for (const record of records) {
        for (const label of record.stocks || []) {
            const parsed = parseArticleStockLabel(label);
            if (!parsed.name && !parsed.code) continue;
            const key = parsed.code || parsed.name;
            if (!grouped.has(key)) {
                grouped.set(key, {
                    stock: parsed.code ? {
                        stock_id: "",
                        code: parsed.code,
                        exchange: "",
                        name: parsed.name || parsed.code,
                    } : null,
                    code: parsed.code,
                    name: parsed.name || parsed.code,
                    count: 0,
                    in_pool: false,
                    articles: [],
                });
            }
            const item = grouped.get(key);
            item.count += 1;
            item.in_pool = item.in_pool || byCode.has(parsed.code) || byName.has(parsed.name);
            item.articles.push({
                article_id: record.article_id,
                title: record.title,
                author: record.author || record.account,
                account: record.account,
                publish_time: record.publish_time,
            });
        }
    }

    return [...grouped.values()];
}

async function runStockCatalogUpdate() {
    try {
        const pythonBin = process.env.STOCK_CATALOG_PYTHON || (fs.existsSync(PROJECT_VENV_PYTHON) ? PROJECT_VENV_PYTHON : "python3");
        const { stdout } = await execFileAsync(pythonBin, [
            STOCK_CATALOG_UPDATE_SCRIPT,
            "--data-dir",
            STOCK_TRACKING_DIR,
        ], {
            cwd: PROJECT_ROOT,
            maxBuffer: 10 * 1024 * 1024,
        });
        const jsonLine = String(stdout || "").split(/\r?\n/).reverse().find((line) => line.trim().startsWith("{"));
        return jsonLine ? JSON.parse(jsonLine) : {};
    } catch (error) {
        const stderr = String(error.stderr || error.message || "");
        if (stderr.includes("No module named") && stderr.includes("akshare")) {
            throw new Error("未检测到 akshare，请先运行：pip install akshare");
        }
        throw new Error(stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(" / ") || "股票目录更新失败");
    }
}

async function runStockPriceUpdate(options = {}) {
    try {
        const pythonBin = process.env.STOCK_PRICE_PYTHON || (fs.existsSync(PROJECT_VENV_PYTHON) ? PROJECT_VENV_PYTHON : "python3");
        const args = [
            STOCK_PRICE_UPDATE_SCRIPT,
            "--data-dir",
            STOCK_TRACKING_DIR,
        ];
        if (options.stock_id) args.push("--stock-id", String(options.stock_id).toUpperCase());
        if (options.start_date) args.push("--start-date", String(options.start_date));
        if (options.end_date) args.push("--end-date", String(options.end_date));
        if (options.adjust !== undefined) args.push("--adjust", String(options.adjust));
        const { stdout } = await execFileAsync(pythonBin, args, {
            cwd: PROJECT_ROOT,
            maxBuffer: 20 * 1024 * 1024,
        });
        const jsonLine = String(stdout || "").split(/\r?\n/).reverse().find((line) => line.trim().startsWith("{"));
        return jsonLine ? JSON.parse(jsonLine) : {};
    } catch (error) {
        const stderr = String(error.stderr || error.message || "");
        if (stderr.includes("No module named") && stderr.includes("akshare")) {
            throw new Error("未检测到 akshare，请先安装项目依赖：.venv/bin/python -m pip install -r requirements.txt");
        }
        throw new Error(stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(" / ") || "股票行情更新失败");
    }
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
    if (req.method === "GET" && url.pathname === "/api/health") {
        return sendJson(res, 200, buildHealthPayload());
    }

    if (req.method === "GET" && url.pathname === "/api/stocks/catalog/status") {
        return sendJson(res, 200, getStockCatalogStatus(STOCK_TRACKING_DIR));
    }

    if (req.method === "GET" && url.pathname === "/api/tasks") {
        return sendJson(res, 200, {
            tasks: {
                capture: captureRunner.getStatus(),
                stock_catalog_update: stockCatalogRunner.getStatus(),
                stock_price_update: stockPriceRunner.getStatus(),
            },
        });
    }

    if (url.pathname === "/api/stocks/catalog/update") {
        if (!requireMethod(req, res, ["POST"])) return;
        try {
            const result = await stockCatalogRunner.run("更新股票目录", () => runStockCatalogUpdate());
            return sendJson(res, 200, {
                ...result,
                status: getStockCatalogStatus(STOCK_TRACKING_DIR),
            });
        } catch (error) {
            if (error instanceof TaskBusyError) {
                return sendJson(res, 409, taskBusyPayload(error));
            }
            return sendJson(res, 500, { error: error.message || "股票目录更新失败" });
        }
    }

    if (url.pathname === "/api/stocks/prices/update") {
        if (!requireMethod(req, res, ["POST"])) return;
        try {
            const body = await readJsonBody(req);
            const label = body.stock_id ? `更新 ${String(body.stock_id).toUpperCase()} 行情` : "更新关注池行情";
            const result = await stockPriceRunner.run(label, () => runStockPriceUpdate(body));
            return sendJson(res, 200, {
                ...result,
                status: getStockPriceStatus(STOCK_TRACKING_DIR),
            });
        } catch (error) {
            if (error instanceof TaskBusyError) {
                return sendJson(res, 409, taskBusyPayload(error));
            }
            const { statusCode, payload } = getErrorPayload(error, "股票行情更新失败");
            return sendJson(res, statusCode === 500 ? 500 : statusCode, {
                error: payload.error || "股票行情更新失败",
                ...payload,
            });
        }
    }

    if (url.pathname === "/api/fetch") {
        if (!requireMethod(req, res, ["POST"])) return;
        try {
            const body = await readJsonBody(req);
            if (!isWeChatArticleUrl(body.url)) {
                return sendJson(res, 400, { error: "仅支持 mp.weixin.qq.com 文章链接" });
            }

            const result = await captureRunner.run("抓取公众号文章", () => captureArticleToLocal(body.url, { output: DEFAULT_OUTPUT_DIR }));
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
                diagnostics_path: result.diagnosticsPath,
                diagnostics: result.diagnostics,
                analysis_provider: result.analysis.analysis_provider,
                analysis_model: result.analysis.analysis_model,
            });
        } catch (error) {
            if (error instanceof TaskBusyError) {
                return sendJson(res, 409, taskBusyPayload(error));
            }
            if (error instanceof HttpError) {
                return sendJson(res, error.statusCode, { error: error.message, ...error.payload });
            }
            return sendJson(res, 500, {
                error: error.userMessage || error.message || "抓取失败",
                diagnostics: error.captureDiagnostics || null,
            });
        }
    }

    if (url.pathname === "/api/batch-fetch") {
        if (!requireMethod(req, res, ["POST"])) return;
        try {
            const body = await readJsonBody(req);
            const urls = Array.isArray(body.urls) ? body.urls : [];
            if (urls.length === 0) return sendJson(res, 400, { error: "urls 数组为空" });
            if (urls.length > 50) return sendJson(res, 400, { error: "单次最多 50 篇" });

            const results = await captureRunner.run("批量抓取公众号文章", async () => {
                const items = [];
                for (const articleUrl of urls) {
                    if (!isWeChatArticleUrl(articleUrl)) {
                        items.push({ url: articleUrl, ok: false, error: "链接格式不支持" });
                        continue;
                    }
                    try {
                        const result = await captureArticleToLocal(articleUrl, { output: DEFAULT_OUTPUT_DIR });
                        items.push({
                            url: articleUrl,
                            ok: true,
                            article_id: result.meta.articleId,
                            title: result.meta.title,
                            diagnostics_path: result.diagnosticsPath,
                            analysis_provider: result.analysis.analysis_provider,
                            analysis_model: result.analysis.analysis_model,
                        });
                    } catch (err) {
                        items.push({
                            url: articleUrl,
                            ok: false,
                            error: err.userMessage || err.message || "抓取失败",
                            diagnostics: err.captureDiagnostics || null,
                        });
                    }
                }
                return items;
            });
            return sendJson(res, 200, { results });
        } catch (error) {
            if (error instanceof TaskBusyError) {
                return sendJson(res, 409, taskBusyPayload(error));
            }
            const { statusCode, payload } = getErrorPayload(error, "批量抓取失败");
            return sendJson(res, statusCode, payload);
        }
    }

    if (req.method === "GET" && url.pathname === "/api/stocks/search") {
        const query = url.searchParams.get("q") || "";
        return sendJson(res, 200, {
            query,
            items: searchStockCatalog(STOCK_TRACKING_DIR, query, { limit: Number(url.searchParams.get("limit") || 20) }),
            status: getStockCatalogStatus(STOCK_TRACKING_DIR),
        });
    }

    if (req.method === "GET" && url.pathname === "/api/stocks/prices/status") {
        return sendJson(res, 200, getStockPriceStatus(STOCK_TRACKING_DIR));
    }

    if (req.method === "GET" && url.pathname === "/api/stocks/review-queue") {
        const stocks = readStocks(STOCK_TRACKING_DIR);
        const prices = readDailyPrices(STOCK_TRACKING_DIR);
        const mentions = buildArticleStockMentions(loadIndex(), stocks);
        return sendJson(res, 200, {
            items: buildReviewQueue(stocks, prices, mentions),
        });
    }

    if (req.method === "GET" && url.pathname === "/api/stocks") {
        return sendJson(res, 200, loadStockDashboard(STOCK_TRACKING_DIR, {
            range: url.searchParams.get("range") || "day",
            order: url.searchParams.get("order") || "desc",
            query: url.searchParams.get("q") || "",
        }));
    }

    if (req.method === "POST" && url.pathname === "/api/stocks") {
        try {
            const body = await readJsonBody(req);
            const stock = addStock(STOCK_TRACKING_DIR, body);
            return sendJson(res, 201, { stock });
        } catch (error) {
            return sendJson(res, 400, { error: error.message || "添加股票失败" });
        }
    }

    if (url.pathname.startsWith("/api/stocks/")) {
        const stockId = decodeURIComponent(url.pathname.replace("/api/stocks/", "")).toUpperCase();

        if (stockId.endsWith("/NOTE")) {
            const cleanStockId = stockId.slice(0, -"/NOTE".length);
            const detail = loadStockDetail(STOCK_TRACKING_DIR, cleanStockId);
            if (!detail) return sendJson(res, 404, { error: "股票不存在" });

            if (req.method === "GET") {
                return sendJson(res, 200, {
                    stock_id: cleanStockId,
                    ...readStockNote(STOCK_TRACKING_DIR, detail.stock),
                });
            }

            if (req.method === "PUT") {
                try {
                    const body = await readJsonBody(req);
                    return sendJson(res, 200, {
                        stock_id: cleanStockId,
                        ...writeStockNote(STOCK_TRACKING_DIR, detail.stock, body.content),
                    });
                } catch (error) {
                    return sendJson(res, 400, { error: error.message || "保存股票笔记失败" });
                }
            }
        }

        if (req.method === "GET") {
            const detail = loadStockDetail(STOCK_TRACKING_DIR, stockId);
            if (!detail) return sendJson(res, 404, { error: "股票不存在" });
            return sendJson(res, 200, {
                ...detail,
                related_articles: findRelatedArticlesForStock(detail.stock),
            });
        }

        if (req.method === "PUT") {
            try {
                const body = await readJsonBody(req);
                const stock = updateStock(STOCK_TRACKING_DIR, stockId, body);
                return sendJson(res, 200, { stock });
            } catch (error) {
                return sendJson(res, 400, { error: error.message || "更新股票失败" });
            }
        }

        if (req.method === "DELETE") {
            try {
                const stock = archiveStock(STOCK_TRACKING_DIR, stockId);
                return sendJson(res, 200, { stock });
            } catch (error) {
                return sendJson(res, 400, { error: error.message || "删除股票失败" });
            }
        }
    }

    if (req.method === "GET" && url.pathname === "/api/articles") {
        return sendJson(res, 200, { articles: loadIndex() });
    }

    if (req.method === "GET" && url.pathname === "/api/authors") {
        return sendJson(res, 200, { authors: buildAuthorSummary(loadIndex()) });
    }

    if (req.method === "GET" && url.pathname === "/api/sectors") {
        const dashboard = buildSectorDashboard(loadAnalyzedArticleRecords(), {
            range: url.searchParams.get("range") || "7d",
            sort: url.searchParams.get("sort") || "heat",
            query: url.searchParams.get("q") || "",
            limit: Number(url.searchParams.get("limit") || 100),
        });
        return sendJson(res, 200, dashboard);
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/sectors/")) {
        const sectorId = decodeURIComponent(url.pathname.replace("/api/sectors/", ""));
        const detail = loadSectorDetail(loadAnalyzedArticleRecords(), sectorId, {
            range: url.searchParams.get("range") || "all",
        });
        if (!detail) return sendJson(res, 404, { error: "板块不存在" });
        return sendJson(res, 200, detail);
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
        if (error instanceof HttpError) {
            sendJson(res, error.statusCode, { error: error.message, ...error.payload });
            return;
        }
        sendJson(res, 500, { error: error.message || "服务异常" });
    }
});

export function startServer() {
    const maxPortAttempts = Number(process.env.PORT_MAX_ATTEMPTS || 1);
    const initialPort = PORT;
    let currentPort = initialPort;

    const listen = () => {
        const handleError = (error) => {
            server.off("listening", handleListening);
            if (error.code === "EADDRINUSE" && currentPort < initialPort + maxPortAttempts - 1) {
                currentPort += 1;
                listen();
                return;
            }
            if (error.code === "EADDRINUSE") {
                console.error(`端口 ${currentPort} 已被占用。请先停止旧服务，或显式指定其他端口：PORT=${currentPort + 1} npm start`);
                process.exitCode = 1;
                return;
            }
            console.error(`本地网页启动失败: ${error.message}`);
            process.exitCode = 1;
        };

        const handleListening = () => {
            server.off("error", handleError);
            console.log(`本地网页已启动: http://${HOST}:${currentPort}`);
            console.log(`文章数据目录: ${DEFAULT_OUTPUT_DIR}`);
            console.log(`股票追踪目录: ${STOCK_TRACKING_DIR}`);
        };

        server.once("error", handleError);
        server.once("listening", handleListening);
        server.listen(currentPort, HOST);
    };

    listen();
}

if (process.argv[1] === __filename) {
    startServer();
}
