import test from "node:test";
import assert from "node:assert/strict";
import { renderPersonalNoteMarkdown } from "../../webapp/note-markdown.mjs";

test("renderPersonalNoteMarkdown renders common note blocks safely", () => {
    const html = renderPersonalNoteMarkdown([
        "---",
        "title: test",
        "---",
        "# 标题",
        "- [x] 完成",
        "> 引用",
        "<script>alert(1)</script>",
    ].join("\n"));

    assert.match(html, /personal-note-meta/);
    assert.match(html, /<h1>标题<\/h1>/);
    assert.match(html, /checked/);
    assert.match(html, /blockquote/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
});
