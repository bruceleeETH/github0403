const HISTORY_KEY = "wechat_url_history";
const HISTORY_MAX = 30;

function loadUrlHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveUrlToHistory(url) {
  const history = loadUrlHistory().filter((u) => u !== url);
  history.unshift(url);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_MAX)));
  renderUrlHistory();
}

function renderUrlHistory() {
  const datalist = document.querySelector("#url-history");
  if (!datalist) return;
  datalist.innerHTML = loadUrlHistory()
    .map((u) => `<option value="${u.replace(/"/g, "&quot;")}"></option>`)
    .join("");
}

const state = {
  articles: [],
  authors: [],
  selectedArticleId: "",
  browseSourceUrl: "",
};

const els = {
  form: document.querySelector("#fetch-form"),
  input: document.querySelector("#article-url"),
  status: document.querySelector("#fetch-status"),
  authorCount: document.querySelector("#author-count"),
  articleCount: document.querySelector("#article-count"),
  authors: document.querySelector("#authors"),
  articles: document.querySelector("#articles"),
  detail: document.querySelector("#article-detail"),
  browsePanel: document.querySelector("#account-browse-panel"),
  browseTitleEl: document.querySelector("#account-browse-title"),
  browseStatus: document.querySelector("#account-browse-status"),
  browseClose: document.querySelector("#account-browse-close"),
  browseList: document.querySelector("#account-article-list"),
  browseFooter: document.querySelector("#account-browse-footer"),
  selectAll: document.querySelector("#select-all-articles"),
  batchFetchBtn: document.querySelector("#batch-fetch-btn"),
  batchStatus: document.querySelector("#batch-fetch-status"),
};

async function fetchJson(url, options) {
  const resp = await fetch(url, options);
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error || "请求失败");
  }
  return data;
}

function renderAuthors() {
  els.authorCount.textContent = `${state.authors.length} 位作者`;
  els.authors.innerHTML = state.authors
    .map((author) => {
      const sourceUrl = state.articles.find(
        (a) => (a.author === author.author || a.account === author.author) && a.source_url
      )?.source_url || "";
      return `
      <article class="author-card">
        <h3>${author.author}</h3>
        <p class="meta-line">文章数：${author.article_count}</p>
        <p class="meta-line">最近发布时间：${author.latest_publish_time || ""}</p>
        <p class="keyword-line">高频关键词：${(author.top_keywords || []).join("、") || "暂无"}</p>
        <p class="meta-line">情绪分布：正向 ${author.sentiments.positive} / 中性 ${author.sentiments.neutral} / 负向 ${author.sentiments.negative}</p>
        ${sourceUrl ? `<button type="button" class="action-btn browse-account-btn" data-source-url="${sourceUrl.replace(/"/g, '&quot;')}" data-author="${author.author.replace(/"/g, '&quot;')}">浏览全部文章</button>` : ""}
      </article>
    `;
    })
    .join("");

  els.authors.querySelectorAll(".browse-account-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      openAccountBrowse(btn.dataset.sourceUrl, btn.dataset.author);
    });
  });
}

function renderArticles() {
  els.articleCount.textContent = `${state.articles.length} 篇文章`;
  els.articles.innerHTML = state.articles
    .map((article) => `
      <article class="article-card">
        <h3>${article.title}</h3>
        <p class="meta-line">作者：${article.author || article.account || ""}</p>
        <p class="meta-line">发布时间：${article.publish_time || ""}</p>
        <p class="keyword-line">关键词：${(article.keywords || []).join("、") || "暂无"}</p>
        <button type="button" data-article-id="${article.article_id}">查看详情</button>
      </article>
    `)
    .join("");

  els.articles.querySelectorAll("button[data-article-id]").forEach((button) => {
    button.addEventListener("click", () => selectArticle(button.dataset.articleId));
  });
}

