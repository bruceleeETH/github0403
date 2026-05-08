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

export async function saveFromPage(page, url, baseOutputDir, imageCache) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector("#js_content, .rich_media_content", { timeout: 20000 });
    await page.waitForNetworkIdle({ idleTime: 1200, timeout: 20000 });

    const rawHtml = await page.content();
    const extracted = extractImageUrlMapFromRawHtml(rawHtml);
    await warmImageCache(page, extracted.orderedUrls);
    const imageMap = Object.fromEntries(extracted.byFileId.entries());
    const data = await extractArticleDataFromPage(page, imageMap);

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

    const urlToLocal = await saveImagesFromCapture(data.images, articleDir, imageCache, requestHeaders);
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

    return {
        articleDir,
        meta,
        analysis,
        files,
        downloadedImageCount: new Set(urlToLocal.values()).size,
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

    const browser = await launchArticleBrowser({
        headless: options.headless ?? "new",
        defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true },
    });

    try {
        const page = await prepareArticlePage(browser);
        const commentHits = watchCommentRequests(page);
        const imageCache = watchImageResponses(page);
        const { articleDir, meta, analysis, files, downloadedImageCount } = await saveFromPage(page, url, outputDir, imageCache);

        const screenshotPath = path.join(articleDir, "preview.png");
        await page.screenshot({ path: screenshotPath, fullPage: true });

        const commentLogPath = path.join(articleDir, "comment_requests.json");
        fs.writeFileSync(commentLogPath, JSON.stringify(commentHits, null, 2), "utf-8");

        return {
            articleDir,
            meta,
            analysis,
            files: {
                ...files,
                preview: screenshotPath,
                commentLog: commentLogPath,
            },
            downloadedImageCount,
            screenshotPath,
            commentLogPath,
            offlineHtmlPath: path.join(articleDir, "offline_article.html"),
            markdownPath: path.join(articleDir, "article.md"),
        };
    } finally {
        await browser.close();
    }
}
