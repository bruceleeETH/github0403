import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeArticleFiles } from "../../src/core/export-article.mjs";

test("writeArticleFiles exports the expected article artifact structure", (t) => {
    const articleDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-export-"));
    t.after(() => fs.rmSync(articleDir, { recursive: true, force: true }));

    const meta = {
        articleId: "20260507_fixture_deadbeef",
        title: "测试文章：市场机会与风险",
        account: "测试公众号",
        author: "测试作者",
        publishTime: "2026年5月7日",
        source: "https://mp.weixin.qq.com/s/test",
        contentHash: "deadbeef",
        savedAt: "2026-05-07T00:00:00.000Z",
    };
    const analysis = {
        article_id: meta.articleId,
        summary: "市场机会与风险并存。",
        sentiment: "neutral",
        keywords: ["机会", "风险"],
    };
    const files = writeArticleFiles({
        articleDir,
        meta,
        analysis,
        localContentHtml: "<p>市场机会与风险并存。</p>",
        rawHtml: "<html><body>raw page</body></html>",
    });

    assert.deepEqual(Object.keys(files).sort(), [
        "analysis",
        "articleContent",
        "markdown",
        "meta",
        "offlineHtml",
        "rawPage",
    ]);
    assert.equal(JSON.parse(fs.readFileSync(files.meta, "utf-8")).articleId, meta.articleId);
    assert.equal(JSON.parse(fs.readFileSync(files.analysis, "utf-8")).sentiment, "neutral");
    assert.equal(fs.readFileSync(files.articleContent, "utf-8"), "<p>市场机会与风险并存。</p>");
    assert.match(fs.readFileSync(files.markdown, "utf-8"), /## 自动分析/);
    assert.match(fs.readFileSync(files.offlineHtml, "utf-8"), /<article><p>市场机会与风险并存。<\/p><\/article>/);
    assert.match(fs.readFileSync(files.rawPage, "utf-8"), /raw page/);
});
