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
  workspaceMode: "list",
  readerDetail: null,
  articleListScrollTop: 0,
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
  workspacePane: document.querySelector(".workspace-pane"),
  articles: document.querySelector("#articles"),
  articlePanel: document.querySelector(".article-panel"),
  readerPanel: document.querySelector("#reader-panel"),
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
        ${renderIndicatorItems(stocks, "暂无个股提及", "stock")}
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

function renderAll() {
  renderAuthors();
  renderWorkspace();
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

async function openArticleReader(articleId) {
  if (!articleId) return;
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
