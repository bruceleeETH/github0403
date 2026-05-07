import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalysis, extractKeywords, inferSentiment } from "../../src/core/analyze-article.mjs";

test("extractKeywords counts repeated meaningful tokens", () => {
    const keywords = extractKeywords("机会 机会 风险 风险 风险 Alpha alpha 今天 我们");
    assert.equal(keywords[0], "风险");
    assert.ok(keywords.includes("机会"));
    assert.ok(keywords.includes("alpha"));
    assert.ok(!keywords.includes("今天"));
});

test("inferSentiment compares positive and negative hints", () => {
    assert.equal(inferSentiment("市场反弹并且走强，机会改善"), "positive");
    assert.equal(inferSentiment("风险增加，担忧下跌和杀跌"), "negative");
    assert.equal(inferSentiment("这是一段普通文字"), "neutral");
});

test("buildAnalysis returns the existing rule-based article shape", () => {
    const meta = {
        articleId: "20260507_test_deadbeef",
        title: "测试文章",
        author: "测试作者",
        account: "测试公众号",
        publishTime: "2026年5月7日",
        source: "https://mp.weixin.qq.com/s/test",
        contentHash: "deadbeef",
    };
    const analysis = buildAnalysis(meta, "<p>市场反弹带来机会，改善正在出现。</p><p>风险也需要持续跟踪和复盘。</p>");

    assert.equal(analysis.article_id, meta.articleId);
    assert.equal(analysis.sentiment, "positive");
    assert.equal(analysis.paragraph_count, 2);
    assert.equal(analysis.viewpoints.length, 2);
});
