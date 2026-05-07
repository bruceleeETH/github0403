import { MOBILE_WECHAT_UA } from "../config/constants.mjs";
import { extractBizFromUrl } from "../utils/url.mjs";
import { launchArticleBrowser } from "./browser-session.mjs";

export function parseGetmsgResponse(rawText) {
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

export async function listAccountArticles(sourceUrl, options = {}) {
    const maxPages = options.maxPages || 6;

    const browser = await launchArticleBrowser({
        headless: true,
        defaultViewport: undefined,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent(MOBILE_WECHAT_UA);
        await page.setViewport({ width: 390, height: 844, isMobile: true });

        let biz = extractBizFromUrl(sourceUrl);
        if (!biz) {
            const resp = await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
            if (resp) {
                biz = extractBizFromUrl(page.url());
            }
            if (!biz) {
                throw new Error(`无法从链接提取公众号标识 __biz：${sourceUrl}`);
            }
        }

        const collectedPages = [];
        const responseHandler = async (resp) => {
            const url = resp.url();
            if (!url.includes("profile_ext") || !url.includes("action=getmsg")) return;
            try {
                const text = await resp.text();
                collectedPages.push(text);
            } catch {
                // Ignore unreadable profile responses.
            }
        };
        page.on("response", responseHandler);

        const profileUrl = `https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=${encodeURIComponent(biz)}&scene=123&uin=777&key=777`;
        await page.goto(profileUrl, { waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 1500));

        for (let i = 1; i < maxPages; i += 1) {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await new Promise((resolve) => setTimeout(resolve, 1800));
        }

        page.off("response", responseHandler);

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

