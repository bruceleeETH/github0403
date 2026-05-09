export function sentimentLabel(value) {
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

export function analysisSourceLabel(analysis) {
  return [analysis?.analysis_provider, analysis?.analysis_model].filter(Boolean).join(" / ");
}

export function hasModelAnalysis(analysis) {
  return Boolean(analysis?.analysis_provider && analysis?.analysis_model && analysis.analysis_provider !== "rule" && analysis.analysis_status !== "failed");
}

export function indicatorLabels(items, limit = 6) {
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

export function formatStockDate(value) {
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

export function formatPrice(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "--";
}

export function formatPct(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
}

export function pctTone(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "flat";
  return number > 0 ? "up" : "down";
}

export function rangeLabel(value) {
  return ({
    day: "日",
    "5d": "五日",
    week: "周",
  })[value] || value;
}

export function stockTagsText(tags) {
  return Array.isArray(tags) && tags.length ? tags.join("、") : "未设置标签";
}

export function stockOptionLabel(stock) {
  if (!stock) return "";
  return `${stock.name || stock.code} ${stock.stock_id || stock.code}`;
}

export function priceProviderLabel(source) {
  return ({
    "akshare.stock_zh_a_hist": "AkShare",
    "akshare.stock_hk_hist": "AkShare",
    "akshare.stock_us_hist": "AkShare",
    "tencent.fqkline": "腾讯备用源",
  })[source] || source || "未知源";
}

export function compactErrorText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/HTTPSConnectionPool\([^)]*\): /g, "")
    .replace(/Max retries exceeded with url: .*?\(Caused by /g, "")
    .replace(/\)+$/g, "")
    .slice(0, 120);
}

export function formatPriceUpdateDetail(result = {}) {
  const fallbackItems = Array.isArray(result.items)
    ? result.items.filter((item) => item.used_fallback)
    : [];
  const failures = Array.isArray(result.failures) ? result.failures : [];
  const parts = [];

  if (fallbackItems.length) {
    const names = fallbackItems.slice(0, 3).map((item) => item.name || item.stock_id).join("、");
    parts.push(`已自动切换备用源：${names}${fallbackItems.length > 3 ? " 等" : ""}`);
  }

  if (failures.length) {
    const first = failures[0];
    const providerErrors = Array.isArray(first.provider_errors) ? first.provider_errors : [];
    const providerDetail = providerErrors.length
      ? providerErrors.map((item) => `${priceProviderLabel(item.provider)} ${compactErrorText(item.error)}`).join("；")
      : compactErrorText(first.error);
    parts.push(`${first.name || first.stock_id} 失败：${first.hint || providerDetail}`);
    if (providerDetail && first.hint) parts.push(`接口明细：${providerDetail}`);
    if (failures.length > 1) parts.push(`其余 ${failures.length - 1} 只也未更新`);
  }

  return parts.join("。");
}
