import { loadLocalEnv } from "../config/env.mjs";
import { stripHtmlTags } from "../utils/text.mjs";

const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MAX_INPUT_CHARS = 32000;
const DEFAULT_MAX_TOKENS = 3200;
const DEFAULT_TIMEOUT_MS = 45000;

const SENTIMENT_VALUES = new Set(["positive", "neutral", "negative"]);
const MARKET_EMOTION_VALUES = new Set(["bullish", "neutral", "bearish", "mixed"]);
const RISK_VALUES = new Set(["low", "medium", "high", "unknown"]);
const HORIZON_VALUES = new Set(["intraday", "short_term", "mid_term", "long_term", "unknown"]);

function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
}

function toText(value, maxLength = 240) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeSentiment(value, fallback = "neutral") {
    const normalized = String(value || "").trim().toLowerCase();
    if (SENTIMENT_VALUES.has(normalized)) return normalized;
    if (/看多|乐观|积极|正面|利好|bull|positive/i.test(normalized)) return "positive";
    if (/看空|悲观|消极|负面|利空|bear|negative/i.test(normalized)) return "negative";
    return fallback;
}

function normalizeMarketEmotion(value, fallback = "neutral") {
    const normalized = String(value || "").trim().toLowerCase();
    if (MARKET_EMOTION_VALUES.has(normalized)) return normalized;
    if (/看多|乐观|积极|risk-on|bull/i.test(normalized)) return "bullish";
    if (/看空|悲观|谨慎|risk-off|bear/i.test(normalized)) return "bearish";
    if (/分歧|震荡|mixed/i.test(normalized)) return "mixed";
    return fallback;
}

function normalizeEnum(value, allowedValues, fallback) {
    const normalized = String(value || "").trim().toLowerCase();
    return allowedValues.has(normalized) ? normalized : fallback;
}

function normalizeStringArray(value, limit = 6, maxLength = 40) {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => toText(item, maxLength))
        .filter(Boolean)
        .slice(0, limit);
}

function normalizeKeywords(value, fallback = []) {
    const keywords = normalizeStringArray(value, 10, 24);
    return keywords.length ? keywords : normalizeStringArray(fallback, 10, 24);
}

function normalizeSectors(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => {
            if (typeof item === "string") {
                return { name: toText(item, 32), sentiment: "neutral", mentions: [], reason: "" };
            }
            return {
                name: toText(item?.name, 32),
                sentiment: normalizeSentiment(item?.sentiment),
                mentions: normalizeStringArray(item?.mentions, 4, 64),
                reason: toText(item?.reason, 180),
            };
        })
        .filter((item) => item.name)
        .slice(0, 12);
}

function normalizeStocks(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => {
            if (typeof item === "string") {
                return { name: toText(item, 32), code: "", sentiment: "neutral", mentions: [], reason: "" };
            }
            return {
                name: toText(item?.name, 32),
                code: toText(item?.code, 16),
                sentiment: normalizeSentiment(item?.sentiment),
                mentions: normalizeStringArray(item?.mentions, 4, 64),
                reason: toText(item?.reason, 180),
            };
        })
        .filter((item) => item.name || item.code)
        .slice(0, 20);
}

function normalizeViewpoints(value, fallback = []) {
    const source = Array.isArray(value) && value.length ? value : fallback;
    return source
        .map((item, index) => {
            if (typeof item === "string") {
                return {
                    id: `vp_${String(index + 1).padStart(3, "0")}`,
                    text: toText(item, 240),
                    evidence: "",
                    stance: "neutral",
                    confidence: 0.5,
                    related_sectors: [],
                    related_stocks: [],
                };
            }
            return {
                id: toText(item?.id, 24) || `vp_${String(index + 1).padStart(3, "0")}`,
                text: toText(item?.text, 260),
                evidence: toText(item?.evidence, 220),
                stance: normalizeMarketEmotion(item?.stance, "neutral"),
                confidence: clampNumber(item?.confidence, 0, 1, 0.5),
                related_sectors: normalizeStringArray(item?.related_sectors, 6, 32),
                related_stocks: normalizeStringArray(item?.related_stocks, 8, 32),
            };
        })
        .filter((item) => item.text)
        .slice(0, 8);
}

function buildSystemPrompt() {
    return [
        "你是一个中文财经文章结构化分析器，只能基于用户提供的文章内容提炼信息。",
        "请输出合法 JSON，不要输出 Markdown，不要输出解释文字。",
        "不要编造文章未出现的板块、个股、代码、观点或行情事实；没有出现就用空数组或 unknown。",
        "个股代码只有在原文明确出现时才填写，否则 code 为空字符串。",
        "sentiment 必须是 positive、neutral、negative 之一；market_emotion.label 必须是 bullish、neutral、bearish、mixed 之一。",
    ].join("\n");
}

