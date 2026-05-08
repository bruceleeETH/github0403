import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    buildPersonalNoteTemplate,
    readPersonalNote,
    resolvePersonalNotePath,
    writePersonalNote,
} from "../../src/core/personal-note.mjs";

const meta = {
    articleId: "20260507_fixture_deadbeef",
    title: "测试文章：市场机会与风险",
    account: "测试公众号",
    author: "测试作者",
    publishTime: "2026年5月7日",
    source: "https://mp.weixin.qq.com/s/test",
};

test("buildPersonalNoteTemplate creates a reusable markdown note shape", () => {
    const content = buildPersonalNoteTemplate(meta, { date: "2026-05-08" });

    assert.match(content, /schema: "personal_note\/v1"/);
    assert.match(content, /article_id: "20260507_fixture_deadbeef"/);
    assert.match(content, /created_at: "2026-05-08"/);
    assert.match(content, /# 我的理解/);
    assert.match(content, /## 可验证假设/);
    assert.ok(content.endsWith("\n"));
});

test("readPersonalNote returns a template before the note is saved", (t) => {
    const articleDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-note-read-"));
    t.after(() => fs.rmSync(articleDir, { recursive: true, force: true }));

    const note = readPersonalNote(articleDir, meta, { date: "2026-05-08" });

    assert.equal(note.exists, false);
    assert.equal(note.note_file, "personal_note.md");
    assert.match(note.content, /title: "测试文章：市场机会与风险"/);
    assert.equal(fs.existsSync(resolvePersonalNotePath(articleDir)), false);
});

test("writePersonalNote saves content with a trailing newline", (t) => {
    const articleDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-note-write-"));
    t.after(() => fs.rmSync(articleDir, { recursive: true, force: true }));

    const saved = writePersonalNote(articleDir, "# 我的理解\n\n这篇文章值得复盘。");
    const notePath = resolvePersonalNotePath(articleDir);

    assert.equal(saved.exists, true);
    assert.equal(saved.note_file, "personal_note.md");
    assert.equal(fs.readFileSync(notePath, "utf-8"), "# 我的理解\n\n这篇文章值得复盘。\n");
    assert.match(saved.updated_at, /^\d{4}-\d{2}-\d{2}T/);
});
