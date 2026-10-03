// api.js — bluetag-go 服务 API 客户端

const KEY = "bluetag-api-base";

export function getApiBase() {
  return localStorage.getItem(KEY) || "http://127.0.0.1:8765";
}

export function setApiBase(base) {
  localStorage.setItem(KEY, base.replace(/\/+$/, ""));
}

// GET /api/status — 读卡器状态
export async function getStatus() {
  const resp = await fetch(`${getApiBase()}/api/status`);
  if (!resp.ok) throw new Error(`status HTTP ${resp.status}`);
  return resp.json();
}

// POST /api/write — 写卡, 流式解析 NDJSON 事件
// onEvent(type, payload): progress(phase,done,total) / log(msg) / done(seconds)
export async function writeTag(blob, handlers) {
  const fd = new FormData();
  fd.append("image", blob, "design.png");
  let resp;
  try {
    resp = await fetch(`${getApiBase()}/api/write`, { method: "POST", body: fd });
  } catch (e) {
    throw new Error(`无法连接写卡服务 ${getApiBase()} (${e.message})`);
  }
  if (resp.status === 409) throw new Error("已有写卡任务进行中");
  if (!resp.ok) throw new Error(await resp.text()); // 400: 尺寸/非三色像素校验失败

  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      if (ev.type === "progress") handlers.onProgress?.(ev.phase, ev.done, ev.total);
      else if (ev.type === "log") handlers.onLog?.(ev.msg);
      else if (ev.type === "error") throw new Error(ev.msg);
      else if (ev.type === "done") return ev.seconds;
    }
  }
  throw new Error("事件流异常结束 (未收到 done)");
}
