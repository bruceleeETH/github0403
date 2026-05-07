import test from "node:test";
import assert from "node:assert/strict";
import { clampDetailPaneWidth, filterArticles, getDetailPaneBounds, parseBatchLinks } from "../../webapp/research-utils.mjs";

test("parseBatchLinks validates, deduplicates, marks existing links, and enforces max count", () => {
    const existing = ["https://mp.weixin.qq.com/s/saved"];
    const input = [
        "https://mp.weixin.qq.com/s/new",
        "https://mp.weixin.qq.com/s/new",
        "https://mp.weixin.qq.com/s/saved",
        "https://mp.weixin.qq.com.evil/s/bad",
    ].join("\n");
    const result = parseBatchLinks(input, existing, { maxLinks: 3 });

    assert.equal(result.overLimit, true);
    assert.deepEqual(result.items.map((item) => item.status), ["pending", "duplicate", "existing", "invalid"]);
});

test("filterArticles supports today, yesterday, 7d, all, and author filters", () => {
    const now = new Date("2026-05-07T12:00:00+08:00");
    const articles = [
        { article_id: "today", author: "作者甲", publish_time: "2026年5月7日 21:00" },
        { article_id: "yesterday", author: "作者甲", publish_time: "2026年5月6日 21:00" },
        { article_id: "week", author: "作者乙", publish_time: "2026年5月2日 21:00" },
        { article_id: "old", author: "作者甲", publish_time: "2026年4月20日 21:00" },
    ];

    assert.deepEqual(filterArticles(articles, { range: "today", now }).map((a) => a.article_id), ["today"]);
    assert.deepEqual(filterArticles(articles, { range: "yesterday", now }).map((a) => a.article_id), ["yesterday"]);
    assert.deepEqual(filterArticles(articles, { range: "7d", now }).map((a) => a.article_id), ["today", "yesterday", "week"]);
    assert.deepEqual(filterArticles(articles, { range: "all", author: "作者甲", now }).map((a) => a.article_id), ["today", "yesterday", "old"]);
});

test("clampDetailPaneWidth keeps the detail pane within desktop layout bounds", () => {
    assert.equal(clampDetailPaneWidth(100, 1440), 340);
    assert.equal(clampDetailPaneWidth(2000, 1440), 672);
    assert.equal(clampDetailPaneWidth("bad", 1440), 460);
    assert.equal(getDetailPaneBounds(900).enabled, false);
});
