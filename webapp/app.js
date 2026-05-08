import {
  BATCH_LINK_LIMIT,
  DETAIL_LAYOUT_CONFIG,
  DETAIL_PANE_WIDTH_KEY,
  DETAIL_PANE_WIDTH_VERSION_KEY,
  clampDetailPaneWidth,
  escapeHtml,
  filterArticles,
  getDetailPaneBounds,
  getArticleDateKey,
  parseBatchLinks,
} from "./research-utils.mjs";

const state = {
  activeView: "articles",
  articles: [],
  authors: [],
  stockDashboard: { stocks: [], rankings: [], summary: {} },
  stockReviewQueue: [],
  stockCatalogStatus: { exists: false, count: 0, markets: {} },
  stockCandidate: null,
  stockCandidates: [],
  queue: [],
  queueOverLimit: false,
  selectedAuthor: "",
  selectedArticleId: "",
  selectedStockId: "",
  stockRange: "day",
  stockOrder: "desc",
  editingStockId: "",
  workspaceMode: "list",
  readerDetail: null,
  articleListScrollTop: 0,
  dateRange: "today",
  isFetching: false,
};

const els = {
  articleModeBtn: document.querySelector("#article-mode-btn"),
  stockModeBtn: document.querySelector("#stock-mode-btn"),
  articleSideContent: document.querySelector("#article-side-content"),
  stockSideContent: document.querySelector("#stock-side-content"),
  articleWorkspace: document.querySelector("#article-workspace"),
  stockWorkspace: document.querySelector("#stock-workspace"),
  authorSearch: document.querySelector("#author-search"),
  allAuthorsBtn: document.querySelector("#all-authors-btn"),
  totalArticleCount: document.querySelector("#total-article-count"),
  authorCount: document.querySelector("#author-count"),
  authors: document.querySelector("#authors"),
  stockSearch: document.querySelector("#stock-search"),
  allStocksBtn: document.querySelector("#all-stocks-btn"),
  stockTotalCount: document.querySelector("#stock-total-count"),
  stockSideCount: document.querySelector("#stock-side-count"),
  stockSideList: document.querySelector("#stock-side-list"),
  stockForm: document.querySelector("#stock-form"),
  stockFormTitle: document.querySelector("#stock-form-title"),
  stockFormStatus: document.querySelector("#stock-form-status"),
  stockCatalogStatus: document.querySelector("#stock-catalog-status"),
  updateStockCatalogBtn: document.querySelector("#update-stock-catalog-btn"),
  stockQuery: document.querySelector("#stock-query"),
  stockSelectedId: document.querySelector("#stock-selected-id"),
  stockCandidateList: document.querySelector("#stock-candidate-list"),
  stockTags: document.querySelector("#stock-tags"),
  stockReason: document.querySelector("#stock-reason"),
  saveStockBtn: document.querySelector("#save-stock-btn"),
  cancelStockEditBtn: document.querySelector("#cancel-stock-edit-btn"),
  stockRankNote: document.querySelector("#stock-rank-note"),
  stockCount: document.querySelector("#stock-count"),
  stockRangeTabs: document.querySelectorAll("[data-stock-range]"),
  stockSortToggle: document.querySelector("#stock-sort-toggle"),
  stockRankList: document.querySelector("#stock-rank-list"),
  stockReviewCount: document.querySelector("#stock-review-count"),
  stockReviewList: document.querySelector("#stock-review-list"),
  batchLinks: document.querySelector("#batch-links"),
  linkCounter: document.querySelector("#link-counter"),
  parseLinksBtn: document.querySelector("#parse-links-btn"),
  startFetchBtn: document.querySelector("#start-fetch-btn"),
  batchStatus: document.querySelector("#batch-status"),
  queueList: document.querySelector("#queue-list"),
  activeFilter: document.querySelector("#active-filter"),
  articleCount: document.querySelector("#article-count"),
  workspacePane: document.querySelector(".workspace-pane"),
  articles: document.querySelector("#articles"),
  articlePanel: document.querySelector(".article-panel"),
  readerPanel: document.querySelector("#reader-panel"),
  detail: document.querySelector("#article-detail"),
  detailResizer: document.querySelector("#detail-resizer"),
  detailShrinkBtn: document.querySelector("#detail-shrink-btn"),
  detailGrowBtn: document.querySelector("#detail-grow-btn"),
  detailResetBtn: document.querySelector("#detail-reset-btn"),
  detailTitle: document.querySelector("#detail-title"),
  detailSubtitle: document.querySelector("#detail-subtitle"),
  shell: document.querySelector(".research-shell"),
  rangeTabs: document.querySelectorAll("[data-range]"),
};

let stockSearchTimer = 0;
let stockSearchSeq = 0;

const statusLabels = {
  pending: "等待中",
  invalid: "无效",
  duplicate: "重复",
  existing: "已存在",
  running: "抓取中",
  success: "已完成",
  failed: "失败",
};

async function fetchJson(url, options) {
  const resp = await fetch(url, options);
  const text = await resp.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    if (!resp.ok) throw new Error(text || `HTTP ${resp.status}`);
    throw new Error(`服务返回了非 JSON 响应：${text.slice(0, 120)}`);
  }
  if (!resp.ok) throw new Error(data.error || "请求失败");
  return data;
}

function sentimentLabel(value) {
  const labels = {
    positive: "积极",
    neutral: "中性",
    negative: "消极",
    bullish: "偏多",
    bearish: "偏空",
    mixed: "分歧",
    low: "低",
    medium: "中",
    high: "高",
    unknown: "未知",
    intraday: "日内",
    short_term: "短期",
    mid_term: "中期",
    long_term: "长期",
  };
  return labels[value] || value || "未知";
}

function analysisSourceLabel(analysis) {
  return [analysis?.analysis_provider, analysis?.analysis_model].filter(Boolean).join(" / ");
}

function hasModelAnalysis(analysis) {
  return Boolean(analysis?.analysis_provider && analysis?.analysis_model && analysis.analysis_provider !== "rule" && analysis.analysis_status !== "failed");
}

function indicatorLabels(items, limit = 6) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (typeof item === "string") return item.trim();
      const name = String(item?.name || "").trim();
      const code = String(item?.code || "").trim();
      if (name && code) return `${name}(${code})`;
      return name || code;
    })
    .filter(Boolean)
    .slice(0, limit);
}

