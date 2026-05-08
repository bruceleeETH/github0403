import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "../storage/paths.mjs";

export const STOCKS_FILE_NAME = "stocks.jsonl";
export const DAILY_PRICES_FILE_NAME = "daily_prices.jsonl";

const VALID_RANGES = new Set(["day", "5d", "week"]);
const VALID_ORDERS = new Set(["asc", "desc"]);
const TRADE_DATES = [
    "2026-04-24",
    "2026-04-27",
    "2026-04-28",
    "2026-04-29",
    "2026-04-30",
    "2026-05-04",
    "2026-05-05",
    "2026-05-06",
    "2026-05-07",
    "2026-05-08",
];

export const SAMPLE_STOCKS = Object.freeze([
    {
        code: "688981",
        exchange: "SH",
        name: "中芯国际",
        tags: ["半导体", "国产替代"],
        watch_reason: "多篇文章提到半导体景气修复，先纳入核心观察池。",
    },
    {
        code: "300308",
        exchange: "SZ",
        name: "中际旭创",
        tags: ["CPO", "光模块"],
        watch_reason: "文章里反复出现光模块和 CPO，是观察 AI 产业链强度的锚点。",
    },
    {
        code: "002617",
        exchange: "SZ",
        name: "露笑科技",
        tags: ["碳化硅", "半导体"],
        watch_reason: "适合作为半导体扩散方向的弹性样本。",
    },
    {
        code: "600703",
        exchange: "SH",
        name: "三安光电",
        tags: ["化合物半导体", "LED"],
        watch_reason: "用于跟踪化合物半导体方向的持续性。",
    },
]);

function nowIso(options = {}) {
    return (options.now || new Date()).toISOString();
}

function readJsonl(filePath) {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, "utf-8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => {
            try {
                return JSON.parse(line);
            } catch (error) {
                throw new Error(`${path.basename(filePath)} 第 ${index + 1} 行不是有效 JSON`);
            }
        });
}

function writeJsonl(filePath, records) {
    fs.writeFileSync(
        filePath,
        records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""),
        "utf-8"
    );
}

function stockPath(dataDir) {
    return path.join(dataDir, STOCKS_FILE_NAME);
}

function pricePath(dataDir) {
    return path.join(dataDir, DAILY_PRICES_FILE_NAME);
}

function hashText(value) {
    return [...String(value || "")].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function parseStockInput(input = {}) {
    let rawCode = String(input.code || input.stock_id || "").trim().toUpperCase();
    let exchange = String(input.exchange || "").trim().toUpperCase();
    const prefixed = /^(SH|SZ|BJ|HK|US)[.\-_:]?(.+)$/.exec(rawCode);
    if (prefixed) {
        exchange = exchange || prefixed[1];
        rawCode = prefixed[2];
    }

    const code = rawCode.replace(/\s+/g, "");
    if (!exchange) {
        if (/^[69]/.test(code)) exchange = "SH";
        else if (/^[023]/.test(code)) exchange = "SZ";
        else if (/^[48]/.test(code)) exchange = "BJ";
        else exchange = "CN";
    }

    return { code, exchange };
}

function normalizeTags(tags) {
    const values = Array.isArray(tags)
        ? tags
        : String(tags || "").split(/[,，、\s]+/);
    return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 12);
}

export function buildStockId(exchange, code) {
    return `${String(exchange || "").trim().toUpperCase()}.${String(code || "").trim().toUpperCase()}`;
}

export function normalizeStockInput(input = {}, options = {}) {
    const { code, exchange } = parseStockInput(input);
    const name = String(input.name || "").trim();
    if (!code) throw new Error("股票代码不能为空");
    if (!/^[A-Z0-9]+$/.test(code)) throw new Error("股票代码格式不支持");
    if (!name) throw new Error("股票名称不能为空");

    const timestamp = nowIso(options);
    return {
        stock_id: buildStockId(exchange, code),
        code,
        exchange,
        name,
        added_at: timestamp,
        updated_at: timestamp,
        status: input.status === "archived" ? "archived" : "active",
        tags: normalizeTags(input.tags),
        watch_reason: String(input.watch_reason || "").trim(),
    };
}

function normalizePriceRecord(record) {
    const stock_id = String(record.stock_id || buildStockId(record.exchange, record.code)).trim().toUpperCase();
    const close = Number(record.close);
    const prevClose = Number(record.prev_close);
    if (!stock_id || !String(record.trade_date || "").trim()) throw new Error("价格记录缺少股票或交易日");
    if (!Number.isFinite(close)) throw new Error("价格记录收盘价无效");
    const pctChange = Number.isFinite(Number(record.pct_change))
        ? Number(record.pct_change)
        : (Number.isFinite(close) && Number.isFinite(prevClose) && prevClose !== 0
            ? ((close / prevClose) - 1) * 100
            : null);
    return {
        stock_id,
        trade_date: String(record.trade_date || "").slice(0, 10),
        close: Number(close.toFixed(2)),
        prev_close: Number.isFinite(prevClose) ? Number(prevClose.toFixed(2)) : null,
        pct_change: pctChange === null ? null : Number(pctChange.toFixed(2)),
        source: record.source || "test",
        captured_at: record.captured_at || nowIso(),
    };
}

