import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DEFAULT_OUTPUT_DIR, INDEX_FILE_NAME, MOBILE_WECHAT_UA } from "../config/constants.mjs";
import { normalizeAuthorName, upsertIndexRecord } from "../storage/article-index.mjs";
import { buildArticleId, buildIndexRecord, resolveArticleDir } from "../storage/file-layout.mjs";
import { ensureDir } from "../storage/paths.mjs";
import { analyzeArticle } from "./analyze-article.mjs";
import { launchArticleBrowser, prepareArticlePage } from "./browser-session.mjs";
import { writeArticleFiles } from "./export-article.mjs";
import {
    extractImageUrlMapFromRawHtml,
    replaceImageUrlsInHtml,
    saveImagesFromCapture,
    warmImageCache,
    watchImageResponses,
} from "./image-cache.mjs";
import { extractArticleDataFromPage } from "./parse-article.mjs";

function buildCaptureDiagnostics(url) {
    return {
        source_url: url,
        started_at: new Date().toISOString(),
        steps: [],
        warnings: [],
        images: {
            discovered: 0,
            saved: [],
            failed: [],
        },
    };
}

function addDiagnosticStep(diagnostics, name, status, detail = {}) {
    diagnostics?.steps.push({
        name,
        status,
        at: new Date().toISOString(),
        ...detail,
    });
}

