import { NEGATIVE_HINTS, POSITIVE_HINTS, STOP_WORDS } from "../config/constants.mjs";
import { splitParagraphs, stripHtmlTags } from "../utils/text.mjs";
import { analyzeWithDeepSeek, getDeepSeekConfig, isDeepSeekConfigured } from "./deepseek-analyzer.mjs";

export function extractKeywords(text) {
    const tokens = text.match(/[\p{Script=Han}]{2,8}|[A-Za-z][A-Za-z0-9_-]{2,}/gu) || [];
    const counts = new Map();
    for (const token of tokens) {
        const normalized = token.trim().toLowerCase();
        if (normalized.length < 2) continue;
        if (STOP_WORDS.has(normalized)) continue;
        counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
    return [...counts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 8)
        .map(([token]) => token);
}

export function inferSentiment(text) {
    const source = text || "";
    let positiveScore = 0;
    let negativeScore = 0;
    for (const hint of POSITIVE_HINTS) {
        if (source.includes(hint)) positiveScore += 1;
    }
    for (const hint of NEGATIVE_HINTS) {
        if (source.includes(hint)) negativeScore += 1;
    }
    if (negativeScore > positiveScore) return "negative";
    if (positiveScore > negativeScore) return "positive";
    return "neutral";
}

export function buildSummary(paragraphs) {
    return paragraphs.slice(0, 3).join(" ").slice(0, 220);
}

export function buildViewpoints(paragraphs, keywords) {
    return paragraphs.slice(0, 5).map((paragraph, index) => ({
        id: `vp_${String(index + 1).padStart(3, "0")}`,
        text: paragraph.slice(0, 180),
        keywords: keywords.filter((keyword) => paragraph.includes(keyword)).slice(0, 3),
    }));
}

export function buildRuleBasedAnalysis(meta, contentHtml) {
    const text = stripHtmlTags(contentHtml);
    const paragraphs = splitParagraphs(contentHtml);
    const keywords = extractKeywords(text);
    const sentiment = inferSentiment(text);
    const summary = buildSummary(paragraphs);

    return {
        article_id: meta.articleId,
        title: meta.title,
        author: meta.author,
        account: meta.account,
        publish_time: meta.publishTime,
        source_url: meta.source,
        content_hash: meta.contentHash,
        summary,
        keywords,
        sentiment,
        market_emotion: {
            label: sentiment === "positive" ? "bullish" : sentiment === "negative" ? "bearish" : "neutral",
            intensity: sentiment === "neutral" ? 2 : 3,
            description: "",
        },
        viewpoints: buildViewpoints(paragraphs, keywords),
        sectors: [],
        stocks: [],
        key_metrics: {
            importance_score: 5,
            risk_level: sentiment === "negative" ? "medium" : "unknown",
            time_horizon: "unknown",
        },
        paragraph_count: paragraphs.length,
        analysis_provider: "rule",
        analysis_model: "local-rules-v1",
        analysis_schema_version: 2,
        generated_at: new Date().toISOString(),
    };
}

export function buildAnalysis(meta, contentHtml) {
    return buildRuleBasedAnalysis(meta, contentHtml);
}

export function isModelAnalysis(analysis) {
    const provider = String(analysis?.analysis_provider || "");
    const model = String(analysis?.analysis_model || "");
    return Boolean(provider && model && provider !== "rule" && analysis?.analysis_status !== "failed");
}

export function buildPendingModelAnalysis(meta, contentHtml, reason = "未配置模型分析") {
    const paragraphs = splitParagraphs(contentHtml);
    return {
        article_id: meta.articleId,
        title: meta.title,
        author: meta.author,
        account: meta.account,
        publish_time: meta.publishTime,
        source_url: meta.source,
        content_hash: meta.contentHash,
        summary: "",
        keywords: [],
        sentiment: "neutral",
        market_emotion: {
            label: "neutral",
            intensity: 0,
            description: "",
        },
        viewpoints: [],
        sectors: [],
        stocks: [],
        key_metrics: {
            importance_score: 0,
            risk_level: "unknown",
            time_horizon: "unknown",
        },
        paragraph_count: paragraphs.length,
        analysis_status: "pending",
        analysis_provider: "",
        analysis_model: "",
        analysis_schema_version: 2,
        analysis_note: reason,
        generated_at: new Date().toISOString(),
    };
}

export function buildEmptyAnalysisFromMeta(meta, reason = "该文章尚未进行模型分析") {
    return buildPendingModelAnalysis(meta, "", reason);
}

export function sanitizeModelAnalysis(meta, analysis) {
    if (isModelAnalysis(analysis)) return analysis;
    return {
        ...buildEmptyAnalysisFromMeta(meta, "旧版规则分析已清除，可点击立刻分析使用模型重新提炼"),
        generated_at: analysis?.generated_at || new Date().toISOString(),
        previous_analysis_provider: analysis?.analysis_provider || "legacy-rule",
    };
}

export async function analyzeArticle(meta, contentHtml, options = {}) {
    const fallbackAnalysis = buildRuleBasedAnalysis(meta, contentHtml);

    if (!isDeepSeekConfigured(options.deepseek)) {
        return buildPendingModelAnalysis(meta, contentHtml, "未配置 DEEPSEEK_API_KEY，尚未进行模型分析");
    }

    try {
        return await analyzeWithDeepSeek(meta, contentHtml, {
            ...options.deepseek,
            fallbackAnalysis,
        });
    } catch (error) {
        const config = getDeepSeekConfig(options.deepseek);
        return {
            ...buildPendingModelAnalysis(meta, contentHtml, "DeepSeek 模型分析失败"),
            analysis_status: "failed",
            llm_fallback: {
                provider: "deepseek",
                model: config.model,
                reason: error.message || "DeepSeek 分析失败",
                occurred_at: new Date().toISOString(),
            },
        };
    }
}
