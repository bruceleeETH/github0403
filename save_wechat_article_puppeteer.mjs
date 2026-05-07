#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { DEFAULT_OUTPUT_DIR, INDEX_FILE_NAME } from "./src/config/constants.mjs";
import { runFetchArticleCli } from "./src/cli/fetch-article.mjs";
import { buildAnalysis } from "./src/core/analyze-article.mjs";
import { captureArticleToLocal } from "./src/core/capture-article.mjs";
import { buildMarkdown } from "./src/core/export-article.mjs";
import { listAccountArticles } from "./src/core/list-account-articles.mjs";
import { normalizeIndexRecords } from "./src/storage/article-index.mjs";

const __filename = fileURLToPath(import.meta.url);

export {
    captureArticleToLocal,
    listAccountArticles,
    buildAnalysis,
    buildMarkdown,
    DEFAULT_OUTPUT_DIR,
    INDEX_FILE_NAME,
    normalizeIndexRecords,
};

if (process.argv[1] === __filename) {
    runFetchArticleCli().catch((err) => {
        console.error("执行失败:", err.message);
        process.exit(1);
    });
}
