const VALID_RANGES = new Set(["today", "3d", "7d", "30d", "all"]);
const VALID_SORTS = new Set(["heat", "latest", "articles", "authors", "stocks"]);

const BUILTIN_ALIASES = new Map([
    ["算力", "AI算力"],
    ["ai算力", "AI算力"],
    ["液冷服务器", "AI算力"],
    ["光模块", "CPO"],
    ["cpo", "CPO"],
    ["半导体设备", "半导体"],
    ["芯片", "半导体"],
    ["机器人", "机器人"],
    ["人形机器人", "机器人"],
]);

function toText(value, maxLength = 80) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function compactKey(value) {
    return String(value || "").replace(/\s+/g, "").trim().toLowerCase();
}

function normalizeSectorName(value) {
    const raw = toText(typeof value === "string" ? value : value?.name, 40);
    if (!raw) return "";
    const alias = BUILTIN_ALIASES.get(compactKey(raw));
    return alias || raw;
}

function normalizeDateKey(value) {
    const text = String(value || "");
    const chineseMatch = text.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    if (chineseMatch) {
        const [, year, month, day] = chineseMatch;
        return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
    const isoMatch = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) {
        const [, year, month, day] = isoMatch;
        return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
    return "";
}

function formatDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function rangeStartKey(range, now) {
    if (range === "today") return formatDateKey(now);
    if (range === "3d") return formatDateKey(addDays(now, -2));
    if (range === "7d") return formatDateKey(addDays(now, -6));
    if (range === "30d") return formatDateKey(addDays(now, -29));
    return "";
}

function isWithinRange(dateKey, range, now) {
    if (range === "all") return true;
    if (!dateKey) return false;
    const today = formatDateKey(now);
    const start = rangeStartKey(range, now);
    return dateKey >= start && dateKey <= today;
}

function normalizeSectorItem(item) {
    if (typeof item === "string") {
        return {
            name: normalizeSectorName(item),
            sentiment: "neutral",
            mentions: [],
            reason: "",
        };
    }

    return {
        name: normalizeSectorName(item),
        sentiment: toText(item?.sentiment || "neutral", 16) || "neutral",
        mentions: Array.isArray(item?.mentions) ? item.mentions.map((text) => toText(text, 64)).filter(Boolean).slice(0, 6) : [],
        reason: toText(item?.reason, 180),
    };
}

function normalizeStockLabel(item) {
    if (typeof item === "string") return toText(item, 40);
    const name = toText(item?.name, 32);
    const code = toText(item?.code, 16);
    if (name && code) return `${name}(${code})`;
    return name || code;
}

function extractSectorNames(record) {
    const names = [];
    for (const sector of record.sectors || []) {
        const name = normalizeSectorName(sector);
        if (name) names.push(name);
    }
    return [...new Set(names)];
}

function sectorMatchesViewpoint(sectorName, viewpoint = {}) {
    const relatedSectors = Array.isArray(viewpoint.related_sectors) ? viewpoint.related_sectors : [];
    return relatedSectors.some((name) => normalizeSectorName(name) === sectorName);
}

function buildArticleSectorEvents(records, options = {}) {
    const range = VALID_RANGES.has(options.range) ? options.range : "7d";
    const now = options.now || new Date();
    const events = [];

    for (const record of records) {
        const analysis = record.analysis || {};
        const dateKey = normalizeDateKey(record.publish_time || analysis.publish_time || record.captured_at);
        if (!isWithinRange(dateKey, range, now)) continue;

        const sectors = Array.isArray(analysis.sectors) && analysis.sectors.length
            ? analysis.sectors.map(normalizeSectorItem).filter((sector) => sector.name)
            : extractSectorNames(record).map((name) => ({ name, sentiment: record.sentiment || "neutral", mentions: [], reason: "" }));

        const stocks = Array.isArray(analysis.stocks) ? analysis.stocks.map(normalizeStockLabel).filter(Boolean) : (record.stocks || []);
        const viewpoints = Array.isArray(analysis.viewpoints) ? analysis.viewpoints : [];

        for (const sector of sectors) {
            events.push({
                sector_name: sector.name,
                date: dateKey,
                article_id: record.article_id,
                title: record.title,
                author: record.author || record.account,
                account: record.account,
                publish_time: record.publish_time,
                source_url: record.source_url,
                sentiment: sector.sentiment || record.sentiment || "neutral",
                mentions: sector.mentions || [],
                reason: sector.reason || "",
                importance_score: Number(analysis.key_metrics?.importance_score || 0),
                market_emotion: analysis.market_emotion || null,
                related_stocks: stocks,
                viewpoints: viewpoints
                    .filter((viewpoint) => sectorMatchesViewpoint(sector.name, viewpoint) || String(viewpoint.text || "").includes(sector.name))
                    .map((viewpoint) => ({
                        id: viewpoint.id || "",
                        text: toText(viewpoint.text, 220),
                        evidence: toText(viewpoint.evidence, 180),
                        stance: viewpoint.stance || "",
                        confidence: Number(viewpoint.confidence || 0),
                    }))
                    .slice(0, 4),
            });
        }
    }

    return events.sort((left, right) =>
        String(right.publish_time || right.date || "").localeCompare(String(left.publish_time || left.date || ""))
    );
}

function calculateHeatScore(summary, now) {
    const latestDate = summary.latest_date || "";
    const today = formatDateKey(now);
    const recentBoost = latestDate === today ? 12 : 0;
    const averageImportance = summary.importance_total / Math.max(1, summary.article_ids.size);
    const positiveBoost = (summary.sentiments.positive || 0) * 1.2;
    const negativeBoost = (summary.sentiments.negative || 0) * 0.6;
    return Math.round(
        summary.article_ids.size * 3 +
        summary.authors.size * 4 +
        summary.stocks.size * 1.5 +
        averageImportance * 1.5 +
        recentBoost +
        positiveBoost +
        negativeBoost
    );
}

function summarizeEvents(events, options = {}) {
    const now = options.now || new Date();
    const bySector = new Map();

    for (const event of events) {
        if (!bySector.has(event.sector_name)) {
            bySector.set(event.sector_name, {
                sector_id: encodeURIComponent(event.sector_name),
                name: event.sector_name,
                mention_count: 0,
                article_ids: new Set(),
                authors: new Set(),
                stocks: new Set(),
                sentiments: { positive: 0, neutral: 0, negative: 0 },
                importance_total: 0,
                latest_publish_time: "",
                latest_date: "",
                timeline: [],
            });
        }

        const summary = bySector.get(event.sector_name);
        summary.mention_count += 1;
        summary.article_ids.add(event.article_id);
        if (event.author) summary.authors.add(event.author);
        for (const stock of event.related_stocks || []) summary.stocks.add(stock);
        const sentiment = ["positive", "negative", "neutral"].includes(event.sentiment) ? event.sentiment : "neutral";
        summary.sentiments[sentiment] += 1;
        summary.importance_total += Number(event.importance_score || 0);
        if (!summary.latest_publish_time || String(event.publish_time || event.date).localeCompare(summary.latest_publish_time) > 0) {
            summary.latest_publish_time = event.publish_time || event.date;
            summary.latest_date = event.date;
        }
        summary.timeline.push(event);
    }

    return [...bySector.values()].map((summary) => ({
        sector_id: summary.sector_id,
        name: summary.name,
        heat_score: calculateHeatScore(summary, now),
        mention_count: summary.mention_count,
        article_count: summary.article_ids.size,
        author_count: summary.authors.size,
        stock_count: summary.stocks.size,
        latest_publish_time: summary.latest_publish_time,
        sentiment_counts: summary.sentiments,
        related_stocks: [...summary.stocks].slice(0, 12),
        top_authors: [...summary.authors].slice(0, 12),
        timeline: summary.timeline,
    }));
}

function sortSectors(items, sort) {
    const mode = VALID_SORTS.has(sort) ? sort : "heat";
    const metric = {
        heat: "heat_score",
        latest: "latest_publish_time",
        articles: "article_count",
        authors: "author_count",
        stocks: "stock_count",
    }[mode];

    return [...items].sort((left, right) => {
        if (mode === "latest") {
            return String(right[metric] || "").localeCompare(String(left[metric] || ""));
        }
        const diff = Number(right[metric] || 0) - Number(left[metric] || 0);
        if (diff !== 0) return diff;
        return String(right.latest_publish_time || "").localeCompare(String(left.latest_publish_time || ""));
    });
}

export function buildSectorDashboard(records, options = {}) {
    const range = VALID_RANGES.has(options.range) ? options.range : "7d";
    const sort = VALID_SORTS.has(options.sort) ? options.sort : "heat";
    const query = compactKey(options.query || "");
    const events = buildArticleSectorEvents(records, { range, now: options.now });
    let sectors = summarizeEvents(events, { now: options.now });

    if (query) {
        sectors = sectors.filter((sector) => compactKey(sector.name).includes(query));
    }

    sectors = sortSectors(sectors, sort);
    const limit = Number(options.limit || 100);

    return {
        range,
        sort,
        query: options.query || "",
        summary: {
            sector_count: sectors.length,
            event_count: events.length,
            article_count: new Set(events.map((event) => event.article_id)).size,
        },
        sectors: sectors.slice(0, limit).map(({ timeline, ...sector }) => sector),
    };
}

export function loadSectorDetail(records, sectorIdOrName, options = {}) {
    const targetName = normalizeSectorName(decodeURIComponent(String(sectorIdOrName || "")));
    if (!targetName) return null;
    const range = VALID_RANGES.has(options.range) ? options.range : "all";
    const events = buildArticleSectorEvents(records, { range, now: options.now })
        .filter((event) => event.sector_name === targetName);
    if (!events.length) return null;

    const [summary] = summarizeEvents(events, { now: options.now });
    return {
        ...summary,
        article_count: summary.article_count,
        timeline: events,
    };
}

export function getSectorRangeOptions() {
    return [...VALID_RANGES];
}
