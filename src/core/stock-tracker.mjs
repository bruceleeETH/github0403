import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "../storage/paths.mjs";

export const STOCKS_FILE_NAME = "stocks.jsonl";
export const DAILY_PRICES_FILE_NAME = "daily_prices.jsonl";
export const STOCK_PRICE_META_FILE_NAME = "price_update_meta.json";
export const STOCK_NOTES_DIR_NAME = "notes";
export const STOCK_CATALOG_DIR_NAME = "catalog";
export const STOCK_UNIVERSE_FILE_NAME = "stock_universe.jsonl";
export const STOCK_CATALOG_META_FILE_NAME = "update_meta.json";
export const STOCK_NOTE_MAX_BYTES = 512 * 1024;

const VALID_RANGES = new Set(["day", "5d", "week", "since_added"]);
const VALID_ORDERS = new Set(["asc", "desc"]);
const REVIEW_THRESHOLDS = Object.freeze({
    sinceAddedDrop: -5,
    dayAbsMove: 5,
    fiveDayAbsMove: 12,
    articleMentionCount: 2,
});
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

function priceMetaPath(dataDir) {
    return path.join(dataDir, STOCK_PRICE_META_FILE_NAME);
}

function catalogDir(dataDir) {
    return path.join(dataDir, STOCK_CATALOG_DIR_NAME);
}

function catalogPath(dataDir) {
    return path.join(catalogDir(dataDir), STOCK_UNIVERSE_FILE_NAME);
}

function catalogMetaPath(dataDir) {
    return path.join(catalogDir(dataDir), STOCK_CATALOG_META_FILE_NAME);
}

function notesDir(dataDir) {
    return path.join(dataDir, STOCK_NOTES_DIR_NAME);
}