function formatStockDate(value) {
  if (!value) return "暂无";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPrice(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "--";
}

function formatPct(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function pctTone(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "flat";
  return number > 0 ? "up" : "down";
}

function rangeLabel(value) {
  return ({
    day: "日",
    "5d": "五日",
    week: "周",
  })[value] || value;
}

function stockTagsText(tags) {
  return Array.isArray(tags) && tags.length ? tags.join("、") : "未设置标签";
}

function stockOptionLabel(stock) {
  if (!stock) return "";
  return `${stock.name || stock.code} ${stock.stock_id || stock.code}`;
}

function formatCatalogStatus(status = {}) {
  if (!status.exists || !status.count) return "股票目录未更新";
  const markets = Object.entries(status.markets || {})
    .map(([market, count]) => `${market} ${count}`)
    .join(" / ");
  return `${markets || `${status.count} 只`} · 更新 ${formatStockDate(status.updated_at)}`;
}

function renderCatalogStatus() {
  if (!els.stockCatalogStatus) return;
  els.stockCatalogStatus.textContent = formatCatalogStatus(state.stockCatalogStatus);
}

function parseStockLabel(label) {
  const text = String(label || "").trim();
  const match = /^(.+?)\(([^()]+)\)$/.exec(text);
  if (match) return { name: match[1].trim(), code: match[2].trim() };
  return { name: text, code: "" };
}

function normalizeStockAnalysisItem(item) {
  if (typeof item === "string") return parseStockLabel(item);
  return {
    name: String(item?.name || "").trim(),
    code: String(item?.code || "").trim(),
    reason: String(item?.reason || item?.evidence || "").trim(),
    sentiment: String(item?.sentiment || "neutral").trim(),
    mentions: Array.isArray(item?.mentions) ? item.mentions : [],
  };
}

function findWatchedStock(item) {
  const normalized = normalizeStockAnalysisItem(item);
  return (state.stockDashboard.stocks || []).find((stock) => (
    stock.status !== "archived" &&
    ((normalized.code && stock.code === normalized.code) || (normalized.name && stock.name === normalized.name))
  ));
}

function getStockSearchQuery() {
  return els.stockSearch?.value.trim() || "";
}

function renderIndicatorItems(items, emptyText, type) {
  if (!Array.isArray(items) || items.length === 0) {
    return `<p class="muted-text">${escapeHtml(emptyText)}</p>`;
  }
  return `
    <div class="indicator-list">
      ${items.map((item) => {
        const label = typeof item === "string" ? item : [item.name, item.code ? `(${item.code})` : ""].filter(Boolean).join("");
        const reason = typeof item === "string" ? "" : item.reason || "";
        const mentions = typeof item === "string" ? [] : item.mentions || [];
        const tone = typeof item === "string" ? "neutral" : item.sentiment || "neutral";
        return `
          <div class="indicator-item" data-type="${escapeHtml(type)}">
            <div class="indicator-item-head">
              <strong>${escapeHtml(label || "未命名")}</strong>
              <span class="sentiment-tag" data-sentiment="${escapeHtml(tone)}">${escapeHtml(sentimentLabel(tone))}</span>
            </div>
            ${reason ? `<p>${escapeHtml(reason)}</p>` : ""}
            ${mentions.length ? `<span class="indicator-mentions">${escapeHtml(mentions.slice(0, 4).join("、"))}</span>` : ""}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderArticleStockItems(items, meta, sectors, keywords) {
  if (!Array.isArray(items) || items.length === 0) {
    return `<p class="muted-text">暂无个股提及</p>`;
  }
  const tagText = [...indicatorLabels(sectors, 6), ...(keywords || []).slice(0, 4)].join("、");
  const articleTitle = meta.title || "";
  const articleAuthor = meta.author || meta.account || "";

  return `
    <div class="indicator-list">
      ${items.map((item) => {
        const normalized = normalizeStockAnalysisItem(item);
        const watched = findWatchedStock(item);
        const label = [normalized.name, normalized.code ? `(${normalized.code})` : ""].filter(Boolean).join("") || "未命名";
        const reason = normalized.reason || "";
        const mentions = normalized.mentions || [];
        const watchReason = [
          articleTitle ? `来自文章《${articleTitle}》` : "来自文章分析",
          articleAuthor ? `作者：${articleAuthor}` : "",
          reason ? `提及理由：${reason}` : "",
        ].filter(Boolean).join("；");
        return `
          <div class="indicator-item article-stock-item">
            <div class="indicator-item-head">
              <strong>${escapeHtml(label)}</strong>
              <span class="sentiment-tag" data-sentiment="${escapeHtml(normalized.sentiment || "neutral")}">${escapeHtml(sentimentLabel(normalized.sentiment || "neutral"))}</span>
            </div>
            ${reason ? `<p>${escapeHtml(reason)}</p>` : ""}
            ${mentions.length ? `<span class="indicator-mentions">${escapeHtml(mentions.slice(0, 4).join("、"))}</span>` : ""}
            <div class="article-stock-actions">
              ${watched ? `
                <button type="button" class="secondary-btn article-stock-open-btn" data-stock-id="${escapeHtml(watched.stock_id)}">已关注，查看</button>
              ` : (normalized.code || normalized.name) ? `
                <button type="button" class="primary-btn article-stock-add-btn"
                  data-query="${escapeHtml(normalized.code || normalized.name)}"
                  data-tags="${escapeHtml(tagText)}"
                  data-reason="${escapeHtml(watchReason)}">加入股票池</button>
              ` : `
                <span class="inline-status" data-tone="warning">缺少名称和代码，无法一键加入</span>
              `}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function setBatchStatus(message, tone = "") {
  els.batchStatus.textContent = message;
  els.batchStatus.dataset.tone = tone;
}

function getExistingUrls() {
  return new Set(state.articles.map((article) => article.source_url).filter(Boolean));
}

function getFilteredArticles() {
  return filterArticles(state.articles, {
    range: state.dateRange,
    author: state.selectedAuthor,
  });
}

function renderAuthors() {
  const query = els.authorSearch.value.trim().toLowerCase();
  const authors = state.authors.filter((author) => {
    const haystack = `${author.author || ""} ${(author.accounts || []).join(" ")}`.toLowerCase();
    return !query || haystack.includes(query);
  });

  els.totalArticleCount.textContent = String(state.articles.length);
  els.authorCount.textContent = `${authors.length} 位`;
  els.allAuthorsBtn.classList.toggle("active", state.selectedAuthor === "");

  if (authors.length === 0) {
    els.authors.innerHTML = `<div class="empty-state compact">暂无博主，先批量抓取文章。</div>`;
    return;
  }

  els.authors.innerHTML = authors.map((author) => {
    const active = state.selectedAuthor === author.author;
    const sentiments = author.sentiments || { positive: 0, neutral: 0, negative: 0 };
    const topicStrip = (author.top_sectors || []).length
      ? `板块 ${author.top_sectors.slice(0, 3).join("、")}`
      : ((author.top_keywords || []).slice(0, 4).join("、") || "暂无关键词");
    return `
      <button class="author-row${active ? " active" : ""}" type="button" data-author="${escapeHtml(author.author)}">
        <span class="author-row-main">
          <strong>${escapeHtml(author.author)}</strong>
          <span>${escapeHtml(author.latest_publish_time || "暂无时间")}</span>
        </span>
        <span class="author-row-meta">
          <span>${author.article_count || 0} 篇</span>
          <span>正 ${sentiments.positive || 0} / 中 ${sentiments.neutral || 0} / 负 ${sentiments.negative || 0}</span>
        </span>
        <span class="keyword-strip">${escapeHtml(topicStrip)}</span>
      </button>
    `;
  }).join("");

  els.authors.querySelectorAll(".author-row").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedAuthor = button.dataset.author || "";
      state.selectedArticleId = "";
      state.workspaceMode = "list";
      state.readerDetail = null;
      renderAll();
      const first = getFilteredArticles()[0];
      if (first) selectArticle(first.article_id);
      else renderEmptyDetail("该博主在当前日期范围内没有文章。");
    });
  });
}

function getVisibleStockRankings() {
  const query = getStockSearchQuery().toLowerCase();
  return (state.stockDashboard.rankings || []).filter((item) => {
    if (!query) return true;
    const stock = item.stock || {};
    const haystack = `${stock.stock_id || ""} ${stock.code || ""} ${stock.name || ""} ${(stock.tags || []).join(" ")}`.toLowerCase();
    return haystack.includes(query);
  });
}

function renderStockSideList() {
  const rankings = getVisibleStockRankings();
  const activeCount = state.stockDashboard.summary?.active_count || 0;
  els.stockTotalCount.textContent = String(activeCount);
  els.stockSideCount.textContent = `${rankings.length} 只`;
  els.allStocksBtn.classList.toggle("active", state.selectedStockId === "");

  if (rankings.length === 0) {
    els.stockSideList.innerHTML = `<div class="empty-state compact">暂无匹配股票。</div>`;
    return;
  }

  els.stockSideList.innerHTML = rankings.map((item) => {
    const stock = item.stock || {};
    const active = state.selectedStockId === stock.stock_id;
    return `
      <button class="author-row stock-side-row${active ? " active" : ""}" type="button" data-stock-id="${escapeHtml(stock.stock_id)}">
        <span class="author-row-main">
          <strong>${escapeHtml(stock.name || stock.code)}</strong>
          <span>${escapeHtml(stock.stock_id || "")}</span>
        </span>
        <span class="author-row-meta">
          <span>${escapeHtml(rangeLabel(state.stockRange))} ${escapeHtml(formatPct(item.pct_change))}</span>
          <span>以来 ${escapeHtml(formatPct(item.since_added?.pct_change))}</span>
        </span>
        <span class="keyword-strip">${escapeHtml(stockTagsText(stock.tags))}</span>
      </button>
    `;
  }).join("");

  els.stockSideList.querySelectorAll("[data-stock-id]").forEach((button) => {
    button.addEventListener("click", () => selectStock(button.dataset.stockId));
  });
}

function renderStockRankings() {
  const rankings = getVisibleStockRankings();
  const latestDate = state.stockDashboard.latest_trade_date || "暂无交易日";
  els.stockCount.textContent = `${rankings.length} 只`;
  els.stockRankNote.textContent = `${rangeLabel(state.stockRange)}表现 · 最新交易日 ${latestDate}`;
  els.stockSortToggle.textContent = state.stockOrder === "desc" ? "降序" : "升序";

  if (rankings.length === 0) {
    els.stockRankList.innerHTML = `<div class="empty-state">股票池为空，先添加一只股票。</div>`;
    return;
  }

  els.stockRankList.innerHTML = rankings.map((item) => {
    const stock = item.stock || {};
    const active = state.selectedStockId === stock.stock_id;
    return `
      <button class="stock-rank-row${active ? " active" : ""}" type="button" data-stock-id="${escapeHtml(stock.stock_id)}">
        <span class="stock-rank-no">${item.rank}</span>
        <span class="stock-rank-main">
          <strong>${escapeHtml(stock.name || stock.code)}</strong>
          <span>${escapeHtml(stock.stock_id || "")} · 加入 ${escapeHtml(formatStockDate(stock.added_at))}</span>
        </span>
        <span class="stock-rank-tags">${escapeHtml(stockTagsText(stock.tags))}</span>
        <span class="stock-rank-price">${escapeHtml(formatPrice(item.latest_price))}</span>
        <span class="stock-rank-pct">
          <strong data-tone="${pctTone(item.pct_change)}">${escapeHtml(formatPct(item.pct_change))}</strong>
          <small>加入以来 ${escapeHtml(formatPct(item.since_added?.pct_change))}</small>
        </span>
      </button>
    `;
  }).join("");

  els.stockRankList.querySelectorAll("[data-stock-id]").forEach((button) => {
    button.addEventListener("click", () => selectStock(button.dataset.stockId));
  });
}

function renderStocks() {
  renderCatalogStatus();
  renderStockSideList();
  renderStockReviewQueue();
  renderStockRankings();
}

function renderStockReviewQueue() {
  const items = state.stockReviewQueue || [];
  els.stockReviewCount.textContent = `${items.length} 条`;
  if (!items.length) {
    els.stockReviewList.innerHTML = `<div class="empty-state compact">当前没有触发复盘规则的股票。</div>`;
    return;
  }

  els.stockReviewList.innerHTML = items.slice(0, 8).map((item) => {
    const stock = item.stock || {};
    const article = item.related_articles?.[0] || {};
    const targetType = stock.stock_id ? "stock" : "article";
    const targetId = stock.stock_id || article.article_id || "";
    return `
      <button class="review-row" type="button" data-target-type="${escapeHtml(targetType)}" data-target-id="${escapeHtml(targetId)}">
        <span class="status-badge" data-status="${item.type === "article_mentions_untracked" ? "existing" : "running"}">${escapeHtml(item.type === "article_mentions_untracked" ? "文章" : "价格")}</span>
        <span class="review-main">
          <strong>${escapeHtml(stock.name || item.reason || "待复盘")}</strong>
          <span>${escapeHtml(item.reason || "")}</span>
        </span>
        <span class="review-action">${escapeHtml(item.action || "复盘")}</span>
      </button>
    `;
  }).join("");

  els.stockReviewList.querySelectorAll(".review-row").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.dataset.targetType === "stock" && button.dataset.targetId) {
        await selectStock(button.dataset.targetId);
      } else if (button.dataset.targetId) {
        await setViewMode("articles");
        await selectArticle(button.dataset.targetId);
      }
    });
  });
}

