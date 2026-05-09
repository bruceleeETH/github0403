import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "../storage/paths.mjs";

export function getExtFromContentType(contentType) {
    if (!contentType) return ".jpg";
    if (contentType.includes("png")) return ".png";
    if (contentType.includes("gif")) return ".gif";
    if (contentType.includes("webp")) return ".webp";
    if (contentType.includes("svg")) return ".svg";
    return ".jpg";
}

export function normalizeImgUrl(url) {
    if (!url) return "";
    if (url.startsWith("//")) return `https:${url}`;
    return url;
}

export function decodeEscapedUrl(raw) {
    return normalizeImgUrl(
        (raw || "")
            .replace(/&amp;/g, "&")
            .replace(/\\u0026/g, "&")
            .replace(/\\\//g, "/")
            .trim()
    );
}

export function extractImageUrlMapFromRawHtml(rawHtml) {
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

    const jsonRe = /"imgfileid":"(\d+)"[\s\S]{0,800}?"cdn_url":"(https:\\\/\\\/[^"]+)"/g;
    while ((m = jsonRe.exec(rawHtml)) !== null) {
        push(m[1], m[2]);
    }

    return { byFileId, orderedUrls };
}

export async function warmImageCache(page, imageUrls) {
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

export async function downloadImageWithHeaders(imgUrl, requestHeaders) {
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

export function watchImageResponses(page) {
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

export function findImagePayload(cache, imgUrlRaw) {
    const imgUrl = normalizeImgUrl(imgUrlRaw);
    if (!imgUrl) return null;

    if (cache.has(imgUrl)) return cache.get(imgUrl);

    const noQuery = imgUrl.split("?")[0];
    if (cache.has(noQuery)) return cache.get(noQuery);

    return null;
}

export async function saveImagesFromCapture(images, articleDir, imageCache, requestHeaders, options = {}) {
    const imgDir = path.join(articleDir, "images");
    ensureDir(imgDir);

    for (const entry of fs.readdirSync(imgDir)) {
        fs.rmSync(path.join(imgDir, entry), { force: true, recursive: true });
    }

    const urlToLocal = new Map();
    const diagnostics = options.diagnostics || null;
    let idx = 0;

    for (const imgUrlRaw of images) {
        const imgUrl = normalizeImgUrl(imgUrlRaw);
        if (!imgUrl || !imgUrl.startsWith("http")) continue;

        try {
            let payload = findImagePayload(imageCache, imgUrl);
            let source = payload ? "browser-cache" : "download";
            if (!payload) {
                payload = await downloadImageWithHeaders(imgUrl, requestHeaders);
            }
            if (!payload) {
                diagnostics?.images.failed.push({
                    url: imgUrl,
                    reason: "图片未能从浏览器缓存或 HTTP 下载中读取",
                });
                continue;
            }

            const ext = getExtFromContentType(payload.contentType || "");
            const fileName = `img_${String(idx).padStart(3, "0")}${ext}`;
            const localRelPath = `images/${fileName}`;
            const localAbsPath = path.join(articleDir, localRelPath);

            fs.writeFileSync(localAbsPath, payload.buffer);
            diagnostics?.images.saved.push({
                url: imgUrl,
                file: localRelPath,
                content_type: payload.contentType || "",
                bytes: payload.buffer.length,
                source,
            });
            urlToLocal.set(imgUrl, localRelPath);
            const noQuery = imgUrl.split("?")[0];
            urlToLocal.set(noQuery, localRelPath);
            idx += 1;
        } catch (error) {
            diagnostics?.images.failed.push({
                url: imgUrl,
                reason: error.message || "图片保存失败",
            });
        }
    }

    return urlToLocal;
}

export function replaceImageUrlsInHtml(contentHtml, urlToLocal) {
    let html = contentHtml || "";
    for (const [remote, local] of urlToLocal.entries()) {
        html = html.split(remote).join(local);
    }

    html = html.replace(/(src=['"]images\/[^'"]+?)\?[^'"]*(['"])/gi, "$1$2");
    html = html.replace(/(data-src=['"]images\/[^'"]+?)\?[^'"]*(['"])/gi, "$1$2");
    html = html.replace(/\sdata-src=(['"])https?:\/\/[^'"]+\1/gi, "");
    html = html.replace(/\ssrc=(['"])https?:\/\/[^'"]+\1/gi, ' src=""');
    html = html.replace(/\ssrc=(['"])\/\/[^'"]+\1/gi, ' src=""');

    return html;
}
