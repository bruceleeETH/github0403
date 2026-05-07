import { NEGATIVE_HINTS, POSITIVE_HINTS, STOP_WORDS } from "../config/constants.mjs";
import { splitParagraphs, stripHtmlTags } from "../utils/text.mjs";

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

export function buildAnalysis(meta, contentHtml) {
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
        viewpoints: buildViewpoints(paragraphs, keywords),
        paragraph_count: paragraphs.length,
        generated_at: new Date().toISOString(),
    };
}