function renderDetail(detail) {
  els.detail.innerHTML = `
    <div class="detail-block">
      <h3 class="detail-title">${detail.meta.title}</h3>
      <p class="meta-line">作者：${detail.meta.author || detail.meta.account || ""}</p>
      <p class="meta-line">发布时间：${detail.meta.publishTime || ""}</p>
      <div class="pill-row">
        ${(detail.analysis.keywords || []).map((item) => `<span class="pill">${item}</span>`).join("")}
      </div>
    </div>
    <div class="detail-block">
      <h4>自动分析</h4>
      <p class="meta-line">摘要：${detail.analysis.summary || ""}</p>
      <p class="meta-line">情绪：${detail.analysis.sentiment || "neutral"}</p>
    </div>
    <div class="detail-block">
      <h4>核心观点</h4>
      <div class="viewpoint-list">
        ${(detail.analysis.viewpoints || []).map((item) => `
          <div class="viewpoint-item">
            <strong>${item.id}</strong>
            <p>${item.text}</p>
            <p class="meta-line">关键词：${(item.keywords || []).join("、") || "暂无"}</p>
          </div>
        `).join("")}
      </div>
    </div>
    <div class="detail-block">
      <h4>文件入口</h4>
      <div class="link-row">
        <button type="button" class="action-btn" data-offline-url="${detail.offline_html_url}">打开离线页面</button>
        <button type="button" class="action-btn" id="share-article-btn" data-article-id="${detail.meta.articleId || state.selectedArticleId}">分享文章</button>
      </div>
      <div id="offline-frame-wrap" class="offline-frame-wrap" hidden>
        <div class="offline-frame-toolbar">
          <span class="offline-frame-title">离线页面</span>
          <button type="button" class="frame-close-btn" id="close-offline-frame">关闭 ✕</button>
        </div>
        <iframe id="offline-frame" class="offline-frame" sandbox="allow-same-origin allow-scripts allow-popups"></iframe>
      </div>
    </div>
    ${detail.image_urls && detail.image_urls.length ? `
    <div class="detail-block">
      <h4>文章图片（${detail.image_urls.length} 张）</h4>
      <div class="image-gallery">
        ${detail.image_urls.map((url, i) => `<img class="gallery-img" src="${url}" alt="图片${i + 1}" loading="lazy" />`).join("")}
      </div>
    </div>
    ` : ""}
    <div class="detail-block">
      <h4>Markdown</h4>
      <div class="markdown-box">${detail.markdown.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]))}</div>
    </div>
  `;

  const offlineFrameWrap = els.detail.querySelector("#offline-frame-wrap");
  const offlineFrame = els.detail.querySelector("#offline-frame");

  els.detail.querySelector("[data-offline-url]")?.addEventListener("click", (e) => {
    offlineFrame.src = e.currentTarget.dataset.offlineUrl;
    offlineFrameWrap.hidden = false;
    offlineFrameWrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  els.detail.querySelector("#close-offline-frame")?.addEventListener("click", () => {
    offlineFrameWrap.hidden = true;
    offlineFrame.src = "";
  });

  els.detail.querySelector("#share-article-btn")?.addEventListener("click", (e) => {
    const articleId = e.currentTarget.dataset.articleId;
    window.open(`/api/articles/${encodeURIComponent(articleId)}/share`, "_blank");
  });
}

async function selectArticle(articleId) {
  state.selectedArticleId = articleId;
  const detail = await fetchJson(`/api/articles/${encodeURIComponent(articleId)}`);
  renderDetail(detail);
}

async function refreshAll() {
  const [{ articles }, { authors }] = await Promise.all([
    fetchJson("/api/articles"),
    fetchJson("/api/authors"),
  ]);
  state.articles = articles;
  state.authors = authors;
  renderAuthors();
  renderArticles();

  if (!state.selectedArticleId && state.articles[0]) {
    await selectArticle(state.articles[0].article_id);
  }
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.status.textContent = "正在抓取并分析，请稍候...";
  const url = els.input.value.trim();
  try {
    const result = await fetchJson("/api/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    saveUrlToHistory(url);
    els.status.textContent = `抓取完成：${result.title}`;
    els.input.value = "";
    await refreshAll();
    if (result.article_id) {
      await selectArticle(result.article_id);
    }
  } catch (error) {
    els.status.textContent = `失败：${error.message}`;
  }
});

// ── Account Browse ────────────────────────────────────────────────────────────

function getCheckedUrls() {
  return [...els.browseList.querySelectorAll("input[type=checkbox]:checked")].map((cb) => cb.value);
}

function updateBatchCount() {
  const n = getCheckedUrls().length;
  els.batchFetchBtn.textContent = `抓取选中文章（${n}）`;
  els.batchFetchBtn.disabled = n === 0;
}

async function openAccountBrowse(sourceUrl, authorName) {
  state.browseSourceUrl = sourceUrl;
  els.browseTitleEl.textContent = `公众号文章列表 — ${authorName}`;
  els.browseStatus.textContent = "正在加载，请稍候…";
  els.browseList.innerHTML = "<p class=\"browse-loading\">正在用 Puppeteer 抓取文章列表，可能需要 30 秒…</p>";
  els.browseFooter.hidden = true;
  els.browsePanel.hidden = false;
  els.browsePanel.scrollIntoView({ behavior: "smooth", block: "start" });

  try {
    const data = await fetchJson(`/api/account-articles?source_url=${encodeURIComponent(sourceUrl)}`);
    const items = data.items || [];
    if (items.length === 0) {
      els.browseList.innerHTML = "<p class=\"browse-empty\">未找到文章，或该公众号需要登录才能查看历史。</p>";
      els.browseStatus.textContent = "";
      return;
    }

    const existingUrls = new Set(state.articles.map((a) => a.source_url));
    els.browseStatus.textContent = `共 ${items.length} 篇`;
    els.browseList.innerHTML = items
      .map((item, i) => {
        const alreadySaved = existingUrls.has(item.url);
        return `
        <label class="account-article-item${alreadySaved ? " already-saved" : ""}">
          <input type="checkbox" value="${item.url.replace(/"/g, "&quot;")}" ${alreadySaved ? "disabled" : ""} />
          <span class="aa-title">${item.title}</span>
          <span class="aa-date">${item.publishTime || ""}</span>
          ${alreadySaved ? "<span class=\"aa-badge\">已保存</span>" : ""}
        </label>`;
      })
      .join("");

    els.browseList.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.addEventListener("change", () => {
        els.selectAll.checked =
          [...els.browseList.querySelectorAll("input[type=checkbox]:not(:disabled)")].every((c) => c.checked);
        updateBatchCount();
      });
    });

    els.selectAll.checked = false;
    updateBatchCount();
    els.browseFooter.hidden = false;
  } catch (err) {
    els.browseList.innerHTML = `<p class="browse-empty">加载失败：${err.message}</p>`;
    els.browseStatus.textContent = "";
  }
}

