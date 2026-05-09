export async function fetchJson(url, options) {
  const resp = await fetch(url, options);
  const text = await resp.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    if (!resp.ok) throw new Error(text || `HTTP ${resp.status}`);
    throw new Error(`服务返回了非 JSON 响应：${text.slice(0, 120)}`);
  }

  if (!resp.ok) {
    const taskLabel = data.task?.label ? `：${data.task.label}` : "";
    const error = new Error(`${data.error || "请求失败"}${taskLabel}`);
    error.data = data;
    error.status = resp.status;
    throw error;
  }

  return data;
}