function classifyCaptureError(error) {
    const message = String(error?.message || "");
    if (/Waiting for selector.*(#js_content|rich_media_content)|selector/i.test(message)) {
        return "正文区域未出现，文章可能需要登录、已失效，或页面结构已变化";
    }
    if (/Navigation timeout|net::ERR|ERR_NAME|ERR_CONNECTION|ERR_TUNNEL|ERR_PROXY/i.test(message)) {
        return "页面访问失败，请检查网络、代理或文章链接是否仍可打开";
    }
    if (/timeout/i.test(message)) {
        return "页面加载超时，可能是微信页面响应慢或网络不稳定";
    }
    return "抓取失败";
}

export async function saveFromPage(page, url, baseOutputDir, imageCache, options = {}) {
    const diagnostics = options.diagnostics || buildCaptureDiagnostics(url);
    let response = null;

    try {
        response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        addDiagnosticStep(diagnostics, "page.goto", "ok", {
            status: response?.status?.() || 0,
            final_url: page.url(),
        });
    } catch (error) {
        addDiagnosticStep(diagnostics, "page.goto", "failed", { reason: error.message || "页面访问失败" });
        error.captureReason = classifyCaptureError(error);
        throw error;
    }

    try {
        await page.waitForSelector("#js_content, .rich_media_content", { timeout: 20000 });
        addDiagnosticStep(diagnostics, "waitForSelector", "ok");
    } catch (error) {
        addDiagnosticStep(diagnostics, "waitForSelector", "failed", { reason: error.message || "正文等待失败" });
        error.captureReason = classifyCaptureError(error);
        throw error;
    }

    try {
        await page.waitForNetworkIdle({ idleTime: 1200, timeout: 20000 });
        addDiagnosticStep(diagnostics, "waitForNetworkIdle", "ok");
    } catch (error) {
        diagnostics.warnings.push({
            type: "network_idle_timeout",
            message: "页面网络请求未完全静默，继续尝试提取正文和图片",
            detail: error.message || "",
        });
        addDiagnosticStep(diagnostics, "waitForNetworkIdle", "warning", { reason: error.message || "网络静默等待超时" });
    }

    const rawHtml = await page.content();
    const extracted = extractImageUrlMapFromRawHtml(rawHtml);
    diagnostics.images.discovered = extracted.orderedUrls.length;
    await warmImageCache(page, extracted.orderedUrls);
    const imageMap = Object.fromEntries(extracted.byFileId.entries());
    const data = await extractArticleDataFromPage(page, imageMap);
    if (!data.contentHtml) {
        diagnostics.warnings.push({
            type: "empty_content",
            message: "正文 HTML 为空",
        });
    }

    const meta = {
        title: data.title,
        account: data.account,
        author: normalizeAuthorName(data.author, data.account, data.publishTime),
        publishTime: data.publishTime,
        source: url,
        imageCount: data.images.length,
        savedAt: new Date().toISOString(),
    };
    meta.contentHash = crypto.createHash("sha1").update(data.contentHtml || rawHtml || url).digest("hex");
    meta.articleId = buildArticleId(meta, data.contentHtml || rawHtml || url);

    const articleDir = resolveArticleDir(baseOutputDir, meta);
    ensureDir(articleDir);

    const cookieHeader = (await page.cookies())
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");
    const requestHeaders = {
        "user-agent": MOBILE_WECHAT_UA,
        referer: url,
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9",
    };
    if (cookieHeader) {
        requestHeaders.cookie = cookieHeader;
    }

    diagnostics.images.discovered = data.images.length || diagnostics.images.discovered;
    const urlToLocal = await saveImagesFromCapture(data.images, articleDir, imageCache, requestHeaders, { diagnostics });
    const localContentHtml = replaceImageUrlsInHtml(data.contentHtml, urlToLocal);
    const analysis = await analyzeArticle(meta, localContentHtml);
    const files = writeArticleFiles({
        articleDir,
        meta,
        analysis,
        localContentHtml,
        rawHtml,
        fullHtml: data.fullHtml,
    });
    const indexRecord = buildIndexRecord(baseOutputDir, articleDir, meta, analysis);
    upsertIndexRecord(path.join(baseOutputDir, INDEX_FILE_NAME), indexRecord);
    addDiagnosticStep(diagnostics, "writeArticleFiles", "ok", {
        article_dir: articleDir,
        downloaded_images: new Set(urlToLocal.values()).size,
    });

    return {
        articleDir,
        meta,
        analysis,
        files,
        downloadedImageCount: new Set(urlToLocal.values()).size,
        diagnostics,
    };
}

export function watchCommentRequests(page) {
    const hits = [];
    page.on("response", async (resp) => {
        const url = resp.url();
        if (!url.includes("mp.weixin.qq.com")) return;
        if (!/comment|appmsg_comment|getcomment|get_comment/i.test(url)) return;
        try {
            const text = await resp.text();
            hits.push({
                url,
                status: resp.status(),
                bodyPreview: text.slice(0, 500),
            });
        } catch {
            hits.push({
                url,
                status: resp.status(),
                bodyPreview: "<read response failed>",
            });
        }
    });
    return hits;
}

export async function captureArticleToLocal(url, options = {}) {
    const outputDir = options.output ? path.resolve(options.output) : DEFAULT_OUTPUT_DIR;
    ensureDir(outputDir);
    const diagnostics = buildCaptureDiagnostics(url);

    const browser = await launchArticleBrowser({
        headless: options.headless ?? "new",
        defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true },
    });

    try {
        const page = await prepareArticlePage(browser);
        const commentHits = watchCommentRequests(page);
        const imageCache = watchImageResponses(page);
        const { articleDir, meta, analysis, files, downloadedImageCount } = await saveFromPage(page, url, outputDir, imageCache, {
            diagnostics,
        });

        const screenshotPath = path.join(articleDir, "preview.png");
        try {
            await page.screenshot({ path: screenshotPath, fullPage: true });
            addDiagnosticStep(diagnostics, "screenshot", "ok", { file: screenshotPath });
        } catch (error) {
            diagnostics.warnings.push({
                type: "screenshot_failed",
                message: "预览截图保存失败",
                detail: error.message || "",
            });
            addDiagnosticStep(diagnostics, "screenshot", "warning", { reason: error.message || "截图失败" });
        }

        const commentLogPath = path.join(articleDir, "comment_requests.json");
        fs.writeFileSync(commentLogPath, JSON.stringify(commentHits, null, 2), "utf-8");
        diagnostics.finished_at = new Date().toISOString();
        const diagnosticsPath = path.join(articleDir, "capture_diagnostics.json");
        fs.writeFileSync(diagnosticsPath, JSON.stringify(diagnostics, null, 2), "utf-8");

        return {
            articleDir,
            meta,
            analysis,
            files: {
                ...files,
                preview: screenshotPath,
                commentLog: commentLogPath,
                diagnostics: diagnosticsPath,
            },
            downloadedImageCount,
            diagnostics,
            screenshotPath,
            commentLogPath,
            diagnosticsPath,
            offlineHtmlPath: path.join(articleDir, "offline_article.html"),
            markdownPath: path.join(articleDir, "article.md"),
        };
    } catch (error) {
        diagnostics.finished_at = new Date().toISOString();
        diagnostics.error = {
            reason: error.captureReason || classifyCaptureError(error),
            message: error.message || "抓取失败",
        };
        error.captureDiagnostics = diagnostics;
        error.userMessage = diagnostics.error.reason;
        throw error;
    } finally {
        await browser.close();
    }
}
