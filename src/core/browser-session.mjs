import puppeteer from "puppeteer";
import { MOBILE_WECHAT_UA } from "../config/constants.mjs";

export async function launchArticleBrowser(options = {}) {
    return puppeteer.launch({
        headless: options.headless ?? "new",
        defaultViewport: options.defaultViewport ?? { width: 390, height: 844, isMobile: true, hasTouch: true },
        args: options.args,
    });
}

export async function prepareArticlePage(browser, options = {}) {
    const page = await browser.newPage();
    await page.setUserAgent(options.userAgent || MOBILE_WECHAT_UA);
    if (options.viewport) {
        await page.setViewport(options.viewport);
    }
    await page.setExtraHTTPHeaders({
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        ...(options.extraHTTPHeaders || {}),
    });
    return page;
}

export async function withArticlePage(callback, options = {}) {
    const browser = await launchArticleBrowser(options.launchOptions || options);
    try {
        const page = await prepareArticlePage(browser, options.pageOptions || {});
        return await callback(page, browser);
    } finally {
        await browser.close();
    }
}