function generateTestPrices(stock, options = {}) {
    const seed = hashText(stock.stock_id);
    let close = Number((18 + (seed % 120) + ((seed % 17) / 10)).toFixed(2));
    return TRADE_DATES.map((tradeDate, index) => {
        const prevClose = close;
        const wave = Math.sin((seed + index) * 0.72) * 0.028;
        const drift = ((seed % 7) - 3) * 0.0025;
        close = Number(Math.max(2, close * (1 + wave + drift)).toFixed(2));
        return normalizePriceRecord({
            stock_id: stock.stock_id,
            trade_date: tradeDate,
            close,
            prev_close: index === 0 ? close : prevClose,
            source: options.source || "test",
            captured_at: options.captured_at || "2026-05-08T15:30:00.000Z",
        });
    });
}

function ensureStockDataStore(dataDir, options = {}) {
    ensureDir(dataDir);
    const shouldSeed = options.seed !== false;
    const stocksFile = stockPath(dataDir);
    const pricesFile = pricePath(dataDir);
    if (!shouldSeed || fs.existsSync(stocksFile) || fs.existsSync(pricesFile)) return;

    const stocks = SAMPLE_STOCKS.map((sample, index) => normalizeStockInput(sample, {
        now: new Date(Date.UTC(2026, 4, 8, 7, 30 + index)),
    }));
    const prices = stocks.flatMap((stock) => generateTestPrices(stock));
    writeJsonl(stocksFile, stocks);
    writeJsonl(pricesFile, prices);
}

export function readStocks(dataDir, options = {}) {
    ensureStockDataStore(dataDir, options);
    return readJsonl(stockPath(dataDir));
}

export function writeStocks(dataDir, stocks, options = {}) {
    ensureStockDataStore(dataDir, options);
    writeJsonl(stockPath(dataDir), stocks);
}

export function readDailyPrices(dataDir, options = {}) {
    ensureStockDataStore(dataDir, options);
    return readJsonl(pricePath(dataDir)).map(normalizePriceRecord);
}

export function writeDailyPrices(dataDir, prices, options = {}) {
    ensureStockDataStore(dataDir, options);
    writeJsonl(pricePath(dataDir), prices.map(normalizePriceRecord));
}

function seedPricesIfMissing(dataDir, stock, options = {}) {
    const prices = readDailyPrices(dataDir, options);
    if (prices.some((item) => item.stock_id === stock.stock_id)) return prices;
    const nextPrices = [...prices, ...generateTestPrices(stock)];
    writeDailyPrices(dataDir, nextPrices, options);
    return nextPrices;
}

export function addStock(dataDir, input, options = {}) {
    const stocks = readStocks(dataDir, options);
    const nextStock = normalizeStockInput(input, options);
    const existing = stocks.find((stock) => stock.stock_id === nextStock.stock_id);
    if (existing?.status === "active") throw new Error("股票已在关注池中");

    const nextStocks = existing
        ? stocks.map((stock) => stock.stock_id === nextStock.stock_id
            ? { ...stock, ...nextStock, added_at: stock.added_at || nextStock.added_at, status: "active" }
            : stock)
        : [...stocks, nextStock];
    writeStocks(dataDir, nextStocks, options);
    seedPricesIfMissing(dataDir, nextStock, options);
    return nextStocks.find((stock) => stock.stock_id === nextStock.stock_id);
}

export function updateStock(dataDir, stockId, input, options = {}) {
    const stocks = readStocks(dataDir, options);
    const targetId = String(stockId || "").toUpperCase();
    const existing = stocks.find((stock) => stock.stock_id === targetId);
    if (!existing) throw new Error("股票不存在");

    const updated = {
        ...existing,
        name: input.name !== undefined ? String(input.name || "").trim() : existing.name,
        tags: input.tags !== undefined ? normalizeTags(input.tags) : existing.tags,
        watch_reason: input.watch_reason !== undefined ? String(input.watch_reason || "").trim() : existing.watch_reason,
        status: input.status === "archived" ? "archived" : (input.status === "active" ? "active" : existing.status),
        updated_at: nowIso(options),
    };
    if (!updated.name) throw new Error("股票名称不能为空");

    const nextStocks = stocks.map((stock) => stock.stock_id === targetId ? updated : stock);
    writeStocks(dataDir, nextStocks, options);
    return updated;
}

export function archiveStock(dataDir, stockId, options = {}) {
    return updateStock(dataDir, stockId, {
        status: "archived",
    }, options);
}

