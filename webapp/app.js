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
  articles: [],
  authors: [],
  queue: [],
  queueOverLimit: false,
  selectedAuthor: "",
  selectedArticleId: "",
  dateRange: "today",
  isFetching: false,
};

const els = {
  authorSearch: document.querySelector("#author-search"),
  allAuthorsBtn: document.querySelector("#all-authors-btn"),
  totalArticleCount: document.querySelector("#total-article-count"),
  authorCount: document.querySelector("#author-count"),
  authors: document.querySelector("#authors"),
  batchLinks: document.querySelector("#batch-links"),
  linkCounter: document.querySelector("#link-counter"),
  parseLinksBtn: document.querySelector("#parse-links-btn"),
  startFetchBtn: document.querySelector("#start-fetch-btn"),
  batchStatus: document.querySelector("#batch-status"),
  queueList: document.querySelector("#queue-list"),
  activeFilter: document.querySelector("#active-filter"),
  articleCount: document.querySelector("#article-count"),
  articles: document.querySelector("#articles"),
  detail: document.querySelector("#article-detail"),
  detailResizer: document.querySelector("#detail-resizer"),
  detailShrinkBtn: document.querySelector("#detail-shrink-btn"),
  detailGrowBtn: document.querySelector("#detail-grow-btn"),
  detailResetBtn: document.querySelector("#detail-reset-btn"),
  shell: document.querySelector(".research-shell"),
  rangeTabs: document.querySelectorAll(".range-tab"),
};

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
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || "请求失败");
  return data;
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
        <span class="keyword-strip">${escapeHtml((author.top_keywords || []).slice(0, 4).join("、") || "暂无关键词")}</span>
      </button>
    `;
  }).join("");

  els.authors.querySelectorAll(".author-row").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedAuthor = button.dataset.author || "";
      state.selectedArticleId = "";
      renderAll();
      const first = getFilteredArticles()[0];
      if (first) selectArticle(first.article_id);
      else renderEmptyDetail("该博主在当前日期范围内没有文章。");
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
    return `
      ${dateHeader}
      <button class="article-row${active ? " active" : ""}" type="button" data-article-id="${escapeHtml(article.article_id)}">
        <span class="article-row-title">${escapeHtml(article.title || "未命名文章")}</span>
        <span class="article-row-meta">
          <span>${escapeHtml(article.author || article.account || "未知作者")}</span>
          <span>${escapeHtml(article.publish_time || "")}</span>
        </span>
        <span class="article-row-keywords">${escapeHtml((article.keywords || []).slice(0, 5).join("、") || "暂无关键词")}</span>
      </button>
    `;
  }).join("");

  els.articles.querySelectorAll(".article-row").forEach((button) => {
    button.addEventListener("click", () => selectArticle(button.dataset.articleId));
  });
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

function renderDetail(detail) {
  const meta = detail.meta || {};
  const analysis = detail.analysis || {};
  const viewpoints = analysis.viewpoints || [];
  const keywords = analysis.keywords || [];

  els.detail.innerHTML = `
    <article class="detail-content">
      <header class="detail-title-block">
        <span class="sentiment-tag" data-sentiment="${escapeHtml(analysis.sentiment || "neutral")}">${escapeHtml(analysis.sentiment || "neutral")}</span>
        <h3>${escapeHtml(meta.title || detail.title || "未命名文章")}</h3>
        <p>${escapeHtml(meta.author || meta.account || detail.author || "未知作者")} · ${escapeHtml(meta.publishTime || detail.publish_time || "")}</p>
      </header>

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
        <h4>核心观点</h4>
        <div class="viewpoint-list">
          ${viewpoints.length ? viewpoints.map((item) => `
            <div class="viewpoint-item">
              <strong>${escapeHtml(item.id)}</strong>
              <p>${escapeHtml(item.text)}</p>
            </div>
          `).join("") : "<p class=\"muted-text\">暂无观点片段</p>"}
        </div>
      </section>

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

      <details class="detail-disclosure">
        <summary>Markdown</summary>
        <pre class="markdown-box">${escapeHtml(detail.markdown || "")}</pre>
      </details>
    </article>
  `;

  const frameWrap = els.detail.querySelector("#offline-frame-wrap");
  const frame = els.detail.querySelector("#offline-frame");
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
}

function renderAll() {
  renderAuthors();
  renderArticles();
  renderQueue();
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

async function selectArticle(articleId) {
  if (!articleId) return;
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

async function refreshAll() {
  const [{ articles }, { authors }] = await Promise.all([
    fetchJson("/api/articles"),
    fetchJson("/api/authors"),
  ]);
  state.articles = articles;
  state.authors = authors;
  renderAll();

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

els.allAuthorsBtn.addEventListener("click", () => {
  state.selectedAuthor = "";
  state.selectedArticleId = "";
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
    state.dateRange = button.dataset.range || "all";
    els.rangeTabs.forEach((tab) => tab.classList.toggle("active", tab === button));
    state.selectedArticleId = "";
    renderAll();
    const first = getFilteredArticles()[0];
    if (first) selectArticle(first.article_id);
    else renderEmptyDetail("当前日期范围内没有文章。");
  });
});

applyDetailLayoutConfig();
restoreDetailPaneWidth();
setupDetailResizer();

refreshAll().catch((error) => {
  renderEmptyDetail(`初始化失败：${error.message}`);
});