function renderArticles() {
  const articles = getFilteredArticles();
  els.articleCount.textContent = `${articles.length} 篇`;
  els.activeFilter.textContent = state.selectedAuthor ? `当前博主：${state.selectedAuthor}` : "全部博主";

  if (articles.length === 0) {
    els.articles.innerHTML = `<div class="empty-state">当前筛选下没有文章。</div>`;
    return;
  }

  let lastDate = "";
  els.articles.innerHTML = articles.map((article) => {
    const dateKey = getArticleDateKey(article) || "未识别日期";
    const dateHeader = dateKey !== lastDate ? `<div class="date-divider">${escapeHtml(dateKey)}</div>` : "";
    lastDate = dateKey;
    const active = state.selectedArticleId === article.article_id;
    const sectors = indicatorLabels(article.sectors, 3);
    const stocks = indicatorLabels(article.stocks, 3);
    const indicatorText = [
      sectors.length ? `板块 ${sectors.join("、")}` : "",
      stocks.length ? `个股 ${stocks.join("、")}` : "",
    ].filter(Boolean).join(" / ");
    return `
      ${dateHeader}
      <div class="article-row${active ? " active" : ""}" data-article-id="${escapeHtml(article.article_id)}">
        <button class="article-select-btn" type="button" data-article-id="${escapeHtml(article.article_id)}">
          <span class="article-row-title">${escapeHtml(article.title || "未命名文章")}</span>
          <span class="article-row-meta">
            <span>${escapeHtml(article.author || article.account || "未知作者")}</span>
            <span>${escapeHtml(article.publish_time || "")}</span>
          </span>
          <span class="article-row-keywords">${escapeHtml(indicatorText || (article.keywords || []).slice(0, 5).join("、") || "暂无关键词")}</span>
        </button>
        <button class="article-read-btn" type="button" data-article-id="${escapeHtml(article.article_id)}">阅读</button>
      </div>
    `;
  }).join("");

  els.articles.querySelectorAll(".article-row").forEach((row) => {
    row.addEventListener("click", () => selectArticle(row.dataset.articleId));
  });

  els.articles.querySelectorAll(".article-read-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openArticleReader(button.dataset.articleId);
    });
  });
}

function renderWorkspace() {
  const showingStocks = state.activeView === "stocks";
  els.articleSideContent.hidden = showingStocks;
  els.stockSideContent.hidden = !showingStocks;
  els.articleWorkspace.hidden = showingStocks;
  els.stockWorkspace.hidden = !showingStocks;
  els.articleModeBtn.classList.toggle("active", !showingStocks);
  els.stockModeBtn.classList.toggle("active", showingStocks);
  els.articleModeBtn.setAttribute("aria-selected", showingStocks ? "false" : "true");
  els.stockModeBtn.setAttribute("aria-selected", showingStocks ? "true" : "false");

  if (showingStocks) {
    renderStocks();
    return;
  }

  if (state.workspaceMode === "reader" && state.readerDetail) {
    renderArticleReader(state.readerDetail);
    return;
  }

  state.workspaceMode = "list";
  state.readerDetail = null;
  els.articlePanel.hidden = false;
  els.readerPanel.hidden = true;
  els.readerPanel.innerHTML = "";
  renderArticles();
}

function renderArticleReader(detail) {
  const meta = detail.meta || {};
  const analysis = detail.analysis || {};
  const title = meta.title || detail.title || "未命名文章";
  const author = meta.author || meta.account || detail.author || "未知作者";
  const publishTime = meta.publishTime || detail.publish_time || "";
  const source = meta.source || detail.source_url || "";

  els.articlePanel.hidden = true;
  els.readerPanel.hidden = false;
  els.readerPanel.innerHTML = `
    <div class="reader-toolbar">
      <button id="reader-back-btn" class="reader-back-btn" type="button">返回每日文章</button>
      <div class="reader-meta">
        <span>${escapeHtml(author)}</span>
        <span>${escapeHtml(publishTime)}</span>
        <span>${escapeHtml(sentimentLabel(analysis.sentiment || "neutral"))}</span>
      </div>
    </div>
    <header class="reader-header">
      <h2>${escapeHtml(title)}</h2>
      ${source ? `<a href="${escapeHtml(source)}" target="_blank" rel="noreferrer">原文链接</a>` : ""}
    </header>
    <iframe class="reader-frame" src="${escapeHtml(detail.offline_html_url || "")}" sandbox="allow-same-origin allow-scripts allow-popups"></iframe>
  `;

  els.readerPanel.querySelector("#reader-back-btn")?.addEventListener("click", closeArticleReader);
  els.readerPanel.scrollTo({ top: 0 });
}

function renderQueue() {
  const actionableCount = state.queue.filter((item) => item.status === "pending").length;
  const lineCount = els.batchLinks.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length;
  els.linkCounter.textContent = `${lineCount} / ${BATCH_LINK_LIMIT}`;
  els.linkCounter.dataset.tone = state.queueOverLimit ? "danger" : "";
  els.startFetchBtn.disabled = state.isFetching || state.queueOverLimit || actionableCount === 0;

  if (state.queue.length === 0) {
    els.queueList.innerHTML = `<div class="empty-state compact">解析后会在这里显示抓取队列。</div>`;
    return;
  }

  els.queueList.innerHTML = state.queue.map((item, index) => `
    <div class="queue-row" data-status="${item.status}">
      <span class="queue-index">${index + 1}</span>
      <span class="status-badge" data-status="${item.status}">${statusLabels[item.status] || item.status}</span>
      <span class="queue-main">
        <strong>${escapeHtml(item.title || item.url)}</strong>
        <span>${escapeHtml(item.message || [item.author, item.account, item.publish_time].filter(Boolean).join(" / "))}</span>
      </span>
    </div>
  `).join("");
}

function renderEmptyDetail(message) {
  els.detail.innerHTML = `<div class="detail-empty">${escapeHtml(message)}</div>`;
}

function setDetailHeading(title, subtitle) {
  els.detailTitle.textContent = title;
  els.detailSubtitle.textContent = subtitle;
}

function renderDetailFiles(detail, meta, includeMarkdown = true) {
  return `
    <section class="detail-section">
      <h4>文件入口</h4>
      <div class="link-row">
        <button type="button" class="secondary-btn" data-offline-url="${escapeHtml(detail.offline_html_url || "")}">离线 HTML</button>
        <button type="button" class="secondary-btn" id="share-article-btn" data-article-id="${escapeHtml(meta.articleId || detail.article_id || "")}">分享页面</button>
      </div>
      <div id="offline-frame-wrap" class="offline-frame-wrap" hidden>
        <div class="offline-frame-toolbar">
          <span>离线页面</span>
          <button type="button" id="close-offline-frame">关闭</button>
        </div>
        <iframe id="offline-frame" class="offline-frame" sandbox="allow-same-origin allow-scripts allow-popups"></iframe>
      </div>
    </section>

    ${detail.image_urls?.length ? `
      <details class="detail-disclosure">
        <summary>图片 ${detail.image_urls.length} 张</summary>
        <div class="image-gallery">
          ${detail.image_urls.map((url, index) => `<img src="${escapeHtml(url)}" alt="文章图片 ${index + 1}" loading="lazy" />`).join("")}
        </div>
      </details>
    ` : ""}

    ${includeMarkdown ? `
      <details class="detail-disclosure">
        <summary>Markdown</summary>
        <pre class="markdown-box">${escapeHtml(detail.markdown || "")}</pre>
      </details>
    ` : ""}
  `;
}

function renderPersonalNoteSection(detail, meta) {
  const articleId = meta.articleId || detail.article_id || "";
  return `
    <section class="detail-section personal-note-section" data-article-id="${escapeHtml(articleId)}">
      <div class="personal-note-head">
        <h4>我的笔记</h4>
        <div class="personal-note-head-actions">
          <div class="personal-note-mode" role="tablist" aria-label="笔记视图">
            <button type="button" class="personal-note-mode-btn active" data-note-mode="preview" role="tab" aria-selected="true">预览</button>
            <button type="button" class="personal-note-mode-btn" data-note-mode="edit" role="tab" aria-selected="false">编辑</button>
          </div>
          <span class="inline-status" id="personal-note-status">加载中...</span>
        </div>
      </div>
      <div id="personal-note-preview" class="personal-note-preview" aria-live="polite"></div>
      <textarea id="personal-note-input" class="personal-note-input" spellcheck="false" disabled hidden></textarea>
      <div class="personal-note-actions">
        <button type="button" class="primary-btn" id="save-personal-note-btn" disabled>保存笔记</button>
        <span class="inline-status" id="personal-note-save-status"></span>
      </div>
    </section>
  `;
}