function getWeekStart(dateKey) {
    const date = new Date(`${dateKey}T00:00:00Z`);
    const day = date.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    date.setUTCDate(date.getUTCDate() - diff);
    return date.toISOString().slice(0, 10);
}

function getReferenceIndex(records, latestIndex, range) {
    if (range === "day") return latestIndex - 1;
    if (range === "5d") return latestIndex - 5;
    if (range === "week") {
        const weekStart = getWeekStart(records[latestIndex].trade_date);
        return records.findIndex((item) => item.trade_date >= weekStart);
    }
    return latestIndex - 1;
}

export function buildStockPerformance(stock, prices, range = "day") {
    const normalizedRange = VALID_RANGES.has(range) ? range : "day";
    const records = prices
        .filter((price) => price.stock_id === stock.stock_id)
        .sort((left, right) => left.trade_date.localeCompare(right.trade_date));
    if (records.length === 0) {
        return {
            stock,
            latest_price: null,
            latest_trade_date: "",
            reference_price: null,
            reference_trade_date: "",
            change_amount: null,
            pct_change: null,
            range: normalizedRange,
            price_count: 0,
        };
    }

    const latestIndex = records.length - 1;
    const referenceIndex = getReferenceIndex(records, latestIndex, normalizedRange);
    const latest = records[latestIndex];
    const reference = records[referenceIndex];
    if (!reference || referenceIndex === latestIndex || !Number.isFinite(reference.close) || reference.close === 0) {
        return {
            stock,
            latest_price: latest.close,
            latest_trade_date: latest.trade_date,
            reference_price: null,
            reference_trade_date: "",
            change_amount: null,
            pct_change: null,
            range: normalizedRange,
            price_count: records.length,
        };
    }

    const changeAmount = latest.close - reference.close;
    return {
        stock,
        latest_price: latest.close,
        latest_trade_date: latest.trade_date,
        reference_price: reference.close,
        reference_trade_date: reference.trade_date,
        change_amount: Number(changeAmount.toFixed(2)),
        pct_change: Number((((latest.close / reference.close) - 1) * 100).toFixed(2)),
        range: normalizedRange,
        price_count: records.length,
    };
}

export function buildStockRankings(stocks, prices, options = {}) {
    const range = VALID_RANGES.has(options.range) ? options.range : "day";
    const order = VALID_ORDERS.has(options.order) ? options.order : "desc";
    const query = String(options.query || "").trim().toLowerCase();
    const includeArchived = Boolean(options.includeArchived);

    return stocks
        .filter((stock) => includeArchived || stock.status !== "archived")
        .filter((stock) => {
            if (!query) return true;
            const haystack = `${stock.stock_id} ${stock.code} ${stock.name} ${(stock.tags || []).join(" ")}`.toLowerCase();
            return haystack.includes(query);
        })
        .map((stock) => buildStockPerformance(stock, prices, range))
        .sort((left, right) => {
            const leftMissing = left.pct_change === null;
            const rightMissing = right.pct_change === null;
            if (leftMissing && rightMissing) return left.stock.name.localeCompare(right.stock.name, "zh-CN");
            if (leftMissing) return 1;
            if (rightMissing) return -1;
            return order === "asc"
                ? left.pct_change - right.pct_change
                : right.pct_change - left.pct_change;
        })
        .map((item, index) => ({ ...item, rank: index + 1 }));
}

export function loadStockDashboard(dataDir, options = {}) {
    const stocks = readStocks(dataDir, options);
    const prices = readDailyPrices(dataDir, options);
    const rankings = buildStockRankings(stocks, prices, options);
    const latestTradeDate = rankings.find((item) => item.latest_trade_date)?.latest_trade_date || "";
    return {
        stocks,
        rankings,
        range: VALID_RANGES.has(options.range) ? options.range : "day",
        order: VALID_ORDERS.has(options.order) ? options.order : "desc",
        latest_trade_date: latestTradeDate,
        summary: {
            active_count: stocks.filter((stock) => stock.status !== "archived").length,
            archived_count: stocks.filter((stock) => stock.status === "archived").length,
            priced_count: rankings.filter((item) => item.latest_price !== null).length,
        },
    };
}

export function loadStockDetail(dataDir, stockId, options = {}) {
    const stocks = readStocks(dataDir, options);
    const stock = stocks.find((item) => item.stock_id === String(stockId || "").toUpperCase());
    if (!stock) return null;
    const prices = readDailyPrices(dataDir, options)
        .filter((price) => price.stock_id === stock.stock_id)
        .sort((left, right) => right.trade_date.localeCompare(left.trade_date));
    return {
        stock,
        prices,
        performance: {
            day: buildStockPerformance(stock, prices, "day"),
            five_day: buildStockPerformance(stock, prices, "5d"),
            week: buildStockPerformance(stock, prices, "week"),
        },
    };
}
