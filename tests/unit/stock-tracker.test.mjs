import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    addStock,
    buildReviewQueue,
    archiveStock,
    buildStockId,
    buildStockPerformance,
    buildStockNoteTemplate,
    getStockCatalogStatus,
    loadStockDashboard,
    loadStockDetail,
    readStockCatalog,
    readStockNote,
    searchStockCatalog,
    updateStock,
    writeDailyPrices,
    writeStockCatalog,
    writeStockNote,
} from "../../src/core/stock-tracker.mjs";

function makeTempDir(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stock-tracker-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

function seedCatalog(dir, records = []) {
    const defaults = [
        { code: "688981", exchange: "SH", name: "中芯国际", market: "A股" },
        { code: "300308", exchange: "SZ", name: "中际旭创", market: "A股" },
        { code: "002617", exchange: "SZ", name: "露笑科技", market: "A股" },
        { code: "600703", exchange: "SH", name: "三安光电", market: "A股" },
        { code: "600000", exchange: "SH", name: "浦发银行", market: "A股" },
        { code: "000001", exchange: "SZ", name: "平安银行", market: "A股" },
    ];
    return writeStockCatalog(dir, [...defaults, ...records], {
        seed: false,
        source: "test",
        now: new Date("2026-05-08T00:00:00.000Z"),
    });
}

test("stock catalog stores A-share records and searches by name or code", (t) => {
    const dir = makeTempDir(t);
    seedCatalog(dir, [
        { code: "00700", exchange: "HK", name: "腾讯控股", market: "港股" },
        { code: "AAPL", exchange: "US", name: "Apple", market: "美股" },
    ]);

    const status = getStockCatalogStatus(dir, { seed: false });
    assert.equal(status.exists, true);
    assert.equal(status.count, 8);
    assert.equal(status.markets["A股"], 6);
    assert.equal(status.markets["港股"], 1);
    assert.equal(status.markets["美股"], 1);

    assert.equal(readStockCatalog(dir, { seed: false }).find((stock) => stock.name === "腾讯控股").stock_id, "HK.00700");
    assert.equal(searchStockCatalog(dir, "中芯", { seed: false })[0].stock_id, "SH.688981");
    assert.equal(searchStockCatalog(dir, "AAPL", { seed: false })[0].stock_id, "US.AAPL");
});

test("addStock normalizes identifiers and seeds test prices", (t) => {
    const dir = makeTempDir(t);
    seedCatalog(dir);
    const stock = addStock(dir, {
        stock_id: "SH.688981",
        tags: "半导体、国产替代",
        watch_reason: "测试关注理由",
    }, {
        seed: false,
        now: new Date("2026-05-08T07:30:00.000Z"),
    });

    assert.equal(stock.stock_id, "SH.688981");
    assert.equal(stock.exchange, "SH");
    assert.deepEqual(stock.tags, ["半导体", "国产替代"]);

    const detail = loadStockDetail(dir, "SH.688981", { seed: false });
    assert.equal(detail.stock.name, "中芯国际");
    assert.equal(detail.prices.length, 10);
    assert.equal(detail.prices[0].trade_date, "2026-05-08");
});

test("stock store starts empty until a catalog stock is added", (t) => {
    const dir = makeTempDir(t);
    assert.equal(loadStockDashboard(dir, { seed: false }).summary.active_count, 0);
    assert.throws(
        () => addStock(dir, { stock_id: "SH.688981" }, { seed: false }),
        /股票目录为空/
    );
});

test("updateStock and archiveStock keep historical records", (t) => {
    const dir = makeTempDir(t);
    seedCatalog(dir);
    addStock(dir, { stock_id: "SZ.300308" }, { seed: false });

    const updated = updateStock(dir, "SZ.300308", {
        name: "中际旭创",
        tags: ["CPO", "光模块"],
        watch_reason: "观察光模块强度",
    }, { seed: false, now: new Date("2026-05-09T00:00:00.000Z") });
    assert.deepEqual(updated.tags, ["CPO", "光模块"]);
    assert.equal(updated.watch_reason, "观察光模块强度");

    const archived = archiveStock(dir, "SZ.300308", { seed: false });
    assert.equal(archived.status, "archived");
    const dashboard = loadStockDashboard(dir, { seed: false });
    assert.equal(dashboard.summary.active_count, 0);
    assert.equal(dashboard.summary.archived_count, 1);
});

test("loadStockDashboard ranks day, five-day, and week performance", (t) => {
    const dir = makeTempDir(t);
    seedCatalog(dir, [
        { code: "600000", exchange: "SH", name: "Alpha", market: "A股" },
        { code: "000001", exchange: "SZ", name: "Beta", market: "A股" },
    ]);
    const alpha = addStock(dir, { stock_id: "SH.600000" }, { seed: false });
    const beta = addStock(dir, { stock_id: "SZ.000001" }, { seed: false });
    writeDailyPrices(dir, [
        { stock_id: alpha.stock_id, trade_date: "2026-05-01", close: 10, prev_close: 10 },
        { stock_id: alpha.stock_id, trade_date: "2026-05-04", close: 11, prev_close: 10 },
        { stock_id: alpha.stock_id, trade_date: "2026-05-05", close: 12, prev_close: 11 },
        { stock_id: alpha.stock_id, trade_date: "2026-05-06", close: 13, prev_close: 12 },
        { stock_id: alpha.stock_id, trade_date: "2026-05-07", close: 14, prev_close: 13 },
        { stock_id: alpha.stock_id, trade_date: "2026-05-08", close: 15, prev_close: 14 },
        { stock_id: beta.stock_id, trade_date: "2026-05-01", close: 20, prev_close: 20 },
        { stock_id: beta.stock_id, trade_date: "2026-05-04", close: 20, prev_close: 20 },
        { stock_id: beta.stock_id, trade_date: "2026-05-05", close: 19, prev_close: 20 },
        { stock_id: beta.stock_id, trade_date: "2026-05-06", close: 18, prev_close: 19 },
        { stock_id: beta.stock_id, trade_date: "2026-05-07", close: 17, prev_close: 18 },
        { stock_id: beta.stock_id, trade_date: "2026-05-08", close: 16, prev_close: 17 },
    ], { seed: false });

    const day = loadStockDashboard(dir, { range: "day", order: "desc", seed: false });
    assert.equal(day.rankings[0].stock.stock_id, buildStockId("SH", "600000"));
    assert.equal(day.rankings[0].pct_change, 7.14);

    const fiveDay = loadStockDashboard(dir, { range: "5d", order: "desc", seed: false });
    assert.equal(fiveDay.rankings[0].pct_change, 50);

    const week = buildStockPerformance(alpha, loadStockDetail(dir, alpha.stock_id, { seed: false }).prices, "week");
    assert.equal(week.reference_trade_date, "2026-05-04");
    assert.equal(week.pct_change, 36.36);
});

test("stock notes return a markdown template and persist saved content", (t) => {
    const dir = makeTempDir(t);
    seedCatalog(dir);
    const stock = addStock(dir, {
        stock_id: "SH.688981",
        tags: ["半导体"],
        watch_reason: "观察国产替代",
    }, { seed: false, now: new Date("2026-05-08T00:00:00.000Z") });

    const template = buildStockNoteTemplate(stock, { date: "2026-05-08" });
    assert.match(template, /schema: "stock_note\/v1"/);
    assert.match(template, /## 当前判断/);
    assert.match(template, /## 复盘记录/);

    const before = readStockNote(dir, stock, { seed: false, date: "2026-05-08" });
    assert.equal(before.exists, false);
    assert.match(before.content, /# 中芯国际/);

    const saved = writeStockNote(dir, stock, "# 中芯国际\n\n## 当前判断\n\n继续观察。", { seed: false });
    assert.equal(saved.exists, true);
    assert.equal(saved.note_file, path.join("notes", "SH.688981.md"));
    assert.equal(fs.readFileSync(path.join(dir, saved.note_file), "utf-8"), "# 中芯国际\n\n## 当前判断\n\n继续观察。\n");
});

test("since-added performance uses the first price on or after added_at", (t) => {
    const dir = makeTempDir(t);
    seedCatalog(dir);
    const stock = addStock(dir, {
        stock_id: "SH.600000",
    }, { seed: false, now: new Date("2026-05-05T10:00:00.000Z") });
    writeDailyPrices(dir, [
        { stock_id: stock.stock_id, trade_date: "2026-05-04", close: 9, prev_close: 9 },
        { stock_id: stock.stock_id, trade_date: "2026-05-06", close: 10, prev_close: 9 },
        { stock_id: stock.stock_id, trade_date: "2026-05-08", close: 12, prev_close: 10 },
    ], { seed: false });

    const prices = loadStockDetail(dir, stock.stock_id, { seed: false }).prices;
    const sinceAdded = buildStockPerformance(stock, prices, "since_added");
    assert.equal(sinceAdded.reference_trade_date, "2026-05-06");
    assert.equal(sinceAdded.pct_change, 20);
});

test("since-added performance handles exact join date and insufficient prices", (t) => {
    const dir = makeTempDir(t);
    seedCatalog(dir);
    const exact = addStock(dir, {
        stock_id: "SH.688981",
    }, { seed: false, now: new Date("2026-05-06T10:00:00.000Z") });
    const late = addStock(dir, {
        stock_id: "SZ.300308",
    }, { seed: false, now: new Date("2026-05-09T10:00:00.000Z") });
    writeDailyPrices(dir, [
        { stock_id: exact.stock_id, trade_date: "2026-05-06", close: 10, prev_close: 10 },
        { stock_id: exact.stock_id, trade_date: "2026-05-08", close: 11, prev_close: 10 },
        { stock_id: late.stock_id, trade_date: "2026-05-06", close: 20, prev_close: 20 },
        { stock_id: late.stock_id, trade_date: "2026-05-08", close: 21, prev_close: 20 },
    ], { seed: false });

    const exactPrices = loadStockDetail(dir, exact.stock_id, { seed: false }).prices;
    const exactPerf = buildStockPerformance(exact, exactPrices, "since_added");
    assert.equal(exactPerf.reference_trade_date, "2026-05-06");
    assert.equal(exactPerf.pct_change, 10);

    const latePrices = loadStockDetail(dir, late.stock_id, { seed: false }).prices;
    const latePerf = buildStockPerformance(late, latePrices, "since_added");
    assert.equal(latePerf.reference_trade_date, "");
    assert.equal(latePerf.pct_change, null);
});

test("review queue includes threshold hits and skips quiet stocks", (t) => {
    const dir = makeTempDir(t);
    seedCatalog(dir, [
        { code: "600000", exchange: "SH", name: "Weak", market: "A股" },
        { code: "000001", exchange: "SZ", name: "Quiet", market: "A股" },
    ]);
    const weak = addStock(dir, { stock_id: "SH.600000" }, { seed: false, now: new Date("2026-05-04T00:00:00.000Z") });
    const quiet = addStock(dir, { stock_id: "SZ.000001" }, { seed: false, now: new Date("2026-05-04T00:00:00.000Z") });
    const stocks = [weak, quiet];
    const prices = [
        { stock_id: weak.stock_id, trade_date: "2026-05-04", close: 100, prev_close: 100 },
        { stock_id: weak.stock_id, trade_date: "2026-05-05", close: 94, prev_close: 100 },
        { stock_id: weak.stock_id, trade_date: "2026-05-06", close: 93, prev_close: 94 },
        { stock_id: weak.stock_id, trade_date: "2026-05-07", close: 86, prev_close: 93 },
        { stock_id: weak.stock_id, trade_date: "2026-05-08", close: 80, prev_close: 86 },
        { stock_id: quiet.stock_id, trade_date: "2026-05-04", close: 20, prev_close: 20 },
        { stock_id: quiet.stock_id, trade_date: "2026-05-08", close: 20.2, prev_close: 20 },
    ];

    const queue = buildReviewQueue(stocks, prices.map((item) => ({ ...item, source: "test" })), [{
        stock: { name: "未入池股", code: "300001" },
        name: "未入池股",
        code: "300001",
        count: 2,
        in_pool: false,
        articles: [{ article_id: "a1", title: "文章1" }],
    }]);

    assert.ok(queue.some((item) => item.type === "since_added_drop" && item.stock.stock_id === weak.stock_id));
    assert.ok(queue.some((item) => item.type === "day_move" && item.stock.stock_id === weak.stock_id));
    assert.ok(queue.some((item) => item.type === "article_mentions_untracked"));
    assert.equal(queue.some((item) => item.stock?.stock_id === quiet.stock_id), false);
});

test("addStock rejects active duplicates", (t) => {
    const dir = makeTempDir(t);
    seedCatalog(dir);
    addStock(dir, { stock_id: "SZ.300308" }, { seed: false });
    assert.throws(
        () => addStock(dir, { stock_id: "SZ.300308" }, { seed: false }),
        /股票已在关注池中/
    );
});