function renderDetail(detail) {
  setDetailHeading("文章详情", "摘要、观点和本地文件入口");
  const meta = detail.meta || {};
  const analysis = detail.analysis || {};
  const analyzed = hasModelAnalysis(analysis);
  const viewpoints = analysis.viewpoints || [];
  const keywords = analysis.keywords || [];
  const sectors = analysis.sectors || [];
  const stocks = analysis.stocks || [];
  const emotion = analysis.market_emotion || {};
  const metrics = analysis.key_metrics || {};
  const modelLabel = analysisSourceLabel(analysis);

  if (!analyzed) {
    els.detail.innerHTML = `
      <article class="detail-content">
        <header class="detail-title-block">
          <h3>${escapeHtml(meta.title || detail.title || "未命名文章")}</h3>
          <p>${escapeHtml(meta.author || meta.account || detail.author || "未知作者")} · ${escapeHtml(meta.publishTime || detail.publish_time || "")}</p>
        </header>

        <section class="detail-section analysis-empty-panel">
          <h4>模型分析</h4>
          <p>${escapeHtml(analysis.analysis_note || "旧版规则分析已清除，可点击立刻分析使用模型重新提炼。")}</p>
          <div class="analysis-action-row">
            <button type="button" class="primary-btn" id="analyze-now-btn" data-article-id="${escapeHtml(meta.articleId || detail.article_id || "")}">立刻分析</button>
            <span class="inline-status" id="analysis-action-status">将使用当前配置的模型分析这篇文章。</span>
          </div>
        </section>

        ${renderPersonalNoteSection(detail, meta)}

        ${renderDetailFiles(detail, meta, false)}
      </article>
    `;
    bindDetailFileActions();
    return;
  }

  els.detail.innerHTML = `
    <article class="detail-content">
      <header class="detail-title-block">
        <span class="sentiment-tag" data-sentiment="${escapeHtml(analysis.sentiment || "neutral")}">${escapeHtml(sentimentLabel(analysis.sentiment || "neutral"))}</span>
        <h3>${escapeHtml(meta.title || detail.title || "未命名文章")}</h3>
        <p>${escapeHtml(meta.author || meta.account || detail.author || "未知作者")} · ${escapeHtml(meta.publishTime || detail.publish_time || "")}</p>
      </header>

      <section class="detail-section">
        <h4>关键指标</h4>
        <p class="analysis-source">以下内容经过 ${escapeHtml(modelLabel)} 模型分析。</p>
        <div class="metric-grid">
          <div class="metric-item">
            <span>市场情绪</span>
            <strong>${escapeHtml(sentimentLabel(emotion.label || "neutral"))}</strong>
            <p>${escapeHtml(emotion.description || "暂无情绪说明")}</p>
          </div>
          <div class="metric-item">
            <span>情绪强度</span>
            <strong>${escapeHtml(String(emotion.intensity || 0))}</strong>
            <p>1-5</p>
          </div>
          <div class="metric-item">
            <span>重要度</span>
            <strong>${escapeHtml(String(metrics.importance_score || 0))}</strong>
            <p>1-10</p>
          </div>
          <div class="metric-item">
            <span>风险</span>
            <strong>${escapeHtml(sentimentLabel(metrics.risk_level || "unknown"))}</strong>
            <p>${escapeHtml(sentimentLabel(metrics.time_horizon || "unknown"))}</p>
          </div>
        </div>
      </section>

      <section class="detail-section">
        <h4>关键词</h4>
        <div class="pill-row">
          ${keywords.length ? keywords.map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join("") : "<span class=\"muted-text\">暂无关键词</span>"}
        </div>
      </section>

      <section class="detail-section">
        <h4>自动摘要</h4>
        <p>${escapeHtml(analysis.summary || "暂无摘要")}</p>
      </section>

      <section class="detail-section">
        <h4>板块</h4>
        ${renderIndicatorItems(sectors, "暂无板块提及", "sector")}
      </section>

      <section class="detail-section">
        <h4>个股</h4>
        ${renderArticleStockItems(stocks, meta, sectors, keywords)}
      </section>

      <section class="detail-section">
        <h4>核心观点</h4>
        <div class="viewpoint-list">
          ${viewpoints.length ? viewpoints.map((item) => `
            <div class="viewpoint-item">
              <strong>${escapeHtml(item.id)}</strong>
              <p>${escapeHtml(item.text)}</p>
              ${item.evidence ? `<span>${escapeHtml(item.evidence)}</span>` : ""}
            </div>
          `).join("") : "<p class=\"muted-text\">暂无观点片段</p>"}
        </div>
      </section>

      ${renderPersonalNoteSection(detail, meta)}

      ${renderDetailFiles(detail, meta, true)}
    </article>
  `;

  bindDetailFileActions();
}

function formatNoteTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderInlineMarkdown(text) {
  let html = escapeHtml(text || "");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return html;
}

function renderMarkdownList(items, ordered = false) {
  const tag = ordered ? "ol" : "ul";
  return `<${tag}>${items.map((item) => `<li>${item}</li>`).join("")}</${tag}>`;
}

function renderPersonalNoteMarkdown(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let listItems = [];
  let orderedListItems = [];
  let quoteLines = [];
  let inCode = false;
  let codeLines = [];
  let inFrontmatter = false;
  let frontmatterLines = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (listItems.length) {
      html.push(renderMarkdownList(listItems));
      listItems = [];
    }
    if (orderedListItems.length) {
      html.push(renderMarkdownList(orderedListItems, true));
      orderedListItems = [];
    }
  };
  const flushQuote = () => {
    if (!quoteLines.length) return;
    html.push(`<blockquote>${quoteLines.map((line) => `<p>${renderInlineMarkdown(line)}</p>`).join("")}</blockquote>`);
    quoteLines = [];
  };
  const flushCode = () => {
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    codeLines = [];
  };
  const flushBlocks = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();

    if (line === "---" && index === 0) {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (line === "---") {
        inFrontmatter = false;
        if (frontmatterLines.length) {
          html.push(`
            <details class="personal-note-meta">
              <summary>元数据</summary>
              <pre>${escapeHtml(frontmatterLines.join("\n"))}</pre>
            </details>
          `);
          frontmatterLines = [];
        }
      } else {
        frontmatterLines.push(rawLine);
      }
      continue;
    }

    if (line.startsWith("```")) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushBlocks();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(rawLine);
      continue;
    }

    if (!line) {
      flushBlocks();
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      flushBlocks();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (line.startsWith(">")) {
      flushParagraph();
      flushList();
      quoteLines.push(line.replace(/^>\s?/, ""));
      continue;
    }

    const task = /^[-*]\s+\[( |x|X)\]\s+(.+)$/.exec(line);
    if (task) {
      flushParagraph();
      flushQuote();
      const checked = task[1].toLowerCase() === "x";
      listItems.push(`<label class="note-task"><input type="checkbox" disabled${checked ? " checked" : ""}> <span>${renderInlineMarkdown(task[2])}</span></label>`);
      continue;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      flushParagraph();
      flushQuote();
      listItems.push(renderInlineMarkdown(bullet[1]));
      continue;
    }

    const ordered = /^\d+\.\s+(.+)$/.exec(line);
    if (ordered) {
      flushParagraph();
      flushQuote();
      orderedListItems.push(renderInlineMarkdown(ordered[1]));
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(rawLine.trim());
  }

  if (inCode) flushCode();
  flushBlocks();

  return html.join("") || `<p class="muted-text">还没有笔记内容。</p>`;
}

function getPersonalNoteControls(articleId) {
  const sections = [...els.detail.querySelectorAll(".personal-note-section")];
  const section = articleId
    ? sections.find((item) => item.dataset.articleId === articleId)
    : sections[0];
  if (!section) return null;
  return {
    section,
    textarea: section.querySelector("#personal-note-input"),
    preview: section.querySelector("#personal-note-preview"),
    saveButton: section.querySelector("#save-personal-note-btn"),
    modeButtons: section.querySelectorAll("[data-note-mode]"),
    status: section.querySelector("#personal-note-status"),
    saveStatus: section.querySelector("#personal-note-save-status"),
  };
}

function setPersonalNoteStatus(controls, text, tone = "") {
  if (!controls?.status) return;
  controls.status.textContent = text;
  controls.status.dataset.tone = tone;
}

function setPersonalNoteSaveStatus(controls, text, tone = "") {
  if (!controls?.saveStatus) return;
  controls.saveStatus.textContent = text;
  controls.saveStatus.dataset.tone = tone;
}

function rememberPersonalNoteCleanStatus(controls, text, tone = "") {
  if (!controls?.section) return;
  controls.section.dataset.cleanStatus = text;
  controls.section.dataset.cleanTone = tone;
  setPersonalNoteStatus(controls, text, tone);
}

function updatePersonalNotePreview(controls) {
  if (!controls?.preview || !controls?.textarea) return;
  controls.preview.innerHTML = renderPersonalNoteMarkdown(controls.textarea.value);
}

function setPersonalNoteMode(controls, mode) {
  if (!controls?.textarea || !controls?.preview) return;
  const isEdit = mode === "edit";
  controls.section.dataset.noteMode = isEdit ? "edit" : "preview";
  controls.textarea.hidden = !isEdit;
  controls.preview.hidden = isEdit;
  if (!isEdit) updatePersonalNotePreview(controls);
  controls.modeButtons?.forEach((button) => {
    const active = button.dataset.noteMode === (isEdit ? "edit" : "preview");
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
}

async function loadPersonalNote(articleId) {
  const controls = getPersonalNoteControls(articleId);
  if (!articleId || !controls) return;

  setPersonalNoteStatus(controls, "加载中...");
  setPersonalNoteSaveStatus(controls, "");

  try {
    const note = await fetchJson(`/api/articles/${encodeURIComponent(articleId)}/note`);
    const current = getPersonalNoteControls(articleId);
    if (!current) return;

    current.textarea.value = note.content || "";
    current.textarea.dataset.savedValue = current.textarea.value;
    current.textarea.disabled = false;
    current.saveButton.disabled = false;
    updatePersonalNotePreview(current);
    setPersonalNoteMode(current, note.exists ? "preview" : "edit");
    rememberPersonalNoteCleanStatus(
      current,
      note.exists ? `已保存 ${formatNoteTimestamp(note.updated_at)}` : "新笔记",
      note.exists ? "success" : ""
    );
  } catch (error) {
    const current = getPersonalNoteControls(articleId);
    if (!current) return;
    current.textarea.disabled = true;
    current.saveButton.disabled = true;
    setPersonalNoteStatus(current, `加载失败：${error.message}`, "danger");
  }
}

async function savePersonalNote(articleId) {
  const controls = getPersonalNoteControls(articleId);
  if (!articleId || !controls) return;

  controls.saveButton.disabled = true;
  controls.saveButton.textContent = "保存中...";
  setPersonalNoteSaveStatus(controls, "正在写入 personal_note.md");

  try {
    const note = await fetchJson(`/api/articles/${encodeURIComponent(articleId)}/note`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: controls.textarea.value }),
    });
    const current = getPersonalNoteControls(articleId);
    if (!current) return;

    current.textarea.value = note.content || "";
    current.textarea.dataset.savedValue = current.textarea.value;
    current.saveButton.disabled = false;
    current.saveButton.textContent = "保存笔记";
    updatePersonalNotePreview(current);
    setPersonalNoteMode(current, "preview");
    rememberPersonalNoteCleanStatus(current, `已保存 ${formatNoteTimestamp(note.updated_at)}`, "success");
    setPersonalNoteSaveStatus(current, "保存完成", "success");
  } catch (error) {
    const current = getPersonalNoteControls(articleId);
    if (!current) return;
    current.saveButton.disabled = false;
    current.saveButton.textContent = "重试保存";
    setPersonalNoteSaveStatus(current, `保存失败：${error.message}`, "danger");
  }
}

