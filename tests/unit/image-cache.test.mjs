import test from "node:test";
import assert from "node:assert/strict";
import { extractImageUrlMapFromRawHtml, replaceImageUrlsInHtml } from "../../src/core/image-cache.mjs";

test("extractImageUrlMapFromRawHtml reads data-imgfileid mappings and json cdn urls", () => {
    const rawHtml = `
      <img data-imgfileid="1001" data-src="https://mmbiz.qpic.cn/a.webp?wx_fmt=webp" />
      <script>{"imgfileid":"1002","cdn_url":"https:\\/\\/mmbiz.qpic.cn\\/b.png"}</script>
    `;
    const result = extractImageUrlMapFromRawHtml(rawHtml);

    assert.equal(result.byFileId.get("1001"), "https://mmbiz.qpic.cn/a.webp?wx_fmt=webp");
    assert.equal(result.byFileId.get("1002"), "https://mmbiz.qpic.cn/b.png");
    assert.equal(result.orderedUrls.length, 2);
});

test("replaceImageUrlsInHtml localizes images and removes remaining remote src attributes", () => {
    const urlToLocal = new Map([["https://mmbiz.qpic.cn/a.webp", "images/img_000.webp"]]);
    const html = replaceImageUrlsInHtml(
        '<p><img src="https://mmbiz.qpic.cn/a.webp?x=1"><img data-src="https://remote.example/b.jpg"></p>',
        urlToLocal
    );

    assert.match(html, /images\/img_000.webp/);
    assert.doesNotMatch(html, /data-src="https:\/\/remote\.example/);
});

