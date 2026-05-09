import test from "node:test";
import assert from "node:assert/strict";
import { analyzeArticle, buildAnalysis, extractKeywords, inferSentiment, sanitizeModelAnalysis } from "../../src/core/analyze-article.mjs";

const meta = {
    articleId: "20260507_test_deadbeef",
    title: "测试文章",
    author: "测试作者",
    account: "测试公众号",
    publishTime: "2026年5月7日",
    source: "https://mp.weixin.qq.com/s/test",
    contentHash: "deadbeef",
};

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
    const analysis = buildAnalysis(meta, "<p>市场反弹带来机会，改善正在出现。</p><p>风险也需要持续跟踪和复盘。</p>");

    assert.equal(analysis.article_id, meta.articleId);
    assert.equal(analysis.sentiment, "positive");
    assert.equal(analysis.paragraph_count, 2);
    assert.equal(analysis.viewpoints.length, 2);
    assert.equal(analysis.analysis_provider, "rule");
});

test("analyzeArticle uses DeepSeek JSON output when configured", async () => {
    let requestBody = null;
    const fetchImpl = async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
                choices: [{
                    message: {
                        content: JSON.stringify({
                            summary: "文章认为半导体板块风险偏好修复。",
                            keywords: ["半导体", "风险偏好"],
                            sentiment: "positive",
                            market_emotion: { label: "bullish", intensity: 4, description: "情绪偏积极" },
                            viewpoints: [{
                                id: "vp_001",
                                text: "资金开始关注半导体反弹。",
                                evidence: "原文提到半导体走强",
                                stance: "bullish",
                                confidence: 0.8,
                                related_sectors: ["半导体"],
                                related_stocks: ["中芯国际"],
                            }],
                            sectors: [{
                                name: "半导体",
                                sentiment: "positive",
                                mentions: ["半导体走强"],
                                reason: "原文作为主线提及",
                            }],
                            stocks: [{
                                name: "中芯国际",
                                code: "688981",
                                sentiment: "positive",
                                mentions: ["中芯国际"],
                                reason: "作为代表个股出现",
                            }],
                            key_metrics: {
                                importance_score: 8,
                                risk_level: "medium",
                                time_horizon: "short_term",
                            },
                        }),
                    },
                }],
                usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 },
            }),
        };
    };

    const analysis = await analyzeArticle(meta, "<p>半导体走强，中芯国际出现反弹。</p>", {
        deepseek: { apiKey: "test-key", fetchImpl },
    });

    assert.equal(requestBody.model, "deepseek-v4-flash");
    assert.deepEqual(requestBody.response_format, { type: "json_object" });
    assert.equal(requestBody.thinking.type, "disabled");
    assert.equal(analysis.analysis_provider, "deepseek");
    assert.equal(analysis.analysis_model, "deepseek-v4-flash");
    assert.equal(analysis.sectors[0].name, "半导体");
    assert.equal(analysis.stocks[0].code, "688981");
    assert.equal(analysis.market_emotion.label, "bullish");
    assert.equal(analysis.usage.total_tokens, 180);
});

test("analyzeArticle allows overriding DeepSeek model", async () => {
    let requestBody = null;
    const analysis = await analyzeArticle(meta, "<p>半导体走强。</p>", {
        deepseek: {
            apiKey: "test-key",
            model: "deepseek-custom",
            fetchImpl: async (_url, options) => {
                requestBody = JSON.parse(options.body);
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        choices: [{ message: { content: JSON.stringify({ summary: "测试摘要" }) } }],
                    }),
                };
            },
        },
    });

    assert.equal(requestBody.model, "deepseek-custom");
    assert.equal(analysis.analysis_model, "deepseek-custom");
});

test("analyzeArticle marks analysis as failed when DeepSeek fails", async () => {
    const analysis = await analyzeArticle(meta, "<p>市场反弹带来机会，改善正在出现。</p>", {
        deepseek: {
            apiKey: "test-key",
            fetchImpl: async () => ({
                ok: false,
                status: 401,
                text: async () => JSON.stringify({ error: { message: "bad key" } }),
            }),
        },
    });

    assert.equal(analysis.analysis_status, "failed");
    assert.equal(analysis.analysis_provider, "");
    assert.equal(analysis.summary, "");
    assert.equal(analysis.llm_fallback.provider, "deepseek");
    assert.match(analysis.llm_fallback.reason, /bad key/);
});

test("analyzeArticle marks analysis as pending when DeepSeek is not configured", async () => {
    const analysis = await analyzeArticle(meta, "<p>市场反弹带来机会，改善正在出现。</p>", {
        deepseek: { apiKey: "" },
    });

    assert.equal(analysis.analysis_status, "pending");
    assert.equal(analysis.analysis_provider, "");
    assert.deepEqual(analysis.keywords, []);
    assert.match(analysis.analysis_note, /DEEPSEEK_API_KEY/);
});

test("sanitizeModelAnalysis clears legacy rule analysis", () => {
    const analysis = sanitizeModelAnalysis(meta, {
        summary: "旧摘要",
        sentiment: "positive",
        keywords: ["旧关键词"],
        viewpoints: [{ text: "旧观点" }],
    });

    assert.equal(analysis.analysis_status, "pending");
    assert.equal(analysis.summary, "");
    assert.deepEqual(analysis.keywords, []);
    assert.equal(analysis.previous_analysis_provider, "legacy-rule");
});
