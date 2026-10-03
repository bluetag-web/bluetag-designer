// pipeline.js — 前端图像处理管线 (移植自 goapp/index.html 参考实现)
// 导出符合 /api/write 输入契约的 240x416 纯三色 PNG。
// 纯函数核心 (binarizeData/quantizeMasks/validateData) 可在 Node 中单测。

export const W = 240;
export const H = 416;

// 红判定 + 灰度 + 二值化 (阈值 / Floyd-Steinberg 抖动)
// 红 = R>=120 且 R-max(G,B)>=40; 红像素固定白, 不参与误差扩散
export function binarizeData(data, w, h, threshold, dither) {
  const n = w * h;
  const redM = new Uint8Array(n), gray = new Float32Array(n), whiteM = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    redM[i] = r >= 120 && r - Math.max(g, b) >= 40 ? 1 : 0;
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (redM[i]) { whiteM[i] = 1; continue; }
      if (!dither) { whiteM[i] = gray[i] >= threshold ? 1 : 0; continue; }
      const old = gray[i], nv = old < 128 ? 0 : 255;
      whiteM[i] = nv === 255 ? 1 : 0;
      const errd = old - nv;
      const spread = (dx, dy, f) => {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && !redM[ny * w + nx])
          gray[ny * w + nx] += errd * f;
      };
      spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
    }
  }
  return { redM, whiteM };
}

// 量化为纯三色 (白/黑/红); 返回 RGB 数组与统计; 红像素在 BW 通道计白 (与服务端一致)
export function quantizeMasks(m) {
  const n = m.redM.length;
  const rgb = new Uint8Array(n * 3);
  let white = 0, black = 0, red = 0;
  for (let i = 0; i < n; i++) {
    let v;
    if (m.redM[i]) { v = [255, 0, 0]; red++; white++; }
    else if (m.whiteM[i]) { v = [255, 255, 255]; white++; }
    else { v = [0, 0, 0]; black++; }
    rgb[i * 3] = v[0]; rgb[i * 3 + 1] = v[1]; rgb[i * 3 + 2] = v[2];
  }
  return { rgb, white, black, red };
}

// 复刻服务端 /api/write 校验核心: 纯三色 (±16)、alpha=255
// 返回 null 表示通过, 否则返回错误信息 (列出前 3 个违规像素)
export function validateData(data, w, h, tol = 16) {
  const targets = [[255, 255, 255], [0, 0, 0], [255, 0, 0]];
  const bad = [];
  for (let y = 0; y < h && bad.length < 3; y++) {
    for (let x = 0; x < w && bad.length < 3; x++) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a !== 255) {
        bad.push(`(x=${x},y=${y}) alpha=${a} 非不透明`);
        continue;
      }
      const ok = targets.some(
        ([tr, tg, tb]) =>
          Math.abs(r - tr) <= tol && Math.abs(g - tg) <= tol && Math.abs(b - tb) <= tol
      );
      if (!ok) bad.push(`(x=${x},y=${y})=RGB(${r},${g},${b}) 不是纯白/纯黑/纯红`);
    }
  }
  if (bad.length) return "图片含非法像素: " + bad.join("; ");
  return null;
}


// ---- 以下为浏览器 DOM 包装 ----

// 缩放到 240x416: 拉伸铺满 或 等比缩放白底居中
function resizeToImageData(img, stretch) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (stretch) {
    ctx.drawImage(img, 0, 0, W, H);
  } else {
    // HTMLImageElement 用 naturalWidth, HTMLCanvasElement 只有 width
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = Math.min(W / iw, H / ih);
    const nw = Math.max(1, Math.round(iw * scale));
    const nh = Math.max(1, Math.round(ih * scale));
    ctx.drawImage(img, (W - nw) >> 1, (H - nh) >> 1, nw, nh);
  }
  return ctx.getImageData(0, 0, W, H);
}

// 把源图 (File/Blob/HTMLImageElement/HTMLCanvasElement) 处理为纯三色
// 返回 {canvas, white, black, red}
export async function processToTriColor(source, { threshold = 128, dither = false, stretch = false } = {}) {
  let img;
  if (source instanceof HTMLImageElement || source instanceof HTMLCanvasElement) {
    img = source;
  } else {
    img = new Image();
    img.src = source instanceof Blob ? URL.createObjectURL(source) : source;
    await img.decode();
  }
  const id = resizeToImageData(img, stretch);
  const m = binarizeData(id.data, W, H, threshold, dither);
  const q = quantizeMasks(m);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const out = ctx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    out.data[i * 4] = q.rgb[i * 3];
    out.data[i * 4 + 1] = q.rgb[i * 3 + 1];
    out.data[i * 4 + 2] = q.rgb[i * 3 + 2];
    out.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return { canvas, white: q.white, black: q.black, red: q.red };
}

// 对 HTMLCanvasElement 执行服务端同规则校验 (含尺寸)
export function validateTriColor(canvas, tol = 16) {
  if (canvas.width !== W || canvas.height !== H) {
    return `图片尺寸必须为 ${W}x${H}, 实际 ${canvas.width}x${canvas.height}`;
  }
  return validateData(canvas.getContext("2d").getImageData(0, 0, W, H).data, W, H, tol);
}

// 画布导出为 PNG Blob
export function canvasToBlob(canvas) {
  return new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("PNG 导出失败"))), "image/png")
  );
}

