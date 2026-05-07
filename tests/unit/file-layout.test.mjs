import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildArticleId, buildIndexRecord, resolveArticleDir } from "../../src/storage/file-layout.mjs";

test("buildArticleId is stable for the same metadata and content", () => {
    const meta = {
        publishTime: "2026年5月7日",
        account: "测试公众号",
        source: "https://mp.weixin.qq.com/s/test",
    };
    assert.equal(buildArticleId(meta, "content"), buildArticleId(meta, "content"));
    assert.match(buildArticleId(meta, "content"), /^20260507_/);
});

test("resolveArticleDir and buildIndexRecord keep current file layout", () => {
    const base = "/tmp/wechat";
    const meta = {
        articleId: "20260507_test_deadbeef",
        title: "标题/非法字符",
        author: "作者",
        account: "公众号",
        publishTime: "2026年5月7日",
        source: "https://mp.weixin.qq.com/s/test",
        contentHash: "deadbeef",
        savedAt: "2026-05-07T00:00:00.000Z",
    };
    const analysis = { keywords: ["机会"], sentiment: "neutral" };
    const articleDir = resolveArticleDir(base, meta);
    const record = buildIndexRecord(base, articleDir, meta, analysis);

    assert.equal(articleDir, path.join(base, "公众号", "2026-05-07_标题非法字符"));
    assert.equal(record.markdown_file, path.join("公众号", "2026-05-07_标题非法字符", "article.md"));
});

