// 联调脚本: 生成 240x416 纯三色 PNG, 调用 /api/status 与 /api/write
// 运行: node test/live.mjs  (需先启动 bluetag-go.exe)
import zlib from "node:zlib";

const BASE = "http://127.0.0.1:8765";
const W = 240, H = 416;

// --- 最小 PNG 编码器 (零依赖) ---
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter none
    rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// 生成测试图: 上半白 / 中间黑条 / 左下红块 (纯三色)
const rgba = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    let c = [255, 255, 255];
    if (y >= 180 && y < 220) c = [0, 0, 0];
    else if (x < 80 && y >= 300) c = [255, 0, 0];
    rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = 255;
  }
}
const png = encodePNG(rgba, W, H);
console.log(`生成测试 PNG: ${png.length} 字节 (240x416 纯三色)`);

// --- 400 路径: 错误尺寸应被服务端拒绝 ---
{
  const big = Buffer.alloc(512 * 512 * 4, 255);
  const bad = encodePNG(big, 512, 512);
  const fd0 = new FormData();
  fd0.append("image", new Blob([bad], { type: "image/png" }), "bad.png");
  const r0 = await fetch(`${BASE}/api/write`, { method: "POST", body: fd0 });
  const t0 = await r0.text();
  console.log(`\n/api/write (512x512 非法尺寸) → HTTP ${r0.status}: ${t0.trim()}`);
  if (r0.status !== 400 || !t0.includes("240x416")) {
    console.error("400 校验路径不符合预期!");
    process.exit(1);
  }
}

// --- /api/status ---
const s = await fetch(`${BASE}/api/status`).then((r) => r.json());
console.log("\n/api/status →", JSON.stringify(s));

// --- /api/write (NDJSON 流式) ---
console.log("\n/api/write 事件流:");
const fd = new FormData();
fd.append("image", new Blob([png], { type: "image/png" }), "design.png");
const resp = await fetch(`${BASE}/api/write`, { method: "POST", body: fd });
console.log("HTTP", resp.status, resp.headers.get("content-type"));
if (!resp.ok) {
  console.log("校验失败(文本):", await resp.text());
  process.exit(1);
}
const reader = resp.body.getReader();
const dec = new TextDecoder();
let buf = "", events = 0;
outer: for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const ev = JSON.parse(line);
    events++;
    if (ev.type === "progress" && ev.total > 1 && ev.done > 1 && ev.done < ev.total - 5) continue; // 中间进度省略
    console.log(" ", JSON.stringify(ev));
    if (ev.type === "error" || ev.type === "done") break outer;
  }
}
console.log(`\n共收到 ${events} 个事件, 流契约验证 ${events > 0 ? "通过" : "失败"}`);