function stockNotePath(dataDir, stockId) {
    const safeId = String(stockId || "").toUpperCase().replace(/[^A-Z0-9.]/g, "_");
    return path.join(notesDir(dataDir), `${safeId}.md`);
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

function inferStockExchange(code, market = "") {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const normalizedMarket = String(market || "").trim().toUpperCase();
    if (["SH", "SZ", "BJ", "HK", "US"].includes(normalizedMarket)) return normalizedMarket;
    if (/港|HK/.test(String(market || ""))) return "HK";
    if (/美|US/.test(String(market || ""))) return "US";
    if (/^[A-Z.]+$/.test(normalizedCode)) return "US";
    if (/^[69]/.test(normalizedCode)) return "SH";
    if (/^[023]/.test(normalizedCode)) return "SZ";
    if (/^[48]/.test(normalizedCode)) return "BJ";
    return "CN";
}

function marketName(exchange, fallback = "") {
    if (fallback) return String(fallback);
    if (["SH", "SZ", "BJ"].includes(exchange)) return "A股";
    if (exchange === "HK") return "港股";
    if (exchange === "US") return "美股";
    return "其他";
}

function normalizeStockId(value) {
    const text = String(value || "").trim().toUpperCase();
    if (!text) return "";
    const parsed = parseStockInput({ stock_id: text });
    return parsed.code ? buildStockId(parsed.exchange, parsed.code) : "";
}

function pickFirst(record, keys) {
    for (const key of keys) {
        const value = record?.[key];
        if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
    return "";
}

function normalizeTags(tags) {
    const values = Array.isArray(tags)
        ? tags
        : String(tags || "").split(/[,，、\s]+/);
    return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 12);
}

function formatYamlValue(value) {
    if (Array.isArray(value)) {
        return `[${value.map((item) => JSON.stringify(String(item))).join(", ")}]`;
    }
    if (value === null || value === undefined) return '""';
    return JSON.stringify(String(value));
}

function ensureTrailingNewline(text) {
    return text.endsWith("\n") ? text : `${text}\n`;
}

function getDateKey(value) {
    const text = String(value || "");
    const match = text.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
    if (!match) return "";
    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function formatSignedPct(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "--";
    return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
}

export function buildStockId(exchange, code) {
    return `${String(exchange || "").trim().toUpperCase()}.${String(code || "").trim().toUpperCase()}`;
}

export function normalizeStockCatalogRecord(record = {}, options = {}) {
    const fromStockId = normalizeStockId(record.stock_id || record.symbol || "");
    const [stockIdExchange, stockIdCode] = fromStockId ? fromStockId.split(".") : ["", ""];
    const rawCode = pickFirst(record, ["code", "symbol", "股票代码", "A股代码", "代码", "证券代码", "ticker"]) || stockIdCode;
    const code = rawCode.replace(/^(SH|SZ|BJ|HK|US)[.\-_:]?/i, "").replace(/\s+/g, "").toUpperCase();
    const rawExchange = pickFirst(record, ["exchange", "market_code", "交易所"]) || stockIdExchange;
    const rawMarket = pickFirst(record, ["market", "市场", "板块"]);
    const exchange = rawExchange ? rawExchange.toUpperCase() : inferStockExchange(code, rawMarket);
    const name = pickFirst(record, ["name", "股票简称", "A股简称", "简称", "公司简称", "名称", "security_name"]);
    if (!code || !name) throw new Error("股票目录记录缺少代码或名称");
    if (!/^[A-Z0-9.]+$/.test(code)) throw new Error(`股票代码格式不支持：${code}`);
    const stock_id = buildStockId(exchange, code);
    return {
        stock_id,
        code,
        exchange,
        name,
        market: marketName(exchange, rawMarket),
        industry: pickFirst(record, ["industry", "所属行业", "行业"]),
        source: record.source || options.source || "manual",
        updated_at: record.updated_at || nowIso(options),
    };
}

export function readStockCatalog(dataDir, options = {}) {
    ensureStockDataStore(dataDir, options);
    const records = readJsonl(catalogPath(dataDir));
    const byId = new Map();
    for (const record of records) {
        const normalized = normalizeStockCatalogRecord(record, options);
        byId.set(normalized.stock_id, normalized);
    }
    return [...byId.values()];
}

export function writeStockCatalog(dataDir, records, options = {}) {
    ensureStockDataStore(dataDir, options);
    ensureDir(catalogDir(dataDir));
    const byId = new Map();
    for (const record of records) {
        const normalized = normalizeStockCatalogRecord(record, options);
        byId.set(normalized.stock_id, normalized);
    }
    const normalized = [...byId.values()];
    writeJsonl(catalogPath(dataDir), normalized);
    const markets = normalized.reduce((acc, item) => {
        acc[item.market] = (acc[item.market] || 0) + 1;
        return acc;
    }, {});
    const meta = {
        source: options.source || "manual",
        updated_at: nowIso(options),
        total: normalized.length,
        markets,
        ...(options.meta || {}),
    };
    fs.writeFileSync(catalogMetaPath(dataDir), JSON.stringify(meta, null, 2), "utf-8");
    return { records: normalized, meta };
}

export function getStockCatalogStatus(dataDir, options = {}) {
    ensureStockDataStore(dataDir, options);
    const filePath = catalogPath(dataDir);
    const metaPath = catalogMetaPath(dataDir);
    const exists = fs.existsSync(filePath);
    const meta = fs.existsSync(metaPath)
        ? JSON.parse(fs.readFileSync(metaPath, "utf-8"))
        : {};
    const count = exists ? readJsonl(filePath).length : 0;
    return {
        exists,
        count,
        source: meta.source || "",
        updated_at: meta.updated_at || (exists ? fs.statSync(filePath).mtime.toISOString() : ""),
        markets: meta.markets || {},
        file: path.relative(dataDir, filePath),
    };
}

function stockSearchScore(stock, query) {
    const normalizedQuery = String(query || "").trim();
    if (!normalizedQuery) return 0;
    const upper = normalizedQuery.toUpperCase().replace(/\s+/g, "");
    const lower = normalizedQuery.toLowerCase().replace(/\s+/g, "");
    const name = String(stock.name || "");
    const code = String(stock.code || "").toUpperCase();
    const stockId = String(stock.stock_id || "").toUpperCase();
    const compactName = name.replace(/\s+/g, "");
    if (stockId === upper) return 1000;
    if (code === upper) return 950;
    if (compactName === normalizedQuery.replace(/\s+/g, "")) return 900;
    if (compactName.startsWith(normalizedQuery)) return 820;
    if (code.startsWith(upper)) return 780;
    if (stockId.includes(upper)) return 700;
    if (compactName.includes(normalizedQuery)) return 650;
    if (`${stock.market || ""} ${stock.exchange || ""} ${stock.industry || ""}`.toLowerCase().includes(lower)) return 200;
    return 0;
}

export function searchStockCatalog(dataDir, query, options = {}) {
    const limit = Math.max(1, Math.min(Number(options.limit || 20), 50));
    return readStockCatalog(dataDir, options)
        .map((stock) => ({ stock, score: stockSearchScore(stock, query) }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score || left.stock.name.localeCompare(right.stock.name, "zh-CN"))
        .slice(0, limit)
        .map((item) => item.stock);
}

export function findStockCatalogRecord(dataDir, stockId, options = {}) {
    const targetId = normalizeStockId(stockId);
    if (!targetId) return null;
    return readStockCatalog(dataDir, options).find((stock) => stock.stock_id === targetId) || null;
}

function resolveStockCatalogRecord(dataDir, input = {}, options = {}) {
    if (!input.stock_id && input.code && input.name) {
        return normalizeStockCatalogRecord({
            code: input.code,
            exchange: input.exchange,
            name: input.name,
            market: input.market,
            industry: input.industry,
            source: input.source || "article_analysis",
        }, { ...options, source: input.source || options.source || "article_analysis" });
    }

    const status = getStockCatalogStatus(dataDir, options);
    if (!status.exists || status.count === 0) throw new Error("股票目录为空，请先更新股票目录");
    if (input.stock_id) {
        const stock = findStockCatalogRecord(dataDir, input.stock_id, options);
        if (!stock) throw new Error("股票目录中未找到该股票，请先更新股票目录");
        return stock;
    }
    const query = String(input.query || "").trim();
    if (query) {
        const matches = searchStockCatalog(dataDir, query, { ...options, limit: 6 });
        const compactQuery = query.replace(/\s+/g, "").toUpperCase();
        const exact = matches.find((stock) => (
            stock.stock_id === compactQuery ||
            stock.code.toUpperCase() === compactQuery ||
            stock.name.replace(/\s+/g, "").toUpperCase() === compactQuery
        ));
        if (exact) return exact;
        if (matches.length === 1) return matches[0];
        if (matches.length > 1) throw new Error("找到多个候选股票，请先选择具体股票");
    }
    throw new Error("请选择股票目录中的股票");
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
        market: input.market || marketName(exchange),
        added_at: timestamp,
        updated_at: timestamp,
        status: input.status === "archived" ? "archived" : "active",
        tags: normalizeTags(input.tags),
        watch_reason: String(input.watch_reason || "").trim(),
    };
}

export function buildStockNoteTemplate(stock, options = {}) {
    const noteDate = getDateKey(options.date || options.now?.toISOString?.() || new Date().toISOString());
    const frontmatter = [
        ["schema", "stock_note/v1"],
        ["stock_id", stock.stock_id || ""],
        ["code", stock.code || ""],
        ["exchange", stock.exchange || ""],
        ["name", stock.name || ""],
        ["created_at", noteDate],
        ["updated_at", noteDate],
        ["tags", stock.tags || []],
    ];

    return ensureTrailingNewline([
        "---",
        ...frontmatter.map(([key, value]) => `${key}: ${formatYamlValue(value)}`),
        "---",
        "",
        `# ${stock.name || stock.stock_id || "股票笔记"}`,
        "",
        "## 当前判断",
        "",
        "",
        "## 关注理由",
        "",
        stock.watch_reason || "",
        "",
        "## 风险点",
        "",
        "- ",
        "",
        "## 验证指标",
        "",
        "- ",
        "",
        "## 复盘记录",
        "",
    ].join("\n"));
}

export function readStockNote(dataDir, stock, options = {}) {
    ensureStockDataStore(dataDir, options);
    ensureDir(notesDir(dataDir));
    const notePath = stockNotePath(dataDir, stock.stock_id);
    if (!fs.existsSync(notePath)) {
        return {
            exists: false,
            content: buildStockNoteTemplate(stock, options),
            updated_at: "",
            note_file: path.relative(dataDir, notePath),
        };
    }

    const stat = fs.statSync(notePath);
    return {
        exists: true,
        content: fs.readFileSync(notePath, "utf-8"),
        updated_at: stat.mtime.toISOString(),
        note_file: path.relative(dataDir, notePath),
    };
}

export function writeStockNote(dataDir, stock, content, options = {}) {
    ensureStockDataStore(dataDir, options);
    ensureDir(notesDir(dataDir));
    if (typeof content !== "string") throw new Error("笔记内容必须是字符串");
    if (Buffer.byteLength(content, "utf-8") > STOCK_NOTE_MAX_BYTES) throw new Error("笔记内容过大");

    const notePath = stockNotePath(dataDir, stock.stock_id);
    const savedContent = ensureTrailingNewline(content);
    fs.writeFileSync(notePath, savedContent, "utf-8");
    const stat = fs.statSync(notePath);
    return {
        exists: true,
        content: savedContent,
        updated_at: stat.mtime.toISOString(),
        note_file: path.relative(dataDir, notePath),
    };
}

function normalizePriceRecord(record) {
    const stock_id = String(record.stock_id || buildStockId(record.exchange, record.code)).trim().toUpperCase();
    const numberOrNaN = (value) => (
        value === null || value === undefined || value === "" ? Number.NaN : Number(value)
    );
    const close = numberOrNaN(record.close);
    const prevClose = numberOrNaN(record.prev_close);
    if (!stock_id || !String(record.trade_date || "").trim()) throw new Error("价格记录缺少股票或交易日");
    if (!Number.isFinite(close)) throw new Error("价格记录收盘价无效");
    const numericOrNull = (value, digits = 2) => {
        const number = Number(value);
        return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
    };
    const pctChange = Number.isFinite(Number(record.pct_change))
        ? Number(record.pct_change)
        : (Number.isFinite(close) && Number.isFinite(prevClose) && prevClose !== 0
            ? ((close / prevClose) - 1) * 100
            : null);
    return {
        stock_id,
        trade_date: String(record.trade_date || "").slice(0, 10),
        open: numericOrNull(record.open),
        close: Number(close.toFixed(2)),
        high: numericOrNull(record.high),
        low: numericOrNull(record.low),
        prev_close: Number.isFinite(prevClose) ? Number(prevClose.toFixed(2)) : null,
        change_amount: numericOrNull(record.change_amount),
        pct_change: pctChange === null ? null : Number(pctChange.toFixed(2)),
        volume: numericOrNull(record.volume, 0),
        amount: numericOrNull(record.amount, 2),
        amplitude: numericOrNull(record.amplitude),
        turnover: numericOrNull(record.turnover),
        adjust: record.adjust || "qfq",
        source: record.source || "akshare",
        captured_at: record.captured_at || nowIso(),
    };
}

function ensureStockDataStore(dataDir, options = {}) {
    ensureDir(dataDir);
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
    return readJsonl(pricePath(dataDir))
        .map(normalizePriceRecord)
        .filter((price) => options.includeTestPrices || price.source !== "test");
}

export function writeDailyPrices(dataDir, prices, options = {}) {
    ensureStockDataStore(dataDir, options);
    writeJsonl(pricePath(dataDir), prices.map(normalizePriceRecord));
}

export function upsertDailyPrices(dataDir, prices, options = {}) {
    const existing = readDailyPrices(dataDir, options);
    const byKey = new Map();
    for (const price of existing) {
        byKey.set(`${price.stock_id}|${price.trade_date}|${price.adjust || "qfq"}`, price);
    }
    for (const price of prices.map(normalizePriceRecord)) {
        byKey.set(`${price.stock_id}|${price.trade_date}|${price.adjust || "qfq"}`, price);
    }
    const merged = [...byKey.values()].sort((left, right) => (
        left.stock_id.localeCompare(right.stock_id) ||
        left.trade_date.localeCompare(right.trade_date) ||
        String(left.adjust || "").localeCompare(String(right.adjust || ""))
    ));
    writeDailyPrices(dataDir, merged, options);
    return merged;
}

export function getStockPriceStatus(dataDir, options = {}) {
    ensureStockDataStore(dataDir, options);
    const prices = readDailyPrices(dataDir, options);
    const metaPath = priceMetaPath(dataDir);
    const meta = fs.existsSync(metaPath)
        ? JSON.parse(fs.readFileSync(metaPath, "utf-8"))
        : {};
    const stockIds = new Set(prices.map((price) => price.stock_id));
    const latestTradeDate = prices.reduce((latest, price) => (
        !latest || price.trade_date > latest ? price.trade_date : latest
    ), "");
    const latestCapturedAt = prices.reduce((latest, price) => (
        !latest || String(price.captured_at || "") > latest ? String(price.captured_at || "") : latest
    ), "");
    return {
        exists: fs.existsSync(pricePath(dataDir)),
        count: prices.length,
        stock_count: stockIds.size,
        latest_trade_date: latestTradeDate,
        updated_at: meta.updated_at || latestCapturedAt,
        source: meta.source || (prices.find((price) => price.source)?.source || ""),
        adjust: meta.adjust || (prices.find((price) => price.adjust)?.adjust || "qfq"),
        file: path.relative(dataDir, pricePath(dataDir)),
        last_result: meta.last_result || null,
    };
}

export function addStock(dataDir, input, options = {}) {
    const stocks = readStocks(dataDir, options);
    const catalogStock = resolveStockCatalogRecord(dataDir, input, options);
    const nextStock = normalizeStockInput({
        ...catalogStock,
        tags: input.tags,
        watch_reason: input.watch_reason,
        status: input.status,
    }, options);
    const existing = stocks.find((stock) => stock.stock_id === nextStock.stock_id);
    if (existing?.status === "active") throw new Error("股票已在关注池中");

    const nextStocks = existing
        ? stocks.map((stock) => stock.stock_id === nextStock.stock_id
            ? { ...stock, ...nextStock, added_at: stock.added_at || nextStock.added_at, status: "active" }
            : stock)
        : [...stocks, nextStock];
    writeStocks(dataDir, nextStocks, options);
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
    if (range === "since_added") return records.findIndex((item) => item.trade_date >= getDateKey(records[latestIndex].stock_added_at));
    return latestIndex - 1;
}

export function buildStockPerformance(stock, prices, range = "day") {
    const normalizedRange = VALID_RANGES.has(range) ? range : "day";
    const records = prices
        .filter((price) => price.stock_id === stock.stock_id)
        .map((price) => ({ ...price, stock_added_at: stock.added_at }))
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

function withDerivedPerformances(item) {
    const stock = item.stock;
    const priceRecords = item.price_records || [];
    const { price_records: _priceRecords, ...rest } = item;
    return {
        ...rest,
        since_added: buildStockPerformance(stock, priceRecords, "since_added"),
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
        .map((stock) => ({
            ...buildStockPerformance(stock, prices, range),
            price_records: prices.filter((price) => price.stock_id === stock.stock_id),
        }))
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
        .map((item, index) => withDerivedPerformances({ ...item, rank: index + 1 }));
}

function buildReviewItem({ type, stock, reason, metric, related_articles = [], action }) {
    const stockPart = stock?.stock_id || "article";
    return {
        id: `${type}_${stockPart}_${String(metric?.range || metric?.value || reason).replace(/[^a-zA-Z0-9_.-]/g, "_")}`,
        type,
        stock: stock || null,
        reason,
        metric,
        related_articles,
        action,
    };
}

export function buildReviewQueue(stocks, prices, articleMentions = [], options = {}) {
    const thresholds = { ...REVIEW_THRESHOLDS, ...(options.thresholds || {}) };
    const activeStocks = stocks.filter((stock) => stock.status !== "archived");
    const queue = [];

    for (const stock of activeStocks) {
        const day = buildStockPerformance(stock, prices, "day");
        const fiveDay = buildStockPerformance(stock, prices, "5d");
        const sinceAdded = buildStockPerformance(stock, prices, "since_added");

        if (Number.isFinite(sinceAdded.pct_change) && sinceAdded.pct_change <= thresholds.sinceAddedDrop) {
            queue.push(buildReviewItem({
                type: "since_added_drop",
                stock,
                reason: `加入以来跌幅达到 ${formatSignedPct(sinceAdded.pct_change)}`,
                metric: { range: "since_added", pct_change: sinceAdded.pct_change, threshold: thresholds.sinceAddedDrop },
                action: "复盘加入理由是否仍成立",
            }));
        }
        if (Number.isFinite(day.pct_change) && Math.abs(day.pct_change) >= thresholds.dayAbsMove) {
            queue.push(buildReviewItem({
                type: "day_move",
                stock,
                reason: `日涨跌幅达到 ${formatSignedPct(day.pct_change)}`,
                metric: { range: "day", pct_change: day.pct_change, threshold: thresholds.dayAbsMove },
                action: "检查是否有新闻或文章催化",
            }));
        }
        if (Number.isFinite(fiveDay.pct_change) && Math.abs(fiveDay.pct_change) >= thresholds.fiveDayAbsMove) {
            queue.push(buildReviewItem({
                type: "five_day_move",
                stock,
                reason: `五日涨跌幅达到 ${formatSignedPct(fiveDay.pct_change)}`,
                metric: { range: "5d", pct_change: fiveDay.pct_change, threshold: thresholds.fiveDayAbsMove },
                action: "复盘趋势延续性和风险",
            }));
        }
    }

    for (const mention of articleMentions) {
        if ((mention.count || 0) < thresholds.articleMentionCount || mention.in_pool) continue;
        queue.push(buildReviewItem({
            type: "article_mentions_untracked",
            stock: mention.stock || null,
            reason: `${mention.name || mention.code || "未关注股票"} 被文章提及 ${mention.count} 次但尚未加入股票池`,
            metric: { value: mention.count, threshold: thresholds.articleMentionCount },
            related_articles: mention.articles || [],
            action: "判断是否需要加入股票池",
        }));
    }

    return queue;
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
            since_added: buildStockPerformance(stock, prices, "since_added"),
        },
    };
}
