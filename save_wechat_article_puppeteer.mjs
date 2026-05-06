#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import TurndownService from "turndown";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MOBILE_WECHAT_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.34(0x1800222b) NetType/WIFI Language/zh_CN";

const DEFAULT_OUTPUT_DIR = process.env.WECHAT_ARTICLE_DATA_DIR
    ? path.resolve(process.env.WECHAT_ARTICLE_DATA_DIR)
    : path.resolve(__dirname, "wechat_articles_puppeteer");
const INDEX_FILE_NAME = "articles.jsonl";
const STOP_WORDS = new Set([
    "今天",
    "这个",
    "因为",
    "所以",
    "已经",
    "还是",
    "一个",
    "没有",
    "不会",
    "就是",
    "我们",
    "你们",
    "他们",
    "自己",
    "如果",
    "然后",
    "而且",
    "以及",
    "进行",
    "可以",
    "需要",
    "什么",
    "不是",
    "不是",
    "时候",
    "里面",
    "这种",
    "比较",
    "一个",
    "一些",
]);

const POSITIVE_HINTS = ["看多", "反弹", "乐观", "修复", "走强", "改善", "买入", "上涨", "机会"];
const NEGATIVE_HINTS = ["看空", "回避", "风险", "杀跌", "悲观", "下跌", "卖出", "担忧", "避险"];

const turndown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
});

turndown.keep(["table"]);

function printHelp() {
    console.log("用法:");
    console.log("  node save_wechat_article_puppeteer.mjs <公众号文章URL>");
    console.log("  node save_wechat_article_puppeteer.mjs <公众号文章URL> --output ./wechat_articles");
    console.log("");
    console.log("说明:");
    console.log("  1) 使用 Puppeteer 打开页面并提取文章标题与正文 HTML");
    console.log("  2) 保存原始页面、正文 HTML 和基础元数据");
    console.log("  3) 评论抓取默认不启用，脚本会输出评论接口观测日志");
}

function parseArgs(argv) {
    const args = { url: "", output: DEFAULT_OUTPUT_DIR };
    const list = [...argv];
    if (list.length === 0 || list.includes("-h") || list.includes("--help")) {
        printHelp();
        process.exit(0);
    }

    args.url = list[0];
    for (let i = 1; i < list.length; i += 1) {
        if (list[i] === "--output" && list[i + 1]) {
            args.output = path.resolve(process.cwd(), list[i + 1]);
            i += 1;
        }
    }

    if (!args.url.startsWith("https://mp.weixin.qq.com/")) {
        throw new Error("仅支持 mp.weixin.qq.com 文章链接");
    }

    return args;
}

function sanitizeName(name) {
    return (name || "untitled")
        .replace(/[<>:\"/\\|?*\x00-\x1f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180);
}

function slugify(value) {
    return sanitizeName(value)
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9\-\u4e00-\u9fff]/g, "")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80) || "untitled";
}

function ensureTrailingNewline(text) {
    return text.endsWith("\n") ? text : `${text}\n`;
}

function escapeHtml(text) {
    return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;");
}

function stripHtmlTags(html) {
    return (html || "")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<\/section>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\r/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
}

function splitParagraphs(text) {
    return stripHtmlTags(text)
        .split(/\n+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 12);
}

function formatFrontmatterValue(value) {
    if (Array.isArray(value)) {
        return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
    }
    if (value === null || value === undefined) {
        return '""';
    }
    return JSON.stringify(String(value));
}

function formatFrontmatter(meta) {
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
        ["sentiment", meta.sentiment || "neutral"],
        ["summary", meta.summary || ""],
    ];

    return `---\n${entries.map(([key, value]) => `${key}: ${formatFrontmatterValue(value)}`).join("\n")}\n---\n\n`;
}