async function addArticleStockToPool(button) {
  button.disabled = true;
  button.textContent = "匹配中...";
  try {
    const query = button.dataset.query || "";
    const search = await fetchJson(`/api/stocks/search?q=${encodeURIComponent(query)}&limit=6`);
    const compactQuery = query.replace(/\s+/g, "").toUpperCase();
    const stock = (search.items || []).find((item) => (
      item.stock_id === compactQuery ||
      item.code?.toUpperCase() === compactQuery ||
      item.name?.replace(/\s+/g, "").toUpperCase() === compactQuery
    )) || ((search.items || []).length === 1 ? search.items[0] : null);
    if (!stock?.stock_id) throw new Error("未匹配到唯一股票，请先更新目录或手动添加");
    button.textContent = "加入中...";
    const result = await fetchJson("/api/stocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stock_id: stock.stock_id,
        tags: button.dataset.tags || "",
        watch_reason: button.dataset.reason || "",
      }),
    });
    await refreshStocks();
    button.textContent = "已加入，查看";
    button.classList.remove("primary-btn", "article-stock-add-btn");
    button.classList.add("secondary-btn", "article-stock-open-btn");
    button.dataset.stockId = result.stock?.stock_id || "";
    button.disabled = false;
  } catch (error) {
    button.disabled = false;
    button.textContent = error.message?.includes("已在关注池") ? "已关注" : "重试加入";
    button.title = error.message || "加入失败";
  }
}

function bindArticleStockActions() {
  els.detail.querySelectorAll(".article-stock-add-btn").forEach((button) => {
    button.addEventListener("click", () => addArticleStockToPool(button));
  });
  els.detail.querySelectorAll(".article-stock-open-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const stockId = button.dataset.stockId;
      if (!stockId) return;
      await setViewMode("stocks");
      await selectStock(stockId);
    });
  });
}

function bindPersonalNoteActions() {
  const section = els.detail.querySelector(".personal-note-section");
  const articleId = section?.dataset.articleId || "";
  if (!section || !articleId) return;

  const controls = getPersonalNoteControls(articleId);
  controls?.textarea?.addEventListener("input", () => {
    const changed = controls.textarea.value !== (controls.textarea.dataset.savedValue || "");
    if (changed) {
      setPersonalNoteStatus(controls, "未保存", "warning");
      setPersonalNoteSaveStatus(controls, "");
    } else {
      setPersonalNoteStatus(
        controls,
        controls.section.dataset.cleanStatus || "已保存",
        controls.section.dataset.cleanTone || "success"
      );
      setPersonalNoteSaveStatus(controls, "");
    }
    updatePersonalNotePreview(controls);
  });
  controls?.modeButtons?.forEach((button) => {
    button.addEventListener("click", () => setPersonalNoteMode(controls, button.dataset.noteMode || "preview"));
  });
  controls?.saveButton?.addEventListener("click", () => savePersonalNote(articleId));
  loadPersonalNote(articleId);
}

function bindDetailFileActions() {
  const frameWrap = els.detail.querySelector("#offline-frame-wrap");
  const frame = els.detail.querySelector("#offline-frame");
  bindPersonalNoteActions();
  bindArticleStockActions();

  els.detail.querySelector("[data-offline-url]")?.addEventListener("click", (event) => {
    const url = event.currentTarget.dataset.offlineUrl;
    if (!url) return;
    frame.src = url;
    frameWrap.hidden = false;
  });
  els.detail.querySelector("#close-offline-frame")?.addEventListener("click", () => {
    frameWrap.hidden = true;
    frame.src = "";
  });
  els.detail.querySelector("#share-article-btn")?.addEventListener("click", (event) => {
    const articleId = event.currentTarget.dataset.articleId;
    if (articleId) window.open(`/api/articles/${encodeURIComponent(articleId)}/share`, "_blank");
  });
  els.detail.querySelector("#analyze-now-btn")?.addEventListener("click", (event) => {
    analyzeArticleNow(event.currentTarget.dataset.articleId);
  });
}

async function analyzeArticleNow(articleId) {
  if (!articleId) return;
  const button = els.detail.querySelector("#analyze-now-btn");
  const status = els.detail.querySelector("#analysis-action-status");
  if (button) {
    button.disabled = true;
    button.textContent = "分析中...";
  }
  if (status) {
    status.textContent = "正在提炼核心观点、板块、个股和情绪。";
    status.dataset.tone = "";
  }

  try {
    const detail = await fetchJson(`/api/articles/${encodeURIComponent(articleId)}/analyze`, {
      method: "POST",
    });
    state.selectedArticleId = detail.article_id || articleId;
    if (state.workspaceMode === "reader") {
      state.readerDetail = detail;
      renderArticleReader(detail);
    }
    await refreshAll();
    renderDetail(detail);
  } catch (error) {
    const message = error.message === "Not Found"
      ? "分析接口未加载，请重启 npm start 后重试。"
      : error.message;
    if (button) {
      button.disabled = false;
      button.textContent = "重试分析";
    }
    if (status) {
      status.textContent = `模型分析失败：${message}`;
      status.dataset.tone = "danger";
    }
  }
}

function renderStockDetail(detail) {
  const stock = detail.stock || {};
  const perf = detail.performance || {};
  const related = detail.related_articles || [];
  const prices = detail.prices || [];
  setDetailHeading("股票详情", "价格快照、关注理由和关联文章");

  const metric = (label, item) => `
    <div class="metric-item">
      <span>${escapeHtml(label)}</span>
      <strong data-tone="${pctTone(item?.pct_change)}">${escapeHtml(formatPct(item?.pct_change))}</strong>
      <p>${escapeHtml(item?.reference_trade_date || "--")} → ${escapeHtml(item?.latest_trade_date || "--")}</p>
    </div>
  `;

  els.detail.innerHTML = `
    <article class="detail-content stock-detail-content">
      <header class="detail-title-block stock-detail-title">
        <span class="sentiment-tag stock-status-tag" data-status="${escapeHtml(stock.status || "active")}">${stock.status === "archived" ? "已归档" : "关注中"}</span>
        <h3>${escapeHtml(stock.name || stock.code || "未命名股票")}</h3>
        <p>${escapeHtml(stock.stock_id || "")} · 加入 ${escapeHtml(formatStockDate(stock.added_at))}</p>
      </header>

      <section class="detail-section">
        <h4>表现概览</h4>
        <div class="metric-grid">
          ${metric("日表现", perf.day)}
          ${metric("五日表现", perf.five_day)}
          ${metric("周表现", perf.week)}
          ${metric("加入以来", perf.since_added)}
          <div class="metric-item">
            <span>最新收盘价</span>
            <strong>${escapeHtml(formatPrice(perf.day?.latest_price))}</strong>
            <p>${escapeHtml(perf.day?.latest_trade_date || "暂无交易日")}</p>
          </div>
        </div>
      </section>

      <section class="detail-section">
        <h4>标签</h4>
        <div class="pill-row">
          ${(stock.tags || []).length ? stock.tags.map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join("") : "<span class=\"muted-text\">未设置标签</span>"}
        </div>
      </section>

      <section class="detail-section">
        <h4>关注理由</h4>
        <p>${escapeHtml(stock.watch_reason || "暂无关注理由")}</p>
      </section>

      ${renderStockNoteSection(stock)}

      <section class="detail-section">
        <h4>价格快照</h4>
        <div class="price-table">
          ${prices.slice(0, 10).map((price) => `
            <div class="price-row">
              <span>${escapeHtml(price.trade_date)}</span>
              <strong>${escapeHtml(formatPrice(price.close))}</strong>
              <span data-tone="${pctTone(price.pct_change)}">${escapeHtml(formatPct(price.pct_change))}</span>
            </div>
          `).join("") || "<p class=\"muted-text\">暂无价格快照</p>"}
        </div>
      </section>

      <section class="detail-section">
        <h4>关联文章</h4>
        <div class="related-article-list">
          ${related.length ? related.map((article) => `
            <button class="related-article-item" type="button" data-article-id="${escapeHtml(article.article_id)}">
              <strong>${escapeHtml(article.title || "未命名文章")}</strong>
              <span>${escapeHtml(article.author || article.account || "未知作者")} · ${escapeHtml(article.publish_time || "")}</span>
            </button>
          `).join("") : "<p class=\"muted-text\">暂未从文章分析中匹配到这只股票。</p>"}
        </div>
      </section>

      <section class="detail-section stock-detail-actions">
        <button type="button" class="secondary-btn" id="edit-stock-btn">编辑股票</button>
        <button type="button" class="secondary-btn danger-btn" id="archive-stock-btn">删除/归档</button>
      </section>
    </article>
  `;

  els.detail.querySelector("#edit-stock-btn")?.addEventListener("click", () => startEditStock(stock));
  els.detail.querySelector("#archive-stock-btn")?.addEventListener("click", () => archiveSelectedStock(stock.stock_id));
  bindStockNoteActions(stock.stock_id);
  els.detail.querySelectorAll("[data-article-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      setViewMode("articles");
      await selectArticle(button.dataset.articleId);
    });
  });
}

