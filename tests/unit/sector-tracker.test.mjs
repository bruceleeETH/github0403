import test from "node:test";
import assert from "node:assert/strict";
import { buildSectorDashboard, loadSectorDetail } from "../../src/core/sector-tracker.mjs";

const records = [
    {
        article_id: "a1",
        title: "算力继续走强",
        author: "作者甲",
        account: "甲号",
        publish_time: "2026年5月9日 09:30",
        source_url: "https://mp.weixin.qq.com/s/a1",
        analysis: {
            sectors: [{ name: "算力", sentiment: "positive", mentions: ["算力需求"], reason: "订单兑现" }],
            stocks: [{ name: "工业富联", code: "601138" }],
            viewpoints: [{ id: "vp_001", text: "AI算力仍是主线", related_sectors: ["AI算力"], evidence: "需求持续" }],
            key_metrics: { importance_score: 8 },
            market_emotion: { label: "bullish", intensity: 4 },
        },
    },
    {
        article_id: "a2",
        title: "液冷服务器补涨",
        author: "作者乙",
        account: "乙号",
        publish_time: "2026-05-08 15:00",
        source_url: "https://mp.weixin.qq.com/s/a2",
        analysis: {
            sectors: [{ name: "液冷服务器", sentiment: "neutral", mentions: ["液冷"], reason: "补涨扩散" }],
            stocks: [{ name: "中际旭创", code: "300308" }],
            viewpoints: [{ id: "vp_002", text: "液冷服务器扩散到AI算力链", related_sectors: ["液冷服务器"] }],
            key_metrics: { importance_score: 6 },
        },
    },
    {
        article_id: "a3",
        title: "半导体设备分化",
        author: "作者甲",
        account: "甲号",
        publish_time: "2026-05-01",
        source_url: "https://mp.weixin.qq.com/s/a3",
        analysis: {
            sectors: [{ name: "半导体设备", sentiment: "negative", reason: "短线分化" }],
            stocks: [{ name: "中芯国际", code: "688981" }],
            key_metrics: { importance_score: 4 },
        },
    },
];

test("buildSectorDashboard groups aliases and sorts by heat", () => {
    const dashboard = buildSectorDashboard(records, {
        range: "30d",
        now: new Date("2026-05-09T12:00:00+08:00"),
    });

    assert.equal(dashboard.summary.sector_count, 2);
    assert.equal(dashboard.sectors[0].name, "AI算力");
    assert.equal(dashboard.sectors[0].article_count, 2);
    assert.equal(dashboard.sectors[0].author_count, 2);
    assert.deepEqual(dashboard.sectors[0].sentiment_counts, { positive: 1, neutral: 1, negative: 0 });
    assert.ok(dashboard.sectors[0].heat_score > dashboard.sectors[1].heat_score);
});

test("loadSectorDetail returns timeline and viewpoint evidence", () => {
    const detail = loadSectorDetail(records, "AI算力", {
        now: new Date("2026-05-09T12:00:00+08:00"),
    });

    assert.equal(detail.name, "AI算力");
    assert.equal(detail.timeline.length, 2);
    assert.equal(detail.timeline[0].article_id, "a1");
    assert.equal(detail.timeline[0].viewpoints[0].id, "vp_001");
    assert.ok(detail.related_stocks.includes("工业富联(601138)"));
});

test("buildSectorDashboard filters by range and query", () => {
    const dashboard = buildSectorDashboard(records, {
        range: "today",
        query: "算力",
        now: new Date("2026-05-09T12:00:00+08:00"),
    });

    assert.equal(dashboard.summary.article_count, 1);
    assert.equal(dashboard.sectors.length, 1);
    assert.equal(dashboard.sectors[0].name, "AI算力");
});
