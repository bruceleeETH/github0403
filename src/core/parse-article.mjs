import { normalizeImgUrl } from "./image-cache.mjs";

function getTextBySelector(html, selectorPattern) {
    const match = html.match(selectorPattern);
    if (!match) return "";
    return match[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .trim();
}

function getHtmlBySelector(html, selectorPattern) {
    const match = html.match(selectorPattern);
    return match ? match[0] : "";
}

export async function extractArticleDataFromPage(page, imgMap = {}) {
    return page.evaluate((imageMap) => {
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
                    if (fileId && imageMap[fileId]) {
                        src = imageMap[fileId];
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
    }, imgMap);
}

export function parseArticleHtmlFixture(html, source = "") {
    const contentHtml = getHtmlBySelector(
        html,
        /<div[^>]+id=["']js_content["'][\s\S]*?<\/div>|<div[^>]+class=["'][^"']*rich_media_content[^"']*["'][\s\S]*?<\/div>/i
    );
    const images = [];
    for (const match of contentHtml.matchAll(/<img[^>]+(?:data-src|src)=["']([^"']+)["'][^>]*>/gi)) {
        const url = normalizeImgUrl(match[1]).replace(/&amp;/g, "&").split("#")[0];
        if (url.startsWith("http")) images.push(url);
    }

    return {
        title: getTextBySelector(html, /<h1[^>]*(?:class=["'][^"']*rich_media_title[^"']*["'])?[^>]*>([\s\S]*?)<\/h1>/i) || "未知标题",
        account: getTextBySelector(html, /<(?:a|span)[^>]+(?:id=["']js_name["']|class=["'][^"']*rich_media_meta_nickname[^"']*["'])[^>]*>([\s\S]*?)<\/(?:a|span)>/i),
        author: getTextBySelector(html, /<span[^>]+class=["'][^"']*rich_media_meta_text[^"']*["'][^>]*>([\s\S]*?)<\/span>/i),
        publishTime: getTextBySelector(html, /<(?:em|span)[^>]+id=["']publish_time["'][^>]*>([\s\S]*?)<\/(?:em|span)>/i),
        contentHtml,
        images: Array.from(new Set(images)),
        fullHtml: html,
        source,
    };
}