function renderStockNoteSection(stock) {
  return `
    <section class="detail-section stock-note-section" data-stock-id="${escapeHtml(stock.stock_id || "")}">
      <div class="personal-note-head">
        <h4>股票笔记</h4>
        <div class="personal-note-head-actions">
          <div class="personal-note-mode" role="tablist" aria-label="股票笔记视图">
            <button type="button" class="personal-note-mode-btn active" data-stock-note-mode="preview" role="tab" aria-selected="true">预览</button>
            <button type="button" class="personal-note-mode-btn" data-stock-note-mode="edit" role="tab" aria-selected="false">编辑</button>
          </div>
          <span class="inline-status" id="stock-note-status">加载中...</span>
        </div>
      </div>
      <div id="stock-note-preview" class="personal-note-preview" aria-live="polite"></div>
      <textarea id="stock-note-input" class="personal-note-input" spellcheck="false" disabled hidden></textarea>
      <div class="personal-note-actions">
        <button type="button" class="primary-btn" id="save-stock-note-btn" disabled>保存笔记</button>
        <span class="inline-status" id="stock-note-save-status"></span>
      </div>
    </section>
  `;
}

function getStockNoteControls() {
  const section = els.detail.querySelector(".stock-note-section");
  if (!section) return null;
  return {
    section,
    textarea: section.querySelector("#stock-note-input"),
    preview: section.querySelector("#stock-note-preview"),
    saveButton: section.querySelector("#save-stock-note-btn"),
    modeButtons: section.querySelectorAll("[data-stock-note-mode]"),
    status: section.querySelector("#stock-note-status"),
    saveStatus: section.querySelector("#stock-note-save-status"),
  };
}

function setStockNoteStatus(controls, text, tone = "") {
  if (!controls?.status) return;
  controls.status.textContent = text;
  controls.status.dataset.tone = tone;
}

function setStockNoteSaveStatus(controls, text, tone = "") {
  if (!controls?.saveStatus) return;
  controls.saveStatus.textContent = text;
  controls.saveStatus.dataset.tone = tone;
}

function updateStockNotePreview(controls) {
  if (!controls?.preview || !controls?.textarea) return;
  controls.preview.innerHTML = renderPersonalNoteMarkdown(controls.textarea.value);
}

function setStockNoteMode(controls, mode) {
  if (!controls?.textarea || !controls?.preview) return;
  const isEdit = mode === "edit";
  controls.textarea.hidden = !isEdit;
  controls.preview.hidden = isEdit;
  if (!isEdit) updateStockNotePreview(controls);
  controls.modeButtons?.forEach((button) => {
    const active = button.dataset.stockNoteMode === (isEdit ? "edit" : "preview");
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
}

async function loadStockNote(stockId) {
  const controls = getStockNoteControls();
  if (!controls || !stockId) return;
  setStockNoteStatus(controls, "加载中...");
  try {
    const note = await fetchJson(`/api/stocks/${encodeURIComponent(stockId)}/note`);
    const current = getStockNoteControls();
    if (!current) return;
    current.textarea.value = note.content || "";
    current.textarea.dataset.savedValue = current.textarea.value;
    current.textarea.disabled = false;
    current.saveButton.disabled = false;
    current.section.dataset.cleanStatus = note.exists ? `已保存 ${formatNoteTimestamp(note.updated_at)}` : "新笔记";
    current.section.dataset.cleanTone = note.exists ? "success" : "";
    updateStockNotePreview(current);
    setStockNoteMode(current, note.exists ? "preview" : "edit");
    setStockNoteStatus(current, current.section.dataset.cleanStatus, current.section.dataset.cleanTone);
  } catch (error) {
    const current = getStockNoteControls();
    if (!current) return;
    current.textarea.disabled = true;
    current.saveButton.disabled = true;
    setStockNoteStatus(current, `加载失败：${error.message}`, "danger");
  }
}

async function saveStockNote(stockId) {
  const controls = getStockNoteControls();
  if (!controls || !stockId) return;
  controls.saveButton.disabled = true;
  controls.saveButton.textContent = "保存中...";
  setStockNoteSaveStatus(controls, "正在写入 stock_note.md");
  try {
    const note = await fetchJson(`/api/stocks/${encodeURIComponent(stockId)}/note`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: controls.textarea.value }),
    });
    const current = getStockNoteControls();
    if (!current) return;
    current.textarea.value = note.content || "";
    current.textarea.dataset.savedValue = current.textarea.value;
    current.saveButton.disabled = false;
    current.saveButton.textContent = "保存笔记";
    current.section.dataset.cleanStatus = `已保存 ${formatNoteTimestamp(note.updated_at)}`;
    current.section.dataset.cleanTone = "success";
    updateStockNotePreview(current);
    setStockNoteMode(current, "preview");
    setStockNoteStatus(current, current.section.dataset.cleanStatus, "success");
    setStockNoteSaveStatus(current, "保存完成", "success");
  } catch (error) {
    const current = getStockNoteControls();
    if (!current) return;
    current.saveButton.disabled = false;
    current.saveButton.textContent = "重试保存";
    setStockNoteSaveStatus(current, `保存失败：${error.message}`, "danger");
  }
}

function bindStockNoteActions(stockId) {
  const controls = getStockNoteControls();
  if (!controls || !stockId) return;
  controls.textarea?.addEventListener("input", () => {
    const changed = controls.textarea.value !== (controls.textarea.dataset.savedValue || "");
    setStockNoteStatus(
      controls,
      changed ? "未保存" : (controls.section.dataset.cleanStatus || "已保存"),
      changed ? "warning" : (controls.section.dataset.cleanTone || "success")
    );
    setStockNoteSaveStatus(controls, "");
    updateStockNotePreview(controls);
  });
  controls.modeButtons?.forEach((button) => {
    button.addEventListener("click", () => setStockNoteMode(controls, button.dataset.stockNoteMode || "preview"));
  });
  controls.saveButton?.addEventListener("click", () => saveStockNote(stockId));
  loadStockNote(stockId);
}

function renderStockCandidates() {
  if (!els.stockCandidateList) return;
  if (state.editingStockId) {
    els.stockCandidateList.innerHTML = "";
    return;
  }
  const query = els.stockQuery?.value.trim() || "";
  if (state.stockCandidate) {
    els.stockCandidateList.innerHTML = `
      <div class="stock-candidate-selected">
        <strong>${escapeHtml(state.stockCandidate.name || state.stockCandidate.code)}</strong>
        <span>${escapeHtml(state.stockCandidate.stock_id || "")} · ${escapeHtml(state.stockCandidate.market || "")}</span>
      </div>
    `;
    return;
  }
  if (!query) {
    els.stockCandidateList.innerHTML = "";
    return;
  }
  if (!state.stockCandidates.length) {
    els.stockCandidateList.innerHTML = `<div class="empty-state compact">未找到候选股票。</div>`;
    return;
  }
  els.stockCandidateList.innerHTML = state.stockCandidates.map((stock) => `
    <button type="button" class="stock-candidate-row" data-stock-id="${escapeHtml(stock.stock_id)}">
      <span>
        <strong>${escapeHtml(stock.name || stock.code)}</strong>
        <small>${escapeHtml(stock.stock_id || stock.code)}</small>
      </span>
      <em>${escapeHtml(stock.market || stock.exchange || "")}</em>
    </button>
  `).join("");
  els.stockCandidateList.querySelectorAll("[data-stock-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const stock = state.stockCandidates.find((item) => item.stock_id === button.dataset.stockId);
      if (!stock) return;
      state.stockCandidate = stock;
      els.stockSelectedId.value = stock.stock_id || "";
      els.stockQuery.value = stockOptionLabel(stock);
      renderStockCandidates();
    });
  });
}

async function searchStockCandidates(query) {
  const currentSeq = ++stockSearchSeq;
  state.stockCandidate = null;
  els.stockSelectedId.value = "";
  if (!query.trim()) {
    state.stockCandidates = [];
    renderStockCandidates();
    return;
  }
  try {
    const data = await fetchJson(`/api/stocks/search?q=${encodeURIComponent(query)}&limit=8`);
    if (currentSeq !== stockSearchSeq) return;
    state.stockCandidates = data.items || [];
    state.stockCatalogStatus = data.status || state.stockCatalogStatus;
    renderStockCandidates();
    renderCatalogStatus();
  } catch (error) {
    state.stockCandidates = [];
    els.stockCandidateList.innerHTML = `<div class="empty-state compact">${escapeHtml(error.message || "搜索失败")}</div>`;
  }
}

async function resolveStockCandidateForSubmit() {
  if (state.stockCandidate?.stock_id) return state.stockCandidate;
  const query = els.stockQuery.value.trim();
  if (!query) return null;
  const data = await fetchJson(`/api/stocks/search?q=${encodeURIComponent(query)}&limit=6`);
  const compactQuery = query.replace(/\s+/g, "").toUpperCase();
  const candidates = data.items || [];
  return candidates.find((stock) => (
    stock.stock_id === compactQuery ||
    stock.code?.toUpperCase() === compactQuery ||
    stock.name?.replace(/\s+/g, "").toUpperCase() === compactQuery
  )) || (candidates.length === 1 ? candidates[0] : null);
}

function resetStockForm() {
  state.editingStockId = "";
  state.stockCandidate = null;
  state.stockCandidates = [];
  els.stockForm.reset();
  els.stockQuery.disabled = false;
  els.stockSelectedId.value = "";
  renderStockCandidates();
  els.stockFormTitle.textContent = "添加股票";
  els.saveStockBtn.textContent = "添加股票";
  els.cancelStockEditBtn.hidden = true;
  els.stockFormStatus.textContent = "";
  els.stockFormStatus.dataset.tone = "";
}

