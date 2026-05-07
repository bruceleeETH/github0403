import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeName, slugify } from "../../src/utils/sanitize.mjs";
import { assertWeChatArticleUrl, extractBizFromUrl, isWeChatArticleUrl } from "../../src/utils/url.mjs";

test("sanitizeName keeps readable names while removing path separators", () => {
    assert.equal(sanitizeName(" 标题/非法:字符  "), "标题非法字符");
});

test("slugify keeps Chinese and ascii tokens", () => {
    assert.equal(slugify("测试 Account 123!!!"), "测试-account-123");
});

test("WeChat URL validation is hostname-based", () => {
    assert.equal(isWeChatArticleUrl("https://mp.weixin.qq.com/s/test"), true);
    assert.equal(isWeChatArticleUrl("https://mp.weixin.qq.com.evil/s/test"), false);
    assert.equal(isWeChatArticleUrl("http://mp.weixin.qq.com/s/test"), false);
    assert.throws(() => assertWeChatArticleUrl("https://mp.weixin.qq.com.evil/s/test"), /仅支持/);
});

test("extractBizFromUrl returns __biz when present", () => {
    assert.equal(extractBizFromUrl("https://mp.weixin.qq.com/s/test?__biz=abc"), "abc");
});

