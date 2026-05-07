#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_OUTPUT_DIR } from "../config/constants.mjs";
import { captureArticleToLocal } from "../core/capture-article.mjs";
import { assertWeChatArticleUrl } from "../utils/url.mjs";

const __filename = fileURLToPath(import.meta.url);

export function printHelp() {
    const scriptName = process.argv[1]?.endsWith("save_wechat_article_puppeteer.mjs")
        ? "save_wechat_article_puppeteer.mjs"
        : "src/cli/fetch-article.mjs";
    console.log("用法:");
    console.log(`  node ${scriptName} <公众号文章URL>`);
    console.log(`  node ${scriptName} <公众号文章URL> --output ./wechat_articles`);
    console.log("");
    console.log("说明:");
    console.log("  1) 使用 Puppeteer 打开页面并提取文章标题与正文 HTML");
    console.log("  2) 保存原始页面、正文 HTML 和基础元数据");
    console.log("  3) 评论抓取默认不启用，脚本会输出评论接口观测日志");
}

export function parseArgs(argv) {
    const args = { url: "", output: DEFAULT_OUTPUT_DIR };
    const list = [...argv];
    if (list.length === 0 || list.includes("-h") || list.includes("--help")) {
        printHelp();
        process.exit(0);
    }

    args.url = list[0];
    for (let i = 1; i < list.length; i += 1) {
        if (list[i] === "--output" && list[i + 1]) {
            args.output = path.resolve(process.cwd(), list[i + 1]);
            i += 1;
        }
    }

    assertWeChatArticleUrl(args.url);
    return args;
}

export async function runFetchArticleCli(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const result = await captureArticleToLocal(args.url, { output: args.output });

    console.log("抓取完成");
    console.log(`目录: ${result.articleDir}`);
    console.log(`标题: ${result.meta.title}`);
    console.log(`已下载图片: ${result.downloadedImageCount}/${result.meta.imageCount}`);
    console.log(`离线文件: ${result.offlineHtmlPath}`);
    console.log(`Markdown文件: ${result.markdownPath}`);
    console.log(`评论接口观测记录: ${result.commentLogPath}`);
    console.log("说明: 该记录仅用于排查评论接口，默认不保证能直接拿到评论正文。");
}

if (process.argv[1] === __filename) {
    runFetchArticleCli().catch((err) => {
        console.error("执行失败:", err.message);
        process.exit(1);
    });
}