function startEditStock(stock) {
  state.editingStockId = stock.stock_id || "";
  state.stockCandidate = stock;
  state.stockCandidates = [];
  els.stockFormTitle.textContent = "编辑股票";
  els.saveStockBtn.textContent = "保存修改";
  els.cancelStockEditBtn.hidden = false;
  els.stockQuery.value = stockOptionLabel(stock);
  els.stockQuery.disabled = true;
  els.stockSelectedId.value = stock.stock_id || "";
  renderStockCandidates();
  els.stockTags.value = (stock.tags || []).join("、");
  els.stockReason.value = stock.watch_reason || "";
  els.stockFormStatus.textContent = "正在编辑当前股票";
  els.stockFormStatus.dataset.tone = "";
  els.stockForm.scrollIntoView({ block: "start", behavior: "smooth" });
}

async function submitStockForm(event) {
  event.preventDefault();
  const isEdit = Boolean(state.editingStockId);
  els.saveStockBtn.disabled = true;
  els.stockFormStatus.textContent = isEdit ? "正在保存修改..." : "正在添加股票...";
  els.stockFormStatus.dataset.tone = "";

  try {
    const candidate = isEdit ? null : await resolveStockCandidateForSubmit();
    if (!isEdit && !candidate?.stock_id) {
      els.stockFormStatus.textContent = "请先选择股票候选";
      els.stockFormStatus.dataset.tone = "warning";
      return;
    }
    const payload = {
      ...(isEdit ? {} : { stock_id: candidate.stock_id }),
      tags: els.stockTags.value,
      watch_reason: els.stockReason.value,
    };
    const result = await fetchJson(isEdit
      ? `/api/stocks/${encodeURIComponent(state.editingStockId)}`
      : "/api/stocks", {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    resetStockForm();
    await refreshStocks();
    const stockId = result.stock?.stock_id;
    if (stockId) await selectStock(stockId);
    els.stockFormStatus.textContent = isEdit ? "修改已保存" : "股票已加入关注池";
    els.stockFormStatus.dataset.tone = "success";
  } catch (error) {
    els.stockFormStatus.textContent = error.message || "保存失败";
    els.stockFormStatus.dataset.tone = "danger";
  } finally {
    els.saveStockBtn.disabled = false;
  }
}

async function archiveSelectedStock(stockId) {
  if (!stockId) return;
  const confirmed = window.confirm("确认将这只股票从关注池归档？历史价格会保留。");
  if (!confirmed) return;
  try {
    await fetchJson(`/api/stocks/${encodeURIComponent(stockId)}`, { method: "DELETE" });
    state.selectedStockId = "";
    await refreshStocks();
    renderEmptyDetail("股票已归档。");
  } catch (error) {
    renderEmptyDetail(`归档失败：${error.message}`);
  }
}

function renderAll() {
  renderAuthors();
  renderWorkspace();
  renderQueue();
  renderStocks();
}

function applyDetailLayoutConfig() {
  const root = document.documentElement;
  const config = DETAIL_LAYOUT_CONFIG;
  root.style.setProperty("--side-pane-width", `${config.sideWidth}px`);
  root.style.setProperty("--side-pane-width-compact", `${config.compactSideWidth}px`);
  root.style.setProperty("--workspace-min-width", `${config.workspaceMinWidth}px`);
  root.style.setProperty("--workspace-min-width-compact", `${config.compactWorkspaceMinWidth}px`);
  root.style.setProperty("--resizer-width", `${config.splitterWidth}px`);
  root.style.setProperty("--detail-pane-min-width", `${config.minWidth}px`);
  root.style.setProperty("--detail-pane-default-width", `${config.defaultWidth}px`);
  root.style.setProperty("--detail-pane-default-width-compact", `${config.compactDefaultWidth}px`);
  root.style.setProperty("--detail-pane-max-width", `${config.preferredMaxWidth}px`);
}

function setDetailPaneWidth(width, persist = false) {
  const nextWidth = clampDetailPaneWidth(width, window.innerWidth);
  const bounds = getDetailPaneBounds(window.innerWidth);
  if (!bounds.enabled) {
    els.shell.style.removeProperty("--detail-pane-width");
    return;
  }
  els.shell.style.setProperty("--detail-pane-width", `${nextWidth}px`);
  els.detailResizer.setAttribute("aria-valuemin", String(bounds.min));
  els.detailResizer.setAttribute("aria-valuemax", String(bounds.max));
  els.detailResizer.setAttribute("aria-valuenow", String(nextWidth));
  if (persist) {
    localStorage.setItem(DETAIL_PANE_WIDTH_KEY, String(nextWidth));
    localStorage.setItem(DETAIL_PANE_WIDTH_VERSION_KEY, DETAIL_LAYOUT_CONFIG.version);
  }
}

function restoreDetailPaneWidth() {
  const storedVersion = localStorage.getItem(DETAIL_PANE_WIDTH_VERSION_KEY);
  if (storedVersion !== DETAIL_LAYOUT_CONFIG.version) {
    localStorage.removeItem(DETAIL_PANE_WIDTH_KEY);
    localStorage.setItem(DETAIL_PANE_WIDTH_VERSION_KEY, DETAIL_LAYOUT_CONFIG.version);
  }
  const stored = localStorage.getItem(DETAIL_PANE_WIDTH_KEY);
  setDetailPaneWidth(stored || getDetailPaneBounds(window.innerWidth).defaultWidth);
}

function resetDetailPaneWidth() {
  localStorage.removeItem(DETAIL_PANE_WIDTH_KEY);
  localStorage.setItem(DETAIL_PANE_WIDTH_VERSION_KEY, DETAIL_LAYOUT_CONFIG.version);
  setDetailPaneWidth(getDetailPaneBounds(window.innerWidth).defaultWidth);
}

function adjustDetailPaneWidth(delta) {
  const current = Number(els.detailResizer.getAttribute("aria-valuenow")) || getDetailPaneBounds(window.innerWidth).defaultWidth;
  setDetailPaneWidth(current + delta, true);
}

function setupDetailResizer() {
  let dragStartX = 0;
  let startWidth = 0;

  const stopDragging = () => {
    document.body.classList.remove("is-resizing-detail");
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stopDragging);
  };

  function onPointerMove(event) {
    const nextWidth = startWidth - (event.clientX - dragStartX);
    setDetailPaneWidth(nextWidth, true);
  }

  els.detailResizer.addEventListener("pointerdown", (event) => {
    if (!getDetailPaneBounds(window.innerWidth).enabled) return;
    event.preventDefault();
    dragStartX = event.clientX;
    startWidth = Number.parseInt(getComputedStyle(els.shell).getPropertyValue("--detail-pane-width"), 10)
      || getDetailPaneBounds(window.innerWidth).defaultWidth;
    document.body.classList.add("is-resizing-detail");
    els.detailResizer.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDragging);
  });

  els.detailResizer.addEventListener("keydown", (event) => {
    if (!getDetailPaneBounds(window.innerWidth).enabled) return;
    const current = Number(els.detailResizer.getAttribute("aria-valuenow")) || getDetailPaneBounds(window.innerWidth).defaultWidth;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setDetailPaneWidth(current + 24, true);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setDetailPaneWidth(current - 24, true);
    }
    if (event.key === "Home") {
      event.preventDefault();
      setDetailPaneWidth(getDetailPaneBounds(window.innerWidth).min, true);
    }
    if (event.key === "End") {
      event.preventDefault();
      setDetailPaneWidth(getDetailPaneBounds(window.innerWidth).max, true);
    }
  });

  window.addEventListener("resize", () => {
    const current = localStorage.getItem(DETAIL_PANE_WIDTH_KEY) || getDetailPaneBounds(window.innerWidth).defaultWidth;
    setDetailPaneWidth(current);
  });

  els.detailShrinkBtn.addEventListener("click", () => adjustDetailPaneWidth(-DETAIL_LAYOUT_CONFIG.step));
  els.detailGrowBtn.addEventListener("click", () => adjustDetailPaneWidth(DETAIL_LAYOUT_CONFIG.step));
  els.detailResetBtn.addEventListener("click", resetDetailPaneWidth);
}

async function setViewMode(viewMode) {
  state.activeView = viewMode === "stocks" ? "stocks" : "articles";
  if (state.activeView === "stocks") {
    state.workspaceMode = "list";
    state.readerDetail = null;
    setDetailHeading("股票详情", "价格快照、关注理由和关联文章");
    renderWorkspace();
    if (!state.stockDashboard.rankings.length) await refreshStocks();
    const selectedStillVisible = state.stockDashboard.rankings.some((item) => item.stock?.stock_id === state.selectedStockId);
    if (state.selectedStockId && selectedStillVisible) {
      await selectStock(state.selectedStockId);
    } else {
      const first = getVisibleStockRankings()[0];
      if (first?.stock?.stock_id) await selectStock(first.stock.stock_id);
      else renderEmptyDetail("添加股票后，这里会显示价格、表现和关联文章。");
    }
    return;
  }

  setDetailHeading("文章详情", "摘要、观点和本地文件入口");
  renderWorkspace();
  if (state.selectedArticleId) await selectArticle(state.selectedArticleId);
  else {
    const first = getFilteredArticles()[0];
    if (first) await selectArticle(first.article_id);
    else renderEmptyDetail("粘贴链接开始抓取，或从每日文章中选择一篇查看。");
  }
}

async function selectArticle(articleId) {
  if (!articleId) return;
  state.activeView = "articles";
  state.selectedArticleId = articleId;
  renderArticles();
  els.detail.innerHTML = `<div class="detail-empty">正在加载文章详情...</div>`;
  try {
    const detail = await fetchJson(`/api/articles/${encodeURIComponent(articleId)}`);
    renderDetail(detail);
  } catch (error) {
    renderEmptyDetail(`加载失败：${error.message}`);
  }
}

