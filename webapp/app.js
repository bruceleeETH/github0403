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
import { fetchJson } from "./api-client.mjs";
import {
  analysisSourceLabel,
  formatPct,
  formatPrice,
  formatPriceUpdateDetail,
  formatStockDate,
  hasModelAnalysis,
  indicatorLabels,
  pctTone,
  rangeLabel,
  sentimentLabel,
  stockOptionLabel,
  stockTagsText,
} from "./formatters.mjs";
import { renderPersonalNoteMarkdown } from "./note-markdown.mjs";

const state = {
  activeView: "articles",
  articles: [],
  authors: [],
  stockDashboard: { stocks: [], rankings: [], summary: {} },
  stockReviewQueue: [],
  sectorDashboard: { sectors: [], summary: {} },
  stockCatalogStatus: { exists: false, count: 0, markets: {} },
  stockPriceStatus: { exists: false, count: 0, stock_count: 0 },
  stockCandidate: null,
  stockCandidates: [],
  queue: [],
  queueOverLimit: false,
  selectedAuthor: "",
  selectedArticleId: "",
  selectedStockId: "",
  selectedSectorId: "",
  stockRange: "day",
  stockOrder: "desc",
  sectorRange: "7d",
  sectorSort: "heat",
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
  sectorModeBtn: document.querySelector("#sector-mode-btn"),
  articleSideContent: document.querySelector("#article-side-content"),
  stockSideContent: document.querySelector("#stock-side-content"),
  sectorSideContent: document.querySelector("#sector-side-content"),
  articleWorkspace: document.querySelector("#article-workspace"),
  stockWorkspace: document.querySelector("#stock-workspace"),
  sectorWorkspace: document.querySelector("#sector-workspace"),
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
  sectorSearch: document.querySelector("#sector-search"),
  allSectorsBtn: document.querySelector("#all-sectors-btn"),
  sectorTotalCount: document.querySelector("#sector-total-count"),
  sectorSideCount: document.querySelector("#sector-side-count"),
  sectorSideList: document.querySelector("#sector-side-list"),
  sectorSummaryNote: document.querySelector("#sector-summary-note"),
  sectorCount: document.querySelector("#sector-count"),
  sectorRangeTabs: document.querySelectorAll("[data-sector-range]"),
  sectorSort: document.querySelector("#sector-sort"),
  sectorRankList: document.querySelector("#sector-rank-list"),
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
  stockPriceStatus: document.querySelector("#stock-price-status"),
  updateStockPricesBtn: document.querySelector("#update-stock-prices-btn"),
  stockPriceUpdateStatus: document.querySelector("#stock-price-update-status"),
  stockPriceUpdateDetail: document.querySelector("#stock-price-update-detail"),
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

function formatPriceStatus(status = {}) {
  if (!status.exists || !status.count) return "尚未更新真实行情。只会拉取关注池股票。";
  const latest = status.latest_trade_date || "暂无交易日";
  const updated = status.updated_at ? ` · 更新 ${formatStockDate(status.updated_at)}` : "";
  const last = status.last_result || {};
  const lastNote = last.failed ? ` · 上次失败 ${last.failed} 只` : (last.fallback_count ? ` · 备用源 ${last.fallback_count} 只` : "");
  return `${status.stock_count || 0} 只 / ${status.count || 0} 条 · 最新交易日 ${latest}${updated}${lastNote}`;
}

function renderPriceUpdateDetail(result = null, tone = "") {
  if (!els.stockPriceUpdateDetail) return;
  const text = result ? formatPriceUpdateDetail(result) : "";
  els.stockPriceUpdateDetail.textContent = text;
  els.stockPriceUpdateDetail.dataset.tone = tone || "";
  els.stockPriceUpdateDetail.hidden = !text;
}

function renderPriceStatus() {
  if (!els.stockPriceStatus) return;
  els.stockPriceStatus.textContent = formatPriceStatus(state.stockPriceStatus);
  const last = state.stockPriceStatus?.last_result;
  if (last?.failed || last?.fallback_count) {
    renderPriceUpdateDetail(last, last.failed ? "warning" : "success");
  } else {
    renderPriceUpdateDetail(null);
  }
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

function compactStockName(value) {
  return String(value || "").replace(/\s+/g, "");
}

function normalizeStockCodeForCompare(value) {
  const text = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  return text.replace(/^(SH|SZ|BJ|HK|US)[.\-_:]?/, "");
}

function normalizeStockIdForCompare(value) {
  const text = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  const prefixed = /^(SH|SZ|BJ|HK|US)[.\-_:]?(.+)$/.exec(text);
  return prefixed ? `${prefixed[1]}.${prefixed[2]}` : text;
}

function findWatchedStock(item) {
  const normalized = normalizeStockAnalysisItem(item);
  const normalizedCode = normalizeStockCodeForCompare(normalized.code);
  const normalizedStockId = normalizeStockIdForCompare(normalized.code);
  const normalizedName = compactStockName(normalized.name);
  return (state.stockDashboard.stocks || []).find((stock) => (
    stock.status !== "archived" &&
    ((normalizedStockId && normalizeStockIdForCompare(stock.stock_id) === normalizedStockId) ||
      (normalizedCode && normalizeStockCodeForCompare(stock.code || stock.stock_id) === normalizedCode) ||
      (normalizedName && compactStockName(stock.name) === normalizedName))
  ));
}

function getStockSearchQuery() {
  return els.stockSearch?.value.trim() || "";
}

function getSectorSearchQuery() {
  return els.sectorSearch?.value.trim() || "";
}

function formatSectorRange(value) {
  return ({
    today: "今日",
    "3d": "近 3 天",
    "7d": "近 7 天",
    "30d": "近 30 天",
    all: "全部",
  })[value] || value;
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
            ${type === "sector" && label ? `<button type="button" class="secondary-btn sector-jump-btn" data-sector-id="${escapeHtml(label)}">查看板块时间线</button>` : ""}
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
          <div class="indicator-item article-stock-item"
            data-stock-name="${escapeHtml(normalized.name)}"
            data-stock-code="${escapeHtml(normalized.code)}"
            data-stock-tags="${escapeHtml(tagText)}"
            data-stock-reason="${escapeHtml(watchReason)}">
            <div class="indicator-item-head">
              <strong>${escapeHtml(label)}</strong>
              <span class="sentiment-tag" data-sentiment="${escapeHtml(normalized.sentiment || "neutral")}">${escapeHtml(sentimentLabel(normalized.sentiment || "neutral"))}</span>
            </div>
            ${reason ? `<p>${escapeHtml(reason)}</p>` : ""}
            ${mentions.length ? `<span class="indicator-mentions">${escapeHtml(mentions.slice(0, 4).join("、"))}</span>` : ""}
            <div class="article-stock-actions">${renderArticleStockAction(normalized, watched, tagText, watchReason)}</div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderArticleStockAction(normalized, watched, tagText, watchReason) {
  if (watched) {
    return `<button type="button" class="secondary-btn article-stock-open-btn" data-stock-id="${escapeHtml(watched.stock_id)}">已关注，查看</button>`;
  }

  if (normalized.code || normalized.name) {
    return `
      <button type="button" class="primary-btn article-stock-add-btn"
        data-query="${escapeHtml(normalized.code || normalized.name)}"
        data-name="${escapeHtml(normalized.name)}"
        data-code="${escapeHtml(normalized.code)}"
        data-tags="${escapeHtml(tagText)}"
        data-reason="${escapeHtml(watchReason)}">加入股票池</button>
    `;
  }

  return `<span class="inline-status" data-tone="warning">缺少名称和代码，无法一键加入</span>`;
}

function syncArticleStockActions() {
  const cards = els.detail.querySelectorAll(".article-stock-item");
  cards.forEach((card) => {
    const normalized = {
      name: card.dataset.stockName || "",
      code: card.dataset.stockCode || "",
      sentiment: "neutral",
      reason: "",
      mentions: [],
    };
    const actions = card.querySelector(".article-stock-actions");
    if (!actions) return;
    actions.innerHTML = renderArticleStockAction(
      normalized,
      findWatchedStock(normalized),
      card.dataset.stockTags || "",
      card.dataset.stockReason || ""
    );
  });
  bindArticleStockActions();
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

function scrollSelectedListItemIntoView(container, selector) {
  const selected = container?.querySelector(selector);
  selected?.scrollIntoView({ block: "nearest" });
}

function getActiveArticleIds() {
  return getFilteredArticles().map((article) => article.article_id).filter(Boolean);
}

function getActiveStockIds() {
  return getVisibleStockRankings()
    .map((item) => item.stock?.stock_id)
    .filter(Boolean);
}

function getNextSelection(items, currentId, delta) {
  if (!items.length) return "";
  const currentIndex = items.indexOf(currentId);
  if (currentIndex === -1) return delta > 0 ? items[0] : items[items.length - 1];
  const nextIndex = Math.min(Math.max(currentIndex + delta, 0), items.length - 1);
  return items[nextIndex];
}

function shouldIgnoreListHotkeys(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest("input, textarea, select, [contenteditable='true']")) return true;
  if (target.closest("#detail-resizer")) return true;
  return false;
}

async function moveArticleSelection(delta) {
  const articleIds = getActiveArticleIds();
  const nextId = getNextSelection(articleIds, state.selectedArticleId, delta);
  if (!nextId || nextId === state.selectedArticleId) return false;
  await selectArticle(nextId);
  return true;
}

async function moveStockSelection(delta) {
  const stockIds = getActiveStockIds();
  const nextId = getNextSelection(stockIds, state.selectedStockId, delta);
  if (!nextId || nextId === state.selectedStockId) return false;
  await selectStock(nextId);
  return true;
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

function getVisibleSectors() {
  const query = getSectorSearchQuery().toLowerCase().replace(/\s+/g, "");
  return (state.sectorDashboard.sectors || []).filter((sector) => {
    if (!query) return true;
    return String(sector.name || "").toLowerCase().replace(/\s+/g, "").includes(query);
  });
}

function renderSectorSideList() {
  const sectors = getVisibleSectors();
  const total = state.sectorDashboard.summary?.sector_count || 0;
  els.sectorTotalCount.textContent = String(total);
  els.sectorSideCount.textContent = `${sectors.length} 个`;
  els.allSectorsBtn.classList.toggle("active", state.selectedSectorId === "");

  if (!sectors.length) {
    els.sectorSideList.innerHTML = `<div class="empty-state compact">暂无匹配板块。</div>`;
    return;
  }

  els.sectorSideList.innerHTML = sectors.map((sector) => {
    const active = state.selectedSectorId === sector.sector_id;
    return `
      <button class="author-row sector-side-row${active ? " active" : ""}" type="button" data-sector-id="${escapeHtml(sector.sector_id)}">
        <span class="author-row-main">
          <strong>${escapeHtml(sector.name)}</strong>
          <span>热度 ${escapeHtml(String(sector.heat_score || 0))} · ${escapeHtml(sector.latest_publish_time || "暂无时间")}</span>
        </span>
        <span class="author-row-meta">
          <span>${sector.article_count || 0} 篇 / ${sector.author_count || 0} 位作者</span>
          <span>${sector.stock_count || 0} 只个股</span>
        </span>
        <span class="keyword-strip">${escapeHtml((sector.related_stocks || []).slice(0, 3).join("、") || "暂无关联个股")}</span>
      </button>
    `;
  }).join("");

  els.sectorSideList.querySelectorAll("[data-sector-id]").forEach((button) => {
    button.addEventListener("click", () => selectSector(button.dataset.sectorId));
  });
  scrollSelectedListItemIntoView(els.sectorSideList, ".sector-side-row.active");
}

function renderSectorRankings() {
  const sectors = getVisibleSectors();
  const summary = state.sectorDashboard.summary || {};
  els.sectorCount.textContent = `${sectors.length} 个`;
  els.sectorSummaryNote.textContent = `${formatSectorRange(state.sectorRange)} · ${summary.article_count || 0} 篇文章 · ${summary.event_count || 0} 条板块事件`;
  if (els.sectorSort) els.sectorSort.value = state.sectorSort;

  if (!sectors.length) {
    els.sectorRankList.innerHTML = `<div class="empty-state">当前范围内暂无板块。需要先完成文章模型分析。</div>`;
    return;
  }

  els.sectorRankList.innerHTML = sectors.map((sector, index) => {
    const active = state.selectedSectorId === sector.sector_id;
    return `
      <button class="sector-rank-row${active ? " active" : ""}" type="button" data-sector-id="${escapeHtml(sector.sector_id)}">
        <span class="sector-heat">${escapeHtml(String(sector.heat_score || 0))}</span>
        <span class="sector-rank-main">
          <strong>${index + 1}. ${escapeHtml(sector.name)}</strong>
          <span>${sector.article_count || 0} 篇文章 · ${sector.author_count || 0} 位作者 · ${sector.stock_count || 0} 只个股</span>
          <span>${escapeHtml((sector.related_stocks || []).slice(0, 5).join("、") || "暂无关联个股")}</span>
        </span>
        <span class="sector-rank-meta">
          <span>最新</span>
          <strong>${escapeHtml(formatStockDate(sector.latest_publish_time))}</strong>
        </span>
      </button>
    `;
  }).join("");

  els.sectorRankList.querySelectorAll("[data-sector-id]").forEach((button) => {
    button.addEventListener("click", () => selectSector(button.dataset.sectorId));
  });
}

function renderSectors() {
  renderSectorSideList();
  renderSectorRankings();
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
  scrollSelectedListItemIntoView(els.stockSideList, ".stock-side-row.active");
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
  scrollSelectedListItemIntoView(els.stockRankList, ".stock-rank-row.active");
}

function renderStocks() {
  renderCatalogStatus();
  renderPriceStatus();
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
  scrollSelectedListItemIntoView(els.articles, ".article-row.active");
}

function renderWorkspace() {
  const showingStocks = state.activeView === "stocks";
  const showingSectors = state.activeView === "sectors";
  const showingArticles = !showingStocks && !showingSectors;
  els.articleSideContent.hidden = !showingArticles;
  els.stockSideContent.hidden = !showingStocks;
  els.sectorSideContent.hidden = !showingSectors;
  els.articleWorkspace.hidden = !showingArticles;
  els.stockWorkspace.hidden = !showingStocks;
  els.sectorWorkspace.hidden = !showingSectors;
  els.articleModeBtn.classList.toggle("active", showingArticles);
  els.stockModeBtn.classList.toggle("active", showingStocks);
  els.sectorModeBtn.classList.toggle("active", showingSectors);
  els.articleModeBtn.setAttribute("aria-selected", showingArticles ? "true" : "false");
  els.stockModeBtn.setAttribute("aria-selected", showingStocks ? "true" : "false");
  els.sectorModeBtn.setAttribute("aria-selected", showingSectors ? "true" : "false");

  if (showingStocks) {
    renderStocks();
    return;
  }

  if (showingSectors) {
    renderSectors();
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
  const originalText = "加入股票池";
  const actions = button.closest(".article-stock-actions");
  actions?.querySelector(".inline-status")?.remove();
  try {
    const query = button.dataset.query || "";
    const search = await fetchJson(`/api/stocks/search?q=${encodeURIComponent(query)}&limit=6`);
    const compactQuery = query.replace(/\s+/g, "").toUpperCase();
    const candidates = search.items || [];
    const stock = candidates.find((item) => (
      item.stock_id === compactQuery ||
      item.code?.toUpperCase() === compactQuery ||
      item.name?.replace(/\s+/g, "").toUpperCase() === compactQuery
    )) || (candidates.length === 1 ? candidates[0] : null);
    if (!stock?.stock_id) {
      const rawCode = String(button.dataset.code || "").trim();
      const rawName = String(button.dataset.name || "").trim();
      if (rawCode && rawName && candidates.length === 0) {
        button.textContent = "加入中...";
        const result = await fetchJson("/api/stocks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: rawCode,
            name: rawName,
            tags: button.dataset.tags || "",
            watch_reason: button.dataset.reason || "",
          }),
        });
        await refreshStocks();
        syncArticleStockActions();
        if (result.stock?.stock_id) button.dataset.stockId = result.stock.stock_id;
        return;
      }

      state.stockCandidate = null;
      state.stockCandidates = candidates;
      await setViewMode("stocks");
      els.stockQuery.value = query;
      els.stockTags.value = button.dataset.tags || "";
      els.stockReason.value = button.dataset.reason || "";
      renderStockCandidates();
      els.stockFormStatus.textContent = candidates.length
        ? "请从候选中选择具体股票后添加。"
        : "没有匹配到股票，请更新股票目录或手动输入代码。";
      els.stockFormStatus.dataset.tone = candidates.length ? "warning" : "danger";
      button.disabled = false;
      button.textContent = originalText;
      return;
    }

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
    syncArticleStockActions();
    if (result.stock?.stock_id) button.dataset.stockId = result.stock.stock_id;
  } catch (error) {
    button.disabled = false;
    button.textContent = originalText;
    button.title = error.message || "加入失败";
    if (error.message?.includes("已在关注池")) {
      await refreshStocks();
      syncArticleStockActions();
      return;
    }
    actions?.querySelector(".inline-status")?.remove();
    button.insertAdjacentHTML("afterend", `<span class="inline-status" data-tone="danger">${escapeHtml(error.message || "加入失败")}</span>`);
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

function bindSectorJumpActions() {
  els.detail.querySelectorAll(".sector-jump-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const sectorId = button.dataset.sectorId;
      if (!sectorId) return;
      await setViewMode("sectors");
      await selectSector(sectorId);
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
  bindSectorJumpActions();

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
        <button type="button" class="secondary-btn" id="update-stock-detail-prices-btn">更新行情</button>
        <button type="button" class="secondary-btn danger-btn" id="archive-stock-btn">删除/归档</button>
      </section>
    </article>
  `;

  els.detail.querySelector("#edit-stock-btn")?.addEventListener("click", () => startEditStock(stock));
  els.detail.querySelector("#update-stock-detail-prices-btn")?.addEventListener("click", () => updateStockPrices(stock.stock_id));
  els.detail.querySelector("#archive-stock-btn")?.addEventListener("click", () => archiveSelectedStock(stock.stock_id));
  bindStockNoteActions(stock.stock_id);
  els.detail.querySelectorAll("[data-article-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      setViewMode("articles");
      await selectArticle(button.dataset.articleId);
    });
  });
}

function renderSectorDetail(detail) {
  setDetailHeading("板块详情", "热度构成、相关个股和时间线");
  const sentiments = detail.sentiment_counts || {};
  els.detail.innerHTML = `
    <article class="detail-content">
      <header class="detail-title-block">
        <span class="sentiment-tag" data-sentiment="neutral">热度 ${escapeHtml(String(detail.heat_score || 0))}</span>
        <h3>${escapeHtml(detail.name || "未命名板块")}</h3>
        <p>${detail.article_count || 0} 篇文章 · ${detail.author_count || 0} 位作者 · ${detail.stock_count || 0} 只个股</p>
      </header>

      <section class="detail-section">
        <h4>热度构成</h4>
        <div class="metric-grid">
          <div class="metric-item">
            <span>提及</span>
            <strong>${escapeHtml(String(detail.mention_count || 0))}</strong>
            <p>板块事件</p>
          </div>
          <div class="metric-item">
            <span>文章</span>
            <strong>${escapeHtml(String(detail.article_count || 0))}</strong>
            <p>去重文章</p>
          </div>
          <div class="metric-item">
            <span>作者</span>
            <strong>${escapeHtml(String(detail.author_count || 0))}</strong>
            <p>去重作者</p>
          </div>
          <div class="metric-item">
            <span>情绪</span>
            <strong>正 ${sentiments.positive || 0}</strong>
            <p>中 ${sentiments.neutral || 0} / 负 ${sentiments.negative || 0}</p>
          </div>
        </div>
      </section>

      <section class="detail-section">
        <h4>关联个股</h4>
        <div class="pill-row">
          ${(detail.related_stocks || []).length
            ? detail.related_stocks.map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join("")
            : "<span class=\"muted-text\">暂无关联个股</span>"}
        </div>
      </section>

      <section class="detail-section">
        <h4>主要作者</h4>
        <div class="pill-row">
          ${(detail.top_authors || []).length
            ? detail.top_authors.map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join("")
            : "<span class=\"muted-text\">暂无作者</span>"}
        </div>
      </section>

      <section class="detail-section">
        <h4>时间线</h4>
        <div class="sector-timeline">
          ${(detail.timeline || []).map((event) => `
            <div class="sector-timeline-item">
              <div class="sector-timeline-head">
                <strong>${escapeHtml(event.title || "未命名文章")}</strong>
                <span class="sentiment-tag" data-sentiment="${escapeHtml(event.sentiment || "neutral")}">${escapeHtml(sentimentLabel(event.sentiment || "neutral"))}</span>
              </div>
              <div class="sector-timeline-meta">${escapeHtml(event.author || "未知作者")} · ${escapeHtml(event.publish_time || event.date || "")}</div>
              ${event.reason ? `<p>${escapeHtml(event.reason)}</p>` : ""}
              ${(event.mentions || []).length ? `<span class="indicator-mentions">${escapeHtml(event.mentions.slice(0, 4).join("、"))}</span>` : ""}
              ${(event.related_stocks || []).length ? `<div class="pill-row">${event.related_stocks.slice(0, 6).map((stock) => `<span class="pill">${escapeHtml(stock)}</span>`).join("")}</div>` : ""}
              ${(event.viewpoints || []).length ? `
                <div class="viewpoint-list">
                  ${event.viewpoints.map((viewpoint) => `
                    <div class="viewpoint-item">
                      <strong>${escapeHtml(viewpoint.id || "观点")}</strong>
                      <p>${escapeHtml(viewpoint.text || "")}</p>
                      ${viewpoint.evidence ? `<span>${escapeHtml(viewpoint.evidence)}</span>` : ""}
                    </div>
                  `).join("")}
                </div>
              ` : ""}
              <button type="button" class="secondary-btn sector-article-open-btn" data-article-id="${escapeHtml(event.article_id || "")}">打开文章</button>
            </div>
          `).join("") || "<p class=\"muted-text\">暂无时间线事件</p>"}
        </div>
      </section>
    </article>
  `;

  els.detail.querySelectorAll(".sector-article-open-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const articleId = button.dataset.articleId;
      if (!articleId) return;
      await setViewMode("articles");
      await selectArticle(articleId);
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
    if (state.activeView === "stocks") {
      renderEmptyDetail("股票已归档。");
    } else {
      syncArticleStockActions();
    }
  } catch (error) {
    renderEmptyDetail(`归档失败：${error.message}`);
  }
}

function renderAll() {
  renderAuthors();
  renderWorkspace();
  renderQueue();
  renderStocks();
  renderSectors();
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
  state.activeView = viewMode === "stocks" ? "stocks" : (viewMode === "sectors" ? "sectors" : "articles");
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

  if (state.activeView === "sectors") {
    state.workspaceMode = "list";
    state.readerDetail = null;
    setDetailHeading("板块详情", "热度构成、相关个股和时间线");
    renderWorkspace();
    if (!state.sectorDashboard.sectors.length) await refreshSectors();
    const selectedStillVisible = state.sectorDashboard.sectors.some((sector) => sector.sector_id === state.selectedSectorId);
    if (state.selectedSectorId && selectedStillVisible) {
      await selectSector(state.selectedSectorId);
    } else {
      const first = getVisibleSectors()[0];
      if (first?.sector_id) await selectSector(first.sector_id);
      else renderEmptyDetail("完成文章模型分析后，这里会显示热门板块时间线。");
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

async function refreshSectors() {
  const data = await fetchJson(`/api/sectors?range=${encodeURIComponent(state.sectorRange)}&sort=${encodeURIComponent(state.sectorSort)}&q=${encodeURIComponent(getSectorSearchQuery())}`);
  state.sectorDashboard = data;
  renderSectors();
  return data;
}

async function selectSector(sectorId) {
  if (!sectorId) return;
  state.activeView = "sectors";
  state.selectedSectorId = sectorId;
  renderWorkspace();
  els.detail.innerHTML = `<div class="detail-empty">正在加载板块时间线...</div>`;
  try {
    const detail = await fetchJson(`/api/sectors/${encodeURIComponent(sectorId)}?range=${encodeURIComponent(state.sectorRange)}`);
    renderSectorDetail(detail);
    renderSectors();
  } catch (error) {
    renderEmptyDetail(`加载失败：${error.message}`);
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
  const [data, review, priceStatus] = await Promise.all([
    fetchJson(`/api/stocks?range=${encodeURIComponent(state.stockRange)}&order=${encodeURIComponent(state.stockOrder)}&q=${encodeURIComponent(query)}`),
    fetchJson("/api/stocks/review-queue"),
    fetchJson("/api/stocks/prices/status"),
  ]);
  state.stockDashboard = data;
  state.stockReviewQueue = review.items || [];
  state.stockPriceStatus = priceStatus;
  renderStocks();
  syncArticleStockActions();
}

async function refreshStockCatalogStatus() {
  const status = await fetchJson("/api/stocks/catalog/status");
  state.stockCatalogStatus = status;
  renderCatalogStatus();
  return status;
}

async function refreshStockPriceStatus() {
  const status = await fetchJson("/api/stocks/prices/status");
  state.stockPriceStatus = status;
  renderPriceStatus();
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

async function updateStockPrices(stockId = "") {
  const globalButton = els.updateStockPricesBtn;
  const detailButton = els.detail.querySelector("#update-stock-detail-prices-btn");
  const activeButton = stockId ? detailButton : globalButton;
  if (globalButton) globalButton.disabled = true;
  if (detailButton) detailButton.disabled = true;
  if (activeButton) activeButton.textContent = "更新中...";
  els.stockPriceUpdateStatus.textContent = stockId ? "正在更新这只股票行情" : "正在更新关注池行情";
  els.stockPriceUpdateStatus.dataset.tone = "";
  try {
    const result = await fetchJson("/api/stocks/prices/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stockId ? { stock_id: stockId } : {}),
    });
    state.stockPriceStatus = result.status || await refreshStockPriceStatus();
    const fallbackText = result.fallback_count ? `，备用源 ${result.fallback_count} 只` : "";
    els.stockPriceUpdateStatus.textContent = `行情已更新：${result.updated || 0} 只${fallbackText}${result.failed ? `，失败 ${result.failed} 只` : ""}`;
    els.stockPriceUpdateStatus.dataset.tone = result.failed ? "warning" : "success";
    renderPriceUpdateDetail(result, result.failed ? "warning" : (result.fallback_count ? "success" : ""));
    await refreshStocks();
    if (state.selectedStockId) await selectStock(state.selectedStockId);
  } catch (error) {
    els.stockPriceUpdateStatus.textContent = error.message || "行情更新失败";
    els.stockPriceUpdateStatus.dataset.tone = "danger";
    renderPriceUpdateDetail(error.data || { failures: [{ error: error.message }] }, "danger");
  } finally {
    if (globalButton) {
      globalButton.disabled = false;
      globalButton.textContent = "更新全部行情";
    }
    if (detailButton) {
      detailButton.disabled = false;
      detailButton.textContent = "更新行情";
    }
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
  const [{ articles }, { authors }, stockDashboard, review, catalogStatus, priceStatus, sectorDashboard] = await Promise.all([
    fetchJson("/api/articles"),
    fetchJson("/api/authors"),
    fetchJson(`/api/stocks?range=${encodeURIComponent(state.stockRange)}&order=${encodeURIComponent(state.stockOrder)}&q=${encodeURIComponent(getStockSearchQuery())}`),
    fetchJson("/api/stocks/review-queue"),
    fetchJson("/api/stocks/catalog/status"),
    fetchJson("/api/stocks/prices/status"),
    fetchJson(`/api/sectors?range=${encodeURIComponent(state.sectorRange)}&sort=${encodeURIComponent(state.sectorSort)}&q=${encodeURIComponent(getSectorSearchQuery())}`),
  ]);
  state.articles = articles;
  state.authors = authors;
  state.stockDashboard = stockDashboard;
  state.stockReviewQueue = review.items || [];
  state.stockCatalogStatus = catalogStatus;
  state.stockPriceStatus = priceStatus;
  state.sectorDashboard = sectorDashboard;
  renderAll();

  if (state.activeView === "stocks") {
    if (!state.selectedStockId) {
      const first = getVisibleStockRankings()[0];
      if (first?.stock?.stock_id) await selectStock(first.stock.stock_id);
    }
    return;
  }

  if (state.activeView === "sectors") {
    if (!state.selectedSectorId) {
      const first = getVisibleSectors()[0];
      if (first?.sector_id) await selectSector(first.sector_id);
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
els.sectorModeBtn.addEventListener("click", () => setViewMode("sectors"));

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

els.sectorSearch.addEventListener("input", async () => {
  try {
    await refreshSectors();
  } catch (error) {
    renderEmptyDetail(`板块筛选失败：${error.message}`);
  }
});

els.allSectorsBtn.addEventListener("click", async () => {
  state.selectedSectorId = "";
  els.sectorSearch.value = "";
  await refreshSectors();
  const first = getVisibleSectors()[0];
  if (first?.sector_id) selectSector(first.sector_id);
  else renderEmptyDetail("当前范围内暂无板块。");
});

els.sectorRangeTabs.forEach((button) => {
  button.addEventListener("click", async () => {
    state.sectorRange = button.dataset.sectorRange || "7d";
    els.sectorRangeTabs.forEach((tab) => tab.classList.toggle("active", tab === button));
    await refreshSectors();
    if (state.selectedSectorId) await selectSector(state.selectedSectorId);
  });
});

els.sectorSort.addEventListener("change", async () => {
  state.sectorSort = els.sectorSort.value || "heat";
  await refreshSectors();
});

els.stockForm.addEventListener("submit", submitStockForm);
els.cancelStockEditBtn.addEventListener("click", resetStockForm);
els.updateStockCatalogBtn.addEventListener("click", updateStockCatalog);
els.updateStockPricesBtn.addEventListener("click", () => updateStockPrices());
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
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (shouldIgnoreListHotkeys(event.target)) return;
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const handler = state.activeView === "stocks" ? moveStockSelection : moveArticleSelection;
    event.preventDefault();
    handler(delta);
    return;
  }
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