function normalizeDateForId(value) {
    if (!value) return new Date().toISOString().slice(0, 10);
    const match = String(value).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    if (!match) return new Date().toISOString().slice(0, 10);
    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function normalizeAuthorName(author, account, publishTime) {
    const candidate = String(author || "").trim();
    if (!candidate) return account || "";
    if (candidate === account) return candidate;
    if (candidate === publishTime) return account || candidate;
    if (/\d{4}\D+\d{1,2}\D+\d{1,2}/.test(candidate)) return account || candidate;
    return candidate;
}

function normalizeIndexRecord(record) {
    return {
        ...record,
        author: normalizeAuthorName(record.author, record.account, record.publish_time),
    };
}

function scoreIndexRecord(record) {
    let score = 0;
    if (record.author && record.author !== record.publish_time) score += 2;
    if (record.author && record.author === record.account) score += 1;
    if (Array.isArray(record.keywords) && record.keywords.length > 0) score += 1;
    if (record.analysis_file) score += 1;
    if (record.markdown_file) score += 1;
    return score;
}

function normalizeIndexRecords(records) {
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

function buildArticleId(meta, contentHtml) {
    const datePart = normalizeDateForId(meta.publishTime).replace(/-/g, "");
    const accountPart = slugify(meta.account || meta.author || "wechat");
    const hash = crypto.createHash("sha1").update(contentHtml || meta.source).digest("hex").slice(0, 8);
    return `${datePart}_${accountPart}_${hash}`;
}

function extractKeywords(text) {
    const tokens = text.match(/[\p{Script=Han}]{2,8}|[A-Za-z][A-Za-z0-9_-]{2,}/gu) || [];
    const counts = new Map();
    for (const token of tokens) {
        const normalized = token.trim().toLowerCase();
        if (normalized.length < 2) continue;
        if (STOP_WORDS.has(normalized)) continue;
        counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
    return [...counts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 8)
        .map(([token]) => token);
}

function inferSentiment(text) {
    const source = text || "";
    let positiveScore = 0;
    let negativeScore = 0;
    for (const hint of POSITIVE_HINTS) {
        if (source.includes(hint)) positiveScore += 1;
    }
    for (const hint of NEGATIVE_HINTS) {
        if (source.includes(hint)) negativeScore += 1;
    }
    if (negativeScore > positiveScore) return "negative";
    if (positiveScore > negativeScore) return "positive";
    return "neutral";
}

function buildSummary(paragraphs) {
    return paragraphs.slice(0, 3).join(" ").slice(0, 220);
}

function buildViewpoints(paragraphs, keywords) {
    return paragraphs.slice(0, 5).map((paragraph, index) => ({
        id: `vp_${String(index + 1).padStart(3, "0")}`,
        text: paragraph.slice(0, 180),
        keywords: keywords.filter((keyword) => paragraph.includes(keyword)).slice(0, 3),
    }));
}

function buildAnalysis(meta, contentHtml) {
    const text = stripHtmlTags(contentHtml);
    const paragraphs = splitParagraphs(contentHtml);
    const keywords = extractKeywords(text);
    const sentiment = inferSentiment(text);
    const summary = buildSummary(paragraphs);

    return {
        article_id: meta.articleId,
        title: meta.title,
        author: meta.author,
        account: meta.account,
        publish_time: meta.publishTime,
        source_url: meta.source,
        content_hash: meta.contentHash,
        summary,
        keywords,
        sentiment,
        viewpoints: buildViewpoints(paragraphs, keywords),
        paragraph_count: paragraphs.length,
        generated_at: new Date().toISOString(),
    };
}

function buildMarkdown(meta, contentHtml, analysis) {
    const frontmatter = formatFrontmatter({
        ...meta,
        keywords: analysis.keywords,
        sentiment: analysis.sentiment,
        summary: analysis.summary,
    });

    const markdownBody = turndown.turndown(contentHtml || "").trim();
    const header = [
        `# ${meta.title || "微信公众号文章"}`,
        "",
        `- 公众号：${meta.account || ""}`,
        `- 作者：${meta.author || meta.account || ""}`,
        `- 发布时间：${meta.publishTime || ""}`,
        `- 原文链接：${meta.source || ""}`,
        "",
        "## 自动分析",
        "",
        `- 摘要：${analysis.summary || ""}`,
        `- 情绪：${analysis.sentiment || "neutral"}`,
        `- 关键词：${(analysis.keywords || []).join("、")}`,
        "",
        "## 正文",
        "",
    ].join("\n");

    return ensureTrailingNewline(`${frontmatter}${header}${markdownBody}\n`);
}

function upsertIndexRecord(indexPath, record) {
    const existing = fs.existsSync(indexPath)
        ? fs.readFileSync(indexPath, "utf-8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
        : [];

    const filtered = existing.filter(
        (item) => item.article_id !== record.article_id && item.source_url !== record.source_url
    );
    filtered.push(record);
    const normalized = normalizeIndexRecords(filtered);
    const output = normalized.map((item) => JSON.stringify(item)).join("\n");
    fs.writeFileSync(indexPath, ensureTrailingNewline(output), "utf-8");
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function getExtFromContentType(contentType) {
    if (!contentType) return ".jpg";
    if (contentType.includes("png")) return ".png";
    if (contentType.includes("gif")) return ".gif";
    if (contentType.includes("webp")) return ".webp";
    if (contentType.includes("svg")) return ".svg";
    return ".jpg";
}

function normalizeImgUrl(url) {
    if (!url) return "";
    if (url.startsWith("//")) return `https:${url}`;
    return url;
}

function decodeEscapedUrl(raw) {
    return normalizeImgUrl(
        (raw || "")
            .replace(/&amp;/g, "&")
            .replace(/\\u0026/g, "&")
            .replace(/\\\//g, "/")
            .trim()
    );
}

function extractImageUrlMapFromRawHtml(rawHtml) {
    const byFileId = new Map();
    const orderedUrls = [];
    const seen = new Set();

    const push = (fileId, urlRaw) => {
        const url = decodeEscapedUrl(urlRaw).split("#")[0];
        if (!url.startsWith("http")) return;
        if (fileId && !byFileId.has(fileId)) {
            byFileId.set(fileId, url);
        }
        if (!seen.has(url)) {
            seen.add(url);
            orderedUrls.push(url);
        }
    };

    const attrRe = /data-imgfileid="(\d+)"[^>]*data-src="([^"]+)"/g;
    let m = null;
    while ((m = attrRe.exec(rawHtml)) !== null) {
        push(m[1], m[2]);
    }

    const jsonRe = /"imgfileid":"(\d+)"[\s\S]{0,800}?"cdn_url":"(https:\\\/\\\/[^\"]+)"/g;
    while ((m = jsonRe.exec(rawHtml)) !== null) {
        push(m[1], m[2]);
    }

    return { byFileId, orderedUrls };
}

async function warmImageCache(page, imageUrls) {
    const urls = imageUrls.filter((u) => u && u.startsWith("http"));
    if (urls.length === 0) return;

    await page.evaluate(async (list) => {
        await Promise.all(
            list.map(
                (url) =>
                    new Promise((resolve) => {
                        const img = new Image();
                        img.onload = () => resolve();
                        img.onerror = () => resolve();
                        img.src = url;
                    })
            )
        );
    }, urls);

    await new Promise((resolve) => setTimeout(resolve, 1200));
}

async function downloadImageWithHeaders(imgUrl, requestHeaders) {
    try {
        const resp = await fetch(imgUrl, {
            method: "GET",
            headers: requestHeaders,
            redirect: "follow",
        });
        if (!resp.ok) return null;

        const arrBuf = await resp.arrayBuffer();
        if (!arrBuf || arrBuf.byteLength === 0) return null;

        return {
            buffer: Buffer.from(arrBuf),
            contentType: resp.headers.get("content-type") || "",
        };
    } catch {
        return null;
    }
}

function watchImageResponses(page) {
    const cache = new Map();

    page.on("response", async (resp) => {
        const req = resp.request();
        if (req.resourceType() !== "image") return;

        const url = normalizeImgUrl(resp.url());
        if (!url || !url.startsWith("http")) return;

        try {
            const arrBuf = await resp.arrayBuffer();
            if (!arrBuf || arrBuf.byteLength === 0) return;

            const payload = {
                buffer: Buffer.from(arrBuf),
                contentType: resp.headers()["content-type"] || "",
            };

            cache.set(url, payload);
            const noQuery = url.split("?")[0];
            if (!cache.has(noQuery)) {
                cache.set(noQuery, payload);
            }
        } catch {
            // Ignore image capture failures.
        }
    });

    return cache;
}

function findImagePayload(cache, imgUrlRaw) {
    const imgUrl = normalizeImgUrl(imgUrlRaw);
    if (!imgUrl) return null;

    if (cache.has(imgUrl)) return cache.get(imgUrl);

    const noQuery = imgUrl.split("?")[0];
    if (cache.has(noQuery)) return cache.get(noQuery);

    return null;
}

async function saveImagesFromCapture(images, articleDir, imageCache, requestHeaders) {
    const imgDir = path.join(articleDir, "images");
    ensureDir(imgDir);

    for (const entry of fs.readdirSync(imgDir)) {
        fs.rmSync(path.join(imgDir, entry), { force: true, recursive: true });
    }

    const urlToLocal = new Map();
    let idx = 0;

    for (const imgUrlRaw of images) {
        const imgUrl = normalizeImgUrl(imgUrlRaw);
        if (!imgUrl || !imgUrl.startsWith("http")) continue;

        try {
            let payload = findImagePayload(imageCache, imgUrl);
            if (!payload) {
                payload = await downloadImageWithHeaders(imgUrl, requestHeaders);
            }
            if (!payload) continue;

            const ext = getExtFromContentType(payload.contentType || "");
            const fileName = `img_${String(idx).padStart(3, "0")}${ext}`;
            const localRelPath = `images/${fileName}`;
            const localAbsPath = path.join(articleDir, localRelPath);

            fs.writeFileSync(localAbsPath, payload.buffer);
            urlToLocal.set(imgUrl, localRelPath);
            const noQuery = imgUrl.split("?")[0];
            urlToLocal.set(noQuery, localRelPath);
            idx += 1;
        } catch {
            // Keep going when an image fails to download.
        }
    }

    return urlToLocal;
}

function replaceImageUrlsInHtml(contentHtml, urlToLocal) {
    let html = contentHtml || "";
    for (const [remote, local] of urlToLocal.entries()) {
        html = html.split(remote).join(local);
    }

    html = html.replace(/(src=['"]images\/[^'"]+?)\?[^'"]*(['"])/gi, "$1$2");
    html = html.replace(/(data-src=['"]images\/[^'"]+?)\?[^'"]*(['"])/gi, "$1$2");

    // Ensure offline file never tries to hit remote image URLs.
    html = html.replace(/\sdata-src=(['"])https?:\/\/[^'"]+\1/gi, "");
    html = html.replace(/\ssrc=(['"])https?:\/\/[^'"]+\1/gi, ' src=""');
    html = html.replace(/\ssrc=(['"])\/\/[^'"]+\1/gi, ' src=""');

    return html;
}

function buildOfflineHtml(meta, contentHtml) {
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${meta.title || "微信公众号文章"}</title>
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
  <h1>${meta.title || ""}</h1>
  <div class="meta">
    <div>公众号：${meta.account || ""}</div>
    <div>发布时间：${meta.publishTime || ""}</div>
    <div>原文链接：<a href="${meta.source || ""}">${meta.source || ""}</a></div>
  </div>
  <article>${contentHtml || ""}</article>
</body>
</html>`;
}

async function saveFromPage(page, url, baseOutputDir, imageCache) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector("#js_content, .rich_media_content", { timeout: 20000 });
    await page.waitForNetworkIdle({ idleTime: 1200, timeout: 20000 });

    const rawHtml = await page.content();
    const extracted = extractImageUrlMapFromRawHtml(rawHtml);
    await warmImageCache(page, extracted.orderedUrls);
    const imageMap = Object.fromEntries(extracted.byFileId.entries());

    const data = await page.evaluate((imgMap) => {
        const titleNode = document.querySelector("h1.rich_media_title") || document.querySelector("h1");
        const contentNode = document.querySelector("#js_content") || document.querySelector(".rich_media_content");
        const accountNode = document.querySelector("#js_name") || document.querySelector(".rich_media_meta_nickname");
        const authorNode = document.querySelector(".rich_media_meta_text");
        const publishNode = document.querySelector("#publish_time");

        const title = titleNode ? titleNode.textContent.trim() : "未知标题";
        const account = accountNode ? accountNode.textContent.trim() : "";
        const author = authorNode ? authorNode.textContent.trim() : "";
        const publishTime = publishNode ? publishNode.textContent.trim() : "";
        let contentHtml = "";
        const imgs = [];

        if (contentNode) {
            const cloned = contentNode.cloneNode(true);
            for (const img of cloned.querySelectorAll("img")) {
                let src = img.getAttribute("src") || "";
                if (!src || !src.startsWith("http")) {
                    const fileId = img.getAttribute("data-imgfileid") || "";
                    if (fileId && imgMap[fileId]) {
                        src = imgMap[fileId];
                    }
                }
                if (!src || !src.startsWith("http")) {
                    src = img.getAttribute("data-src") || "";
                }
                if (src.startsWith("//")) {
                    src = `https:${src}`;
                }
                if (src.startsWith("http")) {
                    src = src.replace(/&amp;/g, "&").split("#")[0];
                    imgs.push(src);
                    img.setAttribute("src", src);
                }
                img.removeAttribute("srcset");
                img.removeAttribute("data-src");
            }
            contentHtml = cloned.innerHTML;
        }

        return {
            title,
            account,
            author,
            publishTime,
            contentHtml,
            images: Array.from(new Set(imgs)),
            fullHtml: document.documentElement.outerHTML,
        };
    }, imageMap);

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

    const datePart = normalizeDateForId(meta.publishTime);
    const safeTitle = sanitizeName(data.title);
    const safeAccount = sanitizeName(meta.account || meta.author || "wechat");
    const articleDir = path.join(baseOutputDir, safeAccount, `${datePart}_${safeTitle || meta.articleId}`);
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
    const offlineHtml = buildOfflineHtml(meta, localContentHtml);
    const analysis = buildAnalysis(meta, localContentHtml);
    const markdown = buildMarkdown(meta, localContentHtml, analysis);
    const indexRecord = {
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

    fs.writeFileSync(path.join(articleDir, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");
    fs.writeFileSync(path.join(articleDir, "article_content.html"), localContentHtml || "", "utf-8");
    fs.writeFileSync(path.join(articleDir, "offline_article.html"), offlineHtml, "utf-8");
    fs.writeFileSync(path.join(articleDir, "raw_page.html"), rawHtml || data.fullHtml || "", "utf-8");
    fs.writeFileSync(path.join(articleDir, "article.md"), markdown, "utf-8");
    fs.writeFileSync(path.join(articleDir, "analysis.json"), JSON.stringify(analysis, null, 2), "utf-8");
    upsertIndexRecord(path.join(baseOutputDir, INDEX_FILE_NAME), indexRecord);

    return {
        articleDir,
        meta,
        analysis,
        downloadedImageCount: new Set(urlToLocal.values()).size,
    };
}

function watchCommentRequests(page) {
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

async function captureArticleToLocal(url, options = {}) {
    const outputDir = options.output ? path.resolve(options.output) : DEFAULT_OUTPUT_DIR;
    ensureDir(outputDir);

    const browser = await puppeteer.launch({
        headless: "new",
        defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true },
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent(MOBILE_WECHAT_UA);
        await page.setExtraHTTPHeaders({
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9",
        });

        const commentHits = watchCommentRequests(page);
        const imageCache = watchImageResponses(page);
        const { articleDir, meta, analysis, downloadedImageCount } = await saveFromPage(page, url, outputDir, imageCache);

        const screenshotPath = path.join(articleDir, "preview.png");
        await page.screenshot({ path: screenshotPath, fullPage: true });

        const commentLogPath = path.join(articleDir, "comment_requests.json");
        fs.writeFileSync(commentLogPath, JSON.stringify(commentHits, null, 2), "utf-8");

        return {
            articleDir,
            meta,
            analysis,
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

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const result = await captureArticleToLocal(args.url, { output: args.output });

    console.log("抓取完成");
    console.log(`目录: ${result.articleDir}`);
    console.log(`标题: ${result.meta.title}`);
    console.log(`已下载图片: ${result.downloadedImageCount}/${result.meta.imageCount}`);
    console.log(`离线文件: ${result.offlineHtmlPath}`);
    console.log(`Markdown文件: ${result.markdownPath}`);
    console.log(`评论接口观测记录: ${result.commentLogPath}`);
    console.log("说明: 该记录仅用于排查评论接口，默认不保证能直接拿到评论正文。");
}

function extractBizFromUrl(url) {
    try {
        return new URL(url).searchParams.get("__biz") || null;
    } catch {
        return null;
    }
}

function parseGetmsgResponse(rawText) {
    try {
        const outer = JSON.parse(rawText);
        if (outer.base_resp && outer.base_resp.ret !== 0) return { items: [], canContinue: false, nextOffset: 0 };
        const inner = JSON.parse(outer.general_msg_list || "{}");
        const list = inner.list || [];
        const items = [];
        for (const msg of list) {
            const ext = msg.app_msg_ext_info;
            if (!ext) continue;
            const pushArticle = (item) => {
                const rawUrl = (item.content_url || "").replace(/&amp;/g, "&");
                const title = (item.title || "").trim();
                if (!rawUrl || !title) return;
                items.push({
                    title,
                    url: rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl,
                    digest: (item.digest || "").trim(),
                    publishTime: msg.comm_msg_info ? String(msg.comm_msg_info.datetime || "") : "",
                    cover: (item.cover || "").replace(/&amp;/g, "&"),
                });
            };
            pushArticle(ext);
            for (const sub of ext.multi_app_msg_item_list || []) {
                pushArticle(sub);
            }
        }
        return {
            items,
            canContinue: outer.can_msg_continue === 1,
            nextOffset: outer.next_offset || 0,
        };
    } catch {
        return { items: [], canContinue: false, nextOffset: 0 };
    }
}

async function listAccountArticles(sourceUrl, options = {}) {
    const maxPages = options.maxPages || 6;

    const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent(MOBILE_WECHAT_UA);
        await page.setViewport({ width: 390, height: 844, isMobile: true });

        // Step 1: Resolve __biz
        let biz = extractBizFromUrl(sourceUrl);
        if (!biz) {
            // Follow redirect for short URLs
            const resp = await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
            if (resp) {
                biz = extractBizFromUrl(page.url());
            }
            if (!biz) {
                throw new Error(`无法从链接提取公众号标识 __biz：${sourceUrl}`);
            }
        }

        // Step 2: Collect getmsg API responses
        const collectedPages = [];

        const responseHandler = async (resp) => {
            const url = resp.url();
            if (!url.includes("profile_ext") || !url.includes("action=getmsg")) return;
            try {
                const text = await resp.text();
                collectedPages.push(text);
            } catch { /* ignore */ }
        };
        page.on("response", responseHandler);

        // Step 3: Load account homepage → triggers first getmsg call automatically
        const profileUrl = `https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=${encodeURIComponent(biz)}&scene=123&uin=777&key=777`;
        await page.goto(profileUrl, { waitUntil: "networkidle2", timeout: 30000 }).catch(() => { });
        await new Promise((r) => setTimeout(r, 1500));

        // Step 4: Scroll to trigger lazy-load pagination
        for (let i = 1; i < maxPages; i++) {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await new Promise((r) => setTimeout(r, 1800));
        }

        page.off("response", responseHandler);

        // Step 5: Merge and deduplicate results
        const allItems = [];
        const seenUrls = new Set();
        for (const raw of collectedPages) {
            const { items } = parseGetmsgResponse(raw);
            for (const item of items) {
                const key = item.url.split("&sn=")[0];
                if (!seenUrls.has(key)) {
                    seenUrls.add(key);
                    allItems.push(item);
                }
            }
        }

        // If getmsg interception returned nothing, fall back to DOM scraping
        if (allItems.length === 0) {
            const domItems = await page.evaluate(() => {
                const results = [];
                const boxes = document.querySelectorAll(".weui_media_box.appmsg, .wxmlplus-msg-card, li.album__item");
                for (const box of boxes) {
                    const a = box.querySelector("a[href*='mp.weixin.qq.com']") || box.closest("a[href*='mp.weixin.qq.com']");
                    const titleEl = box.querySelector("h4, .weui_media_title, .album__item-title");
                    if (!a || !titleEl) continue;
                    const url = a.href || "";
                    const title = titleEl.textContent.trim();
                    const dateEl = box.querySelector(".weui_media_date, .album__item-date");
                    const publishTime = dateEl ? dateEl.textContent.trim() : "";
                    if (url && title) results.push({ title, url, digest: "", publishTime, cover: "" });
                }
                return results;
            });
            for (const item of domItems) {
                allItems.push(item);
            }
        }

        return { biz, items: allItems };
    } finally {
        await browser.close();
    }
}

export { captureArticleToLocal, listAccountArticles, buildAnalysis, buildMarkdown, DEFAULT_OUTPUT_DIR, INDEX_FILE_NAME, normalizeIndexRecords };

if (process.argv[1] === __filename) {
    main().catch((err) => {
        console.error("执行失败:", err.message);
        process.exit(1);
    });
}