els.browseClose.addEventListener("click", () => {
  els.browsePanel.hidden = true;
  els.browseFooter.hidden = true;
  state.browseSourceUrl = "";
});

els.selectAll.addEventListener("change", () => {
  els.browseList.querySelectorAll("input[type=checkbox]:not(:disabled)").forEach((cb) => {
    cb.checked = els.selectAll.checked;
  });
  updateBatchCount();
});

els.batchFetchBtn.addEventListener("click", async () => {
  const urls = getCheckedUrls();
  if (urls.length === 0) return;
  els.batchFetchBtn.disabled = true;
  els.batchStatus.textContent = `正在抓取 ${urls.length} 篇文章，请耐心等待…`;

  try {
    const data = await fetchJson("/api/batch-fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    });
    const ok = data.results.filter((r) => r.ok).length;
    const fail = data.results.length - ok;
    els.batchStatus.textContent = `完成：${ok} 篇成功${fail > 0 ? `，${fail} 篇失败` : ""}`;
    // Mark newly saved items
    data.results.forEach((r) => {
      if (r.ok) {
        const cb = els.browseList.querySelector(`input[value="${CSS.escape(r.url)}"]`);
        if (cb) {
          cb.disabled = true;
          cb.checked = false;
          cb.closest(".account-article-item").classList.add("already-saved");
          const badge = document.createElement("span");
          badge.className = "aa-badge";
          badge.textContent = "已保存";
          cb.closest(".account-article-item").append(badge);
        }
      }
    });
    updateBatchCount();
    await refreshAll();
  } catch (err) {
    els.batchStatus.textContent = `批量抓取失败：${err.message}`;
    els.batchFetchBtn.disabled = false;
  }
});

renderUrlHistory();
refreshAll().catch((error) => {
  els.status.textContent = `初始化失败：${error.message}`;
});