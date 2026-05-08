import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    addStock,
    archiveStock,
    buildStockId,
    buildStockPerformance,
    loadStockDashboard,
    loadStockDetail,
    updateStock,
    writeDailyPrices,
} from "../../src/core/stock-tracker.mjs";

function makeTempDir(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stock-tracker-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

test("addStock normalizes identifiers and seeds test prices", (t) => {
    const dir = makeTempDir(t);
    const stock = addStock(dir, {
        code: "sh.688981",
        name: "中芯国际",
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

test("updateStock and archiveStock keep historical records", (t) => {
    const dir = makeTempDir(t);
    addStock(dir, { code: "300308", name: "中际旭创" }, { seed: false });

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
    const alpha = addStock(dir, { code: "600000", name: "Alpha" }, { seed: false });
    const beta = addStock(dir, { code: "000001", name: "Beta" }, { seed: false });
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
