export function isWeChatArticleUrl(value) {
    try {
        const url = new URL(String(value));
        return url.protocol === "https:" && url.hostname === "mp.weixin.qq.com";
    } catch {
        return false;
    }
}

export function assertWeChatArticleUrl(value) {
    if (!isWeChatArticleUrl(value)) {
        throw new Error("仅支持 mp.weixin.qq.com 文章链接");
    }
}

export function extractBizFromUrl(value) {
    try {
        return new URL(value).searchParams.get("__biz") || null;
    } catch {
        return null;
    }
}

