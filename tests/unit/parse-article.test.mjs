import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseArticleHtmlFixture } from "../../src/core/parse-article.mjs";

test("parseArticleHtmlFixture extracts stable article fields from local html", () => {
    const html = fs.readFileSync(new URL("../fixtures/wechat-article.html", import.meta.url), "utf-8");
    const article = parseArticleHtmlFixture(html, "https://mp.weixin.qq.com/s/test");

    assert.equal(article.title, "测试文章：市场机会与风险");
    assert.equal(article.account, "测试公众号");
    assert.equal(article.author, "测试作者");
    assert.equal(article.publishTime, "2026年5月7日");
    assert.equal(article.images.length, 1);
    assert.equal(article.source, "https://mp.weixin.qq.com/s/test");
});