async function refreshStocks() {
  const query = getStockSearchQuery();
  const [data, review] = await Promise.all([
    fetchJson(`/api/stocks?range=${encodeURIComponent(state.stockRange)}&order=${encodeURIComponent(state.stockOrder)}&q=${encodeURIComponent(query)}`),
    fetchJson("/api/stocks/review-queue"),
  ]);
  state.stockDashboard = data;
  state.stockReviewQueue = review.items || [];
  renderStocks();
}

async function refreshStockCatalogStatus() {
  const status = await fetchJson("/api/stocks/catalog/status");
  state.stockCatalogStatus = status;
  renderCatalogStatus();
  return status;
}

async function updateStockCatalog() {
  els.updateStockCatalogBtn.disabled = true;
  els.updateStockCatalogBtn.textContent = "更新中...";
  els.stockFormStatus.textContent = "正在更新股票目录";
  els.stockFormStatus.dataset.tone = "";
  try {
    const result = await fetchJson("/api/stocks/catalog/update", { method: "POST" });
    state.stockCatalogStatus = result.status || await refreshStockCatalogStatus();
    state.stockCandidate = null;
    state.stockCandidates = [];
    renderCatalogStatus();
    renderStockCandidates();
    els.stockFormStatus.textContent = `目录已更新：${state.stockCatalogStatus.count || result.total || 0} 只`;
    els.stockFormStatus.dataset.tone = "success";
  } catch (error) {
    els.stockFormStatus.textContent = error.message || "目录更新失败";
    els.stockFormStatus.dataset.tone = "danger";
  } finally {
    els.updateStockCatalogBtn.disabled = false;
    els.updateStockCatalogBtn.textContent = "更新股票目录";
  }
}

async function selectStock(stockId) {
  if (!stockId) return;
  state.activeView = "stocks";
  state.selectedStockId = stockId;
  renderWorkspace();
  els.detail.innerHTML = `<div class="detail-empty">正在加载股票详情...</div>`;
  try {
    const detail = await fetchJson(`/api/stocks/${encodeURIComponent(stockId)}`);
    renderStockDetail(detail);
    renderStocks();
  } catch (error) {
    renderEmptyDetail(`加载失败：${error.message}`);
  }
}

async function openArticleReader(articleId) {
  if (!articleId) return;
  state.activeView = "articles";
  state.articleListScrollTop = els.workspacePane?.scrollTop || 0;
  state.selectedArticleId = articleId;
  renderArticles();
  els.readerPanel.hidden = false;
  els.readerPanel.innerHTML = `<div class="empty-state">正在打开文章原文...</div>`;
  try {
    const detail = await fetchJson(`/api/articles/${encodeURIComponent(articleId)}`);
    state.workspaceMode = "reader";
    state.readerDetail = detail;
    renderArticleReader(detail);
    renderDetail(detail);
  } catch (error) {
    state.workspaceMode = "list";
    state.readerDetail = null;
    renderWorkspace();
    renderEmptyDetail(`加载失败：${error.message}`);
  }
}

function closeArticleReader() {
  state.workspaceMode = "list";
  state.readerDetail = null;
  renderWorkspace();
  requestAnimationFrame(() => {
    els.workspacePane.scrollTop = state.articleListScrollTop || 0;
  });
}

async function refreshAll() {
  const [{ articles }, { authors }, stockDashboard, review, catalogStatus] = await Promise.all([
    fetchJson("/api/articles"),
    fetchJson("/api/authors"),
    fetchJson(`/api/stocks?range=${encodeURIComponent(state.stockRange)}&order=${encodeURIComponent(state.stockOrder)}&q=${encodeURIComponent(getStockSearchQuery())}`),
    fetchJson("/api/stocks/review-queue"),
    fetchJson("/api/stocks/catalog/status"),
  ]);
  state.articles = articles;
  state.authors = authors;
  state.stockDashboard = stockDashboard;
  state.stockReviewQueue = review.items || [];
  state.stockCatalogStatus = catalogStatus;
  renderAll();

  if (state.activeView === "stocks") {
    if (!state.selectedStockId) {
      const first = getVisibleStockRankings()[0];
      if (first?.stock?.stock_id) await selectStock(first.stock.stock_id);
    }
    return;
  }

  if (!state.selectedArticleId) {
    const first = getFilteredArticles()[0];
    if (first) await selectArticle(first.article_id);
  }
}

function parseQueueFromInput() {
  const parsed = parseBatchLinks(els.batchLinks.value, getExistingUrls());
  state.queue = parsed.items;
  state.queueOverLimit = parsed.overLimit;

  if (parsed.overLimit) {
    setBatchStatus(`一次最多支持 ${parsed.limit} 个链接，请删减后再抓取。`, "danger");
  } else {
    const pending = state.queue.filter((item) => item.status === "pending").length;
    setBatchStatus(pending ? `可抓取 ${pending} 篇。` : "没有可抓取的新链接。", pending ? "" : "muted");
  }
  renderQueue();
}

async function runFetchQueue() {
  parseQueueFromInput();
  if (state.queueOverLimit || state.queue.every((item) => item.status !== "pending")) return;

  state.isFetching = true;
  renderQueue();
  let lastArticleId = "";
  let successCount = 0;
  let failCount = 0;

  for (const item of state.queue) {
    if (item.status !== "pending") continue;
    item.status = "running";
    item.message = "正在抓取并分析";
    renderQueue();

    try {
      const result = await fetchJson("/api/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: item.url }),
      });
      item.status = "success";
      item.title = result.title || item.url;
      item.author = result.author || "";
      item.account = result.account || "";
      item.publish_time = result.publish_time || "";
      item.article_id = result.article_id || "";
      item.message = "抓取完成";
      lastArticleId = result.article_id || lastArticleId;
      successCount += 1;
      await refreshAll();
    } catch (error) {
      item.status = "failed";
      item.message = error.message || "抓取失败";
      failCount += 1;
    }
    renderQueue();
  }

  state.isFetching = false;
  setBatchStatus(`抓取完成：${successCount} 篇成功${failCount ? `，${failCount} 篇失败` : ""}。`, failCount ? "warning" : "success");
  await refreshAll();
  if (lastArticleId) await selectArticle(lastArticleId);
  renderQueue();
}

els.authorSearch.addEventListener("input", renderAuthors);

els.articleModeBtn.addEventListener("click", () => setViewMode("articles"));
els.stockModeBtn.addEventListener("click", () => setViewMode("stocks"));

els.stockSearch.addEventListener("input", async () => {
  try {
    await refreshStocks();
  } catch (error) {
    renderEmptyDetail(`股票筛选失败：${error.message}`);
  }
});

els.allStocksBtn.addEventListener("click", async () => {
  state.selectedStockId = "";
  els.stockSearch.value = "";
  await refreshStocks();
  const first = getVisibleStockRankings()[0];
  if (first?.stock?.stock_id) selectStock(first.stock.stock_id);
  else renderEmptyDetail("股票池为空，先添加一只股票。");
});

els.stockForm.addEventListener("submit", submitStockForm);
els.cancelStockEditBtn.addEventListener("click", resetStockForm);
els.updateStockCatalogBtn.addEventListener("click", updateStockCatalog);
els.stockQuery.addEventListener("input", () => {
  state.stockCandidate = null;
  els.stockSelectedId.value = "";
  window.clearTimeout(stockSearchTimer);
  const query = els.stockQuery.value.trim();
  stockSearchTimer = window.setTimeout(() => searchStockCandidates(query), 180);
  renderStockCandidates();
});

els.stockRangeTabs.forEach((button) => {
  button.addEventListener("click", async () => {
    state.stockRange = button.dataset.stockRange || "day";
    els.stockRangeTabs.forEach((tab) => tab.classList.toggle("active", tab === button));
    await refreshStocks();
    if (state.selectedStockId) await selectStock(state.selectedStockId);
  });
});

els.stockSortToggle.addEventListener("click", async () => {
  state.stockOrder = state.stockOrder === "desc" ? "asc" : "desc";
  await refreshStocks();
});

els.allAuthorsBtn.addEventListener("click", () => {
  state.activeView = "articles";
  state.selectedAuthor = "";
  state.selectedArticleId = "";
  state.workspaceMode = "list";
  state.readerDetail = null;
  renderAll();
  const first = getFilteredArticles()[0];
  if (first) selectArticle(first.article_id);
  else renderEmptyDetail("当前日期范围内没有文章。");
});

els.batchLinks.addEventListener("input", () => {
  const lineCount = els.batchLinks.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length;
  els.linkCounter.textContent = `${lineCount} / ${BATCH_LINK_LIMIT}`;
  els.linkCounter.dataset.tone = lineCount > BATCH_LINK_LIMIT ? "danger" : "";
});

els.parseLinksBtn.addEventListener("click", parseQueueFromInput);
els.startFetchBtn.addEventListener("click", runFetchQueue);

els.rangeTabs.forEach((button) => {
  button.addEventListener("click", () => {
    state.activeView = "articles";
    state.dateRange = button.dataset.range || "all";
    els.rangeTabs.forEach((tab) => tab.classList.toggle("active", tab === button));
    state.selectedArticleId = "";
    state.workspaceMode = "list";
    state.readerDetail = null;
    renderAll();
    const first = getFilteredArticles()[0];
    if (first) selectArticle(first.article_id);
    else renderEmptyDetail("当前日期范围内没有文章。");
  });
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.workspaceMode === "reader") {
    closeArticleReader();
  }
});

applyDetailLayoutConfig();
restoreDetailPaneWidth();
setupDetailResizer();

refreshAll().catch((error) => {
  renderEmptyDetail(`初始化失败：${error.message}`);
});