function buildUserPrompt(meta, text) {
    const title = toText(meta.title, 120);
    const account = toText(meta.account || meta.author, 80);
    const publishTime = toText(meta.publishTime, 40);
    return [
        "请从下面微信公众号财经文章中提炼核心观点，并抽取出现的板块、个股、市场情绪等关键指标。",
        "请严格输出这个 JSON 结构：",
        JSON.stringify({
            summary: "120字以内摘要",
            keywords: ["关键词1", "关键词2"],
            sentiment: "positive|neutral|negative",
            market_emotion: {
                label: "bullish|neutral|bearish|mixed",
                intensity: 1,
                description: "一句话说明市场情绪",
            },
            viewpoints: [
                {
                    id: "vp_001",
                    text: "核心观点",
                    evidence: "原文依据或关键句概括",
                    stance: "bullish|neutral|bearish|mixed",
                    confidence: 0.5,
                    related_sectors: ["板块名"],
                    related_stocks: ["个股名"],
                },
            ],
            sectors: [
                {
                    name: "板块名",
                    sentiment: "positive|neutral|negative",
                    mentions: ["原文提到的关键词或短语"],
                    reason: "该板块被提及的原因",
                },
            ],
            stocks: [
                {
                    name: "个股名",
                    code: "股票代码或空字符串",
                    sentiment: "positive|neutral|negative",
                    mentions: ["原文提到的关键词或短语"],
                    reason: "该个股被提及的原因",
                },
            ],
            key_metrics: {
                importance_score: 1,
                risk_level: "low|medium|high|unknown",
                time_horizon: "intraday|short_term|mid_term|long_term|unknown",
            },
        }, null, 2),
        "",
        `标题：${title}`,
        `公众号：${account}`,
        `发布时间：${publishTime}`,
        "",
        "文章正文：",
        text,
    ].join("\n");
}

function parseJsonObject(content) {
    const text = String(content || "").trim();
    if (!text) throw new Error("DeepSeek 返回内容为空");

    try {
        return JSON.parse(text);
    } catch {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start >= 0 && end > start) {
            return JSON.parse(text.slice(start, end + 1));
        }
        throw new Error("DeepSeek 返回内容不是合法 JSON");
    }
}

export function getDeepSeekConfig(options = {}) {
    loadLocalEnv();
    const hasApiKeyOption = Object.prototype.hasOwnProperty.call(options, "apiKey");
    return {
        apiKey: hasApiKeyOption ? options.apiKey : (process.env.DEEPSEEK_API_KEY || ""),
        baseUrl: options.baseUrl || process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL,
        model: DEFAULT_MODEL,
        maxInputChars: Number(options.maxInputChars || process.env.DEEPSEEK_ANALYSIS_MAX_CHARS || DEFAULT_MAX_INPUT_CHARS),
        maxTokens: Number(options.maxTokens || process.env.DEEPSEEK_MAX_TOKENS || DEFAULT_MAX_TOKENS),
        timeoutMs: Number(options.timeoutMs || process.env.DEEPSEEK_API_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
        fetchImpl: options.fetchImpl || globalThis.fetch,
    };
}

export function isDeepSeekConfigured(options = {}) {
    return Boolean(getDeepSeekConfig(options).apiKey);
}

export function normalizeDeepSeekAnalysis(raw, { meta, fallbackAnalysis, model, usage } = {}) {
    const fallback = fallbackAnalysis || {};
    const marketEmotion = raw?.market_emotion || {};
    const keyMetrics = raw?.key_metrics || {};
    return {
        article_id: meta.articleId,
        title: meta.title,
        author: meta.author,
        account: meta.account,
        publish_time: meta.publishTime,
        source_url: meta.source,
        content_hash: meta.contentHash,
        summary: toText(raw?.summary, 260),
        keywords: normalizeKeywords(raw?.keywords),
        sentiment: normalizeSentiment(raw?.sentiment, "neutral"),
        market_emotion: {
            label: normalizeMarketEmotion(marketEmotion.label, "neutral"),
            intensity: clampNumber(marketEmotion.intensity, 1, 5, 3),
            description: toText(marketEmotion.description, 180),
        },
        viewpoints: normalizeViewpoints(raw?.viewpoints),
        sectors: normalizeSectors(raw?.sectors),
        stocks: normalizeStocks(raw?.stocks),
        key_metrics: {
            importance_score: clampNumber(keyMetrics.importance_score, 1, 10, 5),
            risk_level: normalizeEnum(keyMetrics.risk_level, RISK_VALUES, "unknown"),
            time_horizon: normalizeEnum(keyMetrics.time_horizon, HORIZON_VALUES, "unknown"),
        },
        paragraph_count: fallback.paragraph_count || 0,
        analysis_provider: "deepseek",
        analysis_model: model || DEFAULT_MODEL,
        analysis_schema_version: 2,
        usage: usage || null,
        generated_at: new Date().toISOString(),
    };
}

export async function analyzeWithDeepSeek(meta, contentHtml, options = {}) {
    const config = getDeepSeekConfig(options);
    if (!config.apiKey) throw new Error("缺少 DEEPSEEK_API_KEY");
    if (typeof config.fetchImpl !== "function") throw new Error("当前 Node 环境不支持 fetch");

    const text = stripHtmlTags(contentHtml).slice(0, config.maxInputChars);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
        const response = await config.fetchImpl(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
                model: config.model,
                messages: [
                    { role: "system", content: buildSystemPrompt() },
                    { role: "user", content: buildUserPrompt(meta, text) },
                ],
                response_format: { type: "json_object" },
                thinking: { type: "disabled" },
                temperature: 0.2,
                max_tokens: config.maxTokens,
                stream: false,
            }),
            signal: controller.signal,
        });

        const responseText = await response.text();
        let payload = null;
        try {
            payload = responseText ? JSON.parse(responseText) : null;
        } catch {
            throw new Error(`DeepSeek 返回非 JSON 响应，HTTP ${response.status}`);
        }

        if (!response.ok) {
            const message = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
            throw new Error(`DeepSeek 调用失败：${message}`);
        }

        const content = payload?.choices?.[0]?.message?.content;
        const rawAnalysis = parseJsonObject(content);
        return normalizeDeepSeekAnalysis(rawAnalysis, {
            meta,
            fallbackAnalysis: options.fallbackAnalysis,
            model: config.model,
            usage: payload?.usage || null,
        });
    } catch (error) {
        if (error?.name === "AbortError") {
            throw new Error(`DeepSeek 调用超时：${config.timeoutMs}ms`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}
