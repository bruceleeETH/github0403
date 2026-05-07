import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readIndexRecords, upsertIndexRecord } from "../../src/storage/article-index.mjs";

test("upsertIndexRecord writes jsonl, deduplicates existing records, and keeps richer replacement", (t) => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-index-"));
    t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));

    const indexPath = path.join(outputDir, "articles.jsonl");
    const baseRecord = {
        article_id: "a1",
        title: "旧标题",
        author: "2026年5月7日",
        account: "测试公众号",
        publish_time: "2026年5月7日",
        source_url: "https://mp.weixin.qq.com/s/a",
        captured_at: "2026-05-07T00:00:00.000Z",
    };
    const richerReplacement = {
        ...baseRecord,
        title: "新标题",
        author: "测试作者",
        captured_at: "2026-05-07T01:00:00.000Z",
        keywords: ["机会"],
        markdown_file: "测试公众号/文章/article.md",
        analysis_file: "测试公众号/文章/analysis.json",
    };

    upsertIndexRecord(indexPath, baseRecord);
    upsertIndexRecord(indexPath, richerReplacement);

    const records = readIndexRecords(indexPath);
    assert.equal(records.length, 1);
    assert.equal(records[0].title, "新标题");
    assert.equal(records[0].author, "测试作者");
    assert.deepEqual(records[0].keywords, ["机会"]);
    assert.match(fs.readFileSync(indexPath, "utf-8"), /\n$/);
});
