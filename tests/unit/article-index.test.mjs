import test from "node:test";
import assert from "node:assert/strict";
import { cleanAuthorName, normalizeAuthorName, normalizeIndexRecords } from "../../src/storage/article-index.mjs";

test("cleanAuthorName collapses repeated author text from real WeChat pages", () => {
    assert.equal(cleanAuthorName("五老板\n                    五老板", "盘口逻辑拆解", "2026年5月6日"), "五老板");
});

test("normalizeAuthorName falls back to account when author is empty or date-like", () => {
    assert.equal(normalizeAuthorName("", "公众号", "2026年5月7日"), "公众号");
    assert.equal(normalizeAuthorName("2026年5月7日", "公众号", "2026年5月7日"), "公众号");
    assert.equal(normalizeAuthorName("作者甲", "公众号", "2026年5月7日"), "作者甲");
});

test("normalizeIndexRecords deduplicates and keeps richer records", () => {
    const records = normalizeIndexRecords([
        {
            article_id: "a1",
            title: "旧",
            author: "2026年5月7日",
            account: "公众号",
            publish_time: "2026年5月7日",
            source_url: "https://mp.weixin.qq.com/s/a",
            captured_at: "2026-05-07T01:00:00.000Z",
        },
        {
            article_id: "a1",
            title: "新",
            author: "作者",
            account: "公众号",
            publish_time: "2026年5月7日",
            source_url: "https://mp.weixin.qq.com/s/a",
            captured_at: "2026-05-07T00:00:00.000Z",
            keywords: ["机会"],
            markdown_file: "a/article.md",
        },
    ]);

    assert.equal(records.length, 1);
    assert.equal(records[0].title, "新");
    assert.equal(records[0].author, "作者");
});
