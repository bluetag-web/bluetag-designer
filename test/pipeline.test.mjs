// Node 单测: 验证 pipeline 纯函数核心与服务端 /api/write 契约一致
// 运行: node test/pipeline.test.mjs
import { binarizeData, quantizeMasks, validateData, W, H } from "../src/lib/pipeline.js";

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.error("  ✗", name); }
}

// 构造 RGBA 数据: 白底 + 黑块 + 红块 + 灰块
function makeData() {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { d[i*4]=255; d[i*4+1]=255; d[i*4+2]=255; d[i*4+3]=255; }
  const px = (x, y, r, g, b, a = 255) => {
    const i = (y * W + x) * 4;
    d[i]=r; d[i+1]=g; d[i+2]=b; d[i+3]=a;
  };
  for (let y = 0; y < 50; y++) for (let x = 0; x < 50; x++) px(x, y, 0, 0, 0);          // 黑
  for (let y = 0; y < 50; y++) for (let x = 100; x < 150; x++) px(x, y, 255, 0, 0);     // 红
  for (let y = 0; y < 50; y++) for (let x = 180; x < 220; x++) px(x, y, 128, 128, 128); // 灰(阈值边界)
  return d;
}

console.log("[1] validateData — 合法三色图");
{
  const q = quantizeMasks(binarizeData(makeData(), W, H, 128, false));
  // 重建 RGBA
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i*4]=q.rgb[i*3]; rgba[i*4+1]=q.rgb[i*3+1]; rgba[i*4+2]=q.rgb[i*3+2]; rgba[i*4+3]=255;
  }
  ok(validateData(rgba, W, H) === null, "量化输出通过服务端校验 (无违规像素)");
  ok(q.white + q.black === W * H && q.red <= q.white, `统计闭合: 白${q.white}+黑${q.black}=${W*H}, 红${q.red}⊆白`);
}

console.log("[2] quantizeMasks — 只输出纯三色");
{
  const m = binarizeData(makeData(), W, H, 128, false);
  const q = quantizeMasks(m);
  const valid = new Set(["255,255,255", "0,0,0", "255,0,0"]);
  let all = true;
  for (let i = 0; i < W * H; i++) {
    if (!valid.has(`${q.rgb[i*3]},${q.rgb[i*3+1]},${q.rgb[i*3+2]}`)) { all = false; break; }
  }
  ok(all, "每个像素均为 (255,255,255)/(0,0,0)/(255,0,0)");
}

console.log("[3] 红判定规则 (R>=120 且 R-max(G,B)>=40)");
{
  const d = new Uint8ClampedArray(4 * 4);
  const cases = [
    [255, 0, 0, 1],    // 纯红
    [200, 50, 50, 1],  // 200-50=150 >= 40
    [130, 100, 100, 0],// 130-100=30 < 40 → 非红
    [119, 0, 0, 0],    // R < 120 → 非红
  ];
  let i = 0;
  for (const [r, g, b] of cases) { d[i*4]=r; d[i*4+1]=g; d[i*4+2]=b; d[i*4+3]=255; i++; }
  const m = binarizeData(d, 2, 2, 128, false);
  cases.forEach(([r, g, b, expect], idx) =>
    ok(m.redM[idx] === expect, `RGB(${r},${g},${b}) 红判定=${m.redM[idx]} (期望 ${expect})`)
  );
}

console.log("[4] 黑白阈值 (灰度 = 0.299R+0.587G+0.114B, >=T 为白)");
{
  const d = new Uint8ClampedArray(2 * 2 * 4);
  // 灰 128: 灰度=128 >= 128 → 白
  d[0]=128; d[1]=128; d[2]=128; d[3]=255;
  // 灰 127: 127 < 128 → 黑
  d[4]=127; d[5]=127; d[6]=127; d[7]=255;
  const m = binarizeData(d, 2, 1, 128, false);
  ok(m.whiteM[0] === 1, "灰度128 → 白");
  ok(m.whiteM[1] === 0, "灰度127 → 黑");
}

console.log("[5] 抖动: 红像素不参与误差扩散且固定为白");
{
  const d = new Uint8ClampedArray(W * 2 * 4);
  for (let i = 0; i < W * 2; i++) { d[i*4]=255; d[i*4+1]=0; d[i*4+2]=0; d[i*4+3]=255; } // 全红
  const m = binarizeData(d, W, 2, 128, true);
  let allRedWhite = true;
  for (let i = 0; i < W * 2; i++) if (!m.redM[i] || !m.whiteM[i]) { allRedWhite = false; break; }
  ok(allRedWhite, "全红图: 全部判定为红且计为白");
}

console.log("[6] validateData — 非法像素与半透明报错");
{
  const d = new Uint8ClampedArray(2 * 2 * 4);
  d.fill(255); d[3] = 255;
  d[4] = 128; d[5] = 64; d[6] = 32; d[7] = 255;   // 非法色
  d[8] = 255; d[9] = 255; d[10] = 255; d[11] = 128; // 半透明
  const msg = validateData(d, 2, 2);
  ok(msg !== null && msg.includes("(x=1,y=0)") && msg.includes("(x=0,y=1)"), "列出违规像素坐标");
  // 容差: ±16 内视为合法
  const d2 = new Uint8ClampedArray(4);
  d2[0]=255; d2[1]=248; d2[2]=242; d2[3]=255;
  ok(validateData(d2, 1, 1) === null, "RGB(255,248,242) 在 ±16 容差内 → 合法");
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
