export const BATCH_LINK_LIMIT = 20;
export const DETAIL_PANE_WIDTH_KEY = "wechat_detail_pane_width";

export function isWeChatArticleUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" && url.hostname === "mp.weixin.qq.com" && url.pathname.startsWith("/s/");
  } catch {
    return false;
  }
}

export function parseBatchLinks(rawText, existingUrls = [], options = {}) {
  const maxLinks = options.maxLinks || BATCH_LINK_LIMIT;
  const existing = new Set([...existingUrls].map((url) => String(url || "").trim()).filter(Boolean));
  const seen = new Set();
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    overLimit: lines.length > maxLinks,
    limit: maxLinks,
    items: lines.map((url, index) => {
      let status = "pending";
      let message = "";
      if (!isWeChatArticleUrl(url)) {
        status = "invalid";
        message = "链接无效";
      } else if (seen.has(url)) {
        status = "duplicate";
        message = "重复链接";
      } else if (existing.has(url)) {
        status = "existing";
        message = "已存在";
      }
      seen.add(url);
      return {
        id: `link_${index + 1}`,
        url,
        status,
        message,
        title: "",
        author: "",
        account: "",
        publish_time: "",
        article_id: "",
      };
    }),
  };
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));
}

export function getAuthorKey(record) {
  return String(record?.author || record?.account || "未知作者").trim();
}

export function getArticleDateKey(record) {
  const value = String(record?.publish_time || record?.publishTime || record?.captured_at || "");
  const chineseMatch = value.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (chineseMatch) {
    const [, year, month, day] = chineseMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const isoMatch = value.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return "";
}

export function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function filterArticles(articles, { range = "all", author = "", now = new Date() } = {}) {
  const today = formatDateKey(now);
  const yesterday = formatDateKey(addDays(now, -1));
  const sevenDaysAgo = formatDateKey(addDays(now, -6));
  const authorFilter = String(author || "");

  return [...articles]
    .filter((article) => {
      if (authorFilter && getAuthorKey(article) !== authorFilter) return false;
      if (range === "all") return true;

      const dateKey = getArticleDateKey(article);
      if (!dateKey) return false;
      if (range === "today") return dateKey === today;
      if (range === "yesterday") return dateKey === yesterday;
      if (range === "7d") return dateKey >= sevenDaysAgo && dateKey <= today;
      return true;
    })
    .sort((left, right) => String(right.publish_time || "").localeCompare(String(left.publish_time || "")));
}

export function getDetailPaneBounds(viewportWidth) {
  if (viewportWidth <= 980) {
    return { enabled: false, min: 0, max: 0, defaultWidth: 0 };
  }
  const sideWidth = viewportWidth <= 1180 ? 250 : 280;
  const workspaceMin = viewportWidth <= 1180 ? 440 : 480;
  const splitterWidth = 8;
  const min = 340;
  const preferredMax = 760;
  const maxByViewport = viewportWidth - sideWidth - workspaceMin - splitterWidth;
  const max = Math.max(min, Math.min(preferredMax, maxByViewport));
  const defaultWidth = Math.min(max, Math.max(min, viewportWidth <= 1180 ? 380 : 460));
  return { enabled: true, min, max, defaultWidth };
}

export function clampDetailPaneWidth(width, viewportWidth) {
  const bounds = getDetailPaneBounds(viewportWidth);
  if (!bounds.enabled) return bounds.defaultWidth;
  const numericWidth = Number(width);
  if (!Number.isFinite(numericWidth)) return bounds.defaultWidth;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(numericWidth)));
}
