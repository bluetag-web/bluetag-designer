<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from "vue";
import * as fabric from "fabric";
import { W, H } from "../lib/pipeline.js";

const props = defineProps({
  tool: { type: String, default: "select" }, // select/rect/circle/ellipse/line/triangle/text/pen
  fill: { type: String, default: "#000000" }, // 可为 "none" 表示无填充
  stroke: { type: String, default: "#000000" }, // 可为 "none" 表示无描边
  strokeWidth: { type: Number, default: 2 },
  fontSize: { type: Number, default: 24 },
});

// 非选择工具时禁用框选, 避免拖拽绘制时出现选框; 并切换光标为十字定位
watch(
  () => props.tool,
  (t) => {
    if (canvas) {
      canvas.selection = t === "select";
      applyCursor();
      canvas.requestRenderAll();
    }
  }
);

// 光标: 选择工具用默认/移动, 其余工具用十字定位;
// 非选择工具时跳过目标检测, 防止在其他图形上按下时拖动旧图形
function applyCursor() {
  if (!canvas) return;
  const t = props.tool;
  canvas.defaultCursor = t === "select" ? "default" : "crosshair";
  canvas.hoverCursor = t === "select" ? "move" : "crosshair";
  canvas.skipTargetFind = t !== "select";
}

// 画笔模式下实时同步笔刷颜色/粗细 (描边色选"无"时回退黑色)
watch([() => props.stroke, () => props.strokeWidth], () => {
  if (canvas?.isDrawingMode) {
    canvas.freeDrawingBrush.color = props.stroke === "none" ? "#000000" : props.stroke;
    canvas.freeDrawingBrush.width = Math.max(1, props.strokeWidth) * ZOOM;
  }
});

const emit = defineEmits(["update:selection", "object-count", "update:tool"]);

const ZOOM = 2; // 编辑显示放大倍数
const el = ref(null);
let canvas = null;
let drawing = null; // 正在拖拽绘制的对象
let start = null;

// ---- 撤销/重做 (快照式历史: 每次 canvas 状态变化时存 JSON 快照) ----
const HISTORY_LIMIT = 50;
let undoStack = [];
let redoStack = [];
let restoring = false; // 恢复历史期间不记录快照
let batching = false;  // 批量操作 (清空/多选删除) 期间不逐个记录
let rotatingNow = false; // 旋转柄拖拽中, 避免逐帧快照

onMounted(() => {
  canvas = new fabric.Canvas(el.value, {
    width: W * ZOOM,
    height: H * ZOOM,
    backgroundColor: "#fff",
    selection: props.tool === "select",
    preserveObjectStacking: true,
    // 多选修饰键: Ctrl+点按 或 Shift+点按 均可加入/移出多选区
    selectionKey: ["ctrlKey", "shiftKey"],
  });
  canvas.setZoom(ZOOM);
  applyCursor();
  canvas.on("mouse:down", onDown);
  canvas.on("mouse:move", onMove);
  canvas.on("mouse:up", onUp);
  canvas.on("selection:created", emitSel);
  canvas.on("selection:updated", emitSel);
  canvas.on("selection:cleared", () => emit("update:selection", null));
  // 拖拽句柄缩放文字后: 把 scaleY 折算进 fontSize 并归一 scale, 使字号与输入框一致
  canvas.on("object:modified", () => {
    const ao = canvas.getActiveObject();
    if (ao && !ao.isEditing && (ao.type === "i-text" || ao.type === "textbox") && ao.scaleY !== 1) {
      // 角点缩放时 scaleX = scaleY, 折算后两轴必须同时归一, 否则宽度被 scaleX 二次放大
      ao.set({ fontSize: Math.max(1, Math.round(ao.fontSize * ao.scaleY)), scaleX: 1, scaleY: 1 });
      ao.setCoords();
      canvas.requestRenderAll();
    }
    emitSel(); // 刷新右侧属性 (含字号输入框)
  });
  canvas.on("object:added", count);
  canvas.on("object:removed", count);
  canvas.on("object:added", saveState);
  canvas.on("object:removed", saveState);
  canvas.on("object:modified", saveState);
  // 拖动旋转柄过程中实时上报角度; 拖拽结束后由 object:modified 统一记录历史
  canvas.on("object:rotating", () => { rotatingNow = true; emitSel(); });
  canvas.on("mouse:up", () => { rotatingNow = false; });
  canvas.on("object:modified", () => { rotatingNow = false; });
  window.addEventListener("keydown", onKey);
  count();
  resetHistory();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  canvas?.dispose();
});

function scenePoint(opt) {
  return canvas.getScenePoint(opt.e);
}

function onDown(opt) {
  const p = scenePoint(opt);
  if (props.tool === "select" || props.tool === "pen") return;
  if (props.tool === "text") {
    const t = new fabric.IText("文字", {
      left: p.x, top: p.y,
      fill: props.fill === "none" ? "#000000" : props.fill,
      fontFamily: "sans-serif", fontSize: props.fontSize,
    });
    canvas.add(t);
    canvas.setActiveObject(t);
    t.enterEditing();
    setTool("select");
    return;
  }
  start = p;
  const noFill = props.fill === "none";
  const noStroke = props.stroke === "none";
  const common = {
    left: p.x, top: p.y,
    fill: noFill ? "transparent" : props.fill,
    stroke: noStroke ? "" : props.stroke,
    // 无描边时宽度置 0, 否则线宽输入生效
    strokeWidth: noStroke ? 0 : Math.max(1, props.strokeWidth),
    strokeUniform: true,
    // 绘制期间不可交互, 防止 Fabric 把它当作拖拽目标移动而非缩放
    selectable: false,
    evented: false,
  };
  if (props.tool === "rect") drawing = new fabric.Rect({ ...common, width: 1, height: 1 });
  else if (props.tool === "circle") drawing = new fabric.Circle({ ...common, radius: 1 });
  else if (props.tool === "ellipse") drawing = new fabric.Ellipse({ ...common, rx: 1, ry: 1 });
  else if (props.tool === "triangle") drawing = new fabric.Triangle({ ...common, width: 1, height: 1 });
  else if (props.tool === "line")
    drawing = new fabric.Line([p.x, p.y, p.x, p.y], {
      ...common,
      // 直线颜色取描边; 无描边时回退到填充色
      stroke: noStroke ? (noFill ? "#000000" : props.fill) : props.stroke,
      fill: "transparent",
    });
  canvas.add(drawing);
}

function onMove(opt) {
  if (!drawing) return;
  const p = scenePoint(opt);
  if (props.tool === "rect" || props.tool === "triangle") {
    drawing.set({ left: Math.min(start.x, p.x), top: Math.min(start.y, p.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) });
  } else if (props.tool === "circle") {
    // 拖拽起点到光标 = 圆外接正方形的对角线 (与矩形/椭圆一致的包围盒交互)
    const r = Math.hypot(p.x - start.x, p.y - start.y) / (2 * Math.SQRT2);
    drawing.set({ radius: r, left: (start.x + p.x) / 2 - r, top: (start.y + p.y) / 2 - r });
  } else if (props.tool === "ellipse") {
    drawing.set({ rx: Math.abs(p.x - start.x) / 2, ry: Math.abs(p.y - start.y) / 2, left: Math.min(start.x, p.x), top: Math.min(start.y, p.y) });
  } else if (props.tool === "line") {
    drawing.set({ x2: p.x, y2: p.y });
  }
  drawing.setCoords();
  // Fabric 在无 transform 的 mouse:move 中不自动重绘, 必须主动请求
  canvas.requestRenderAll();
}

function onUp() {
  if (!drawing) return;
  const d = drawing;
  drawing = null;
  if (d.width < 1 && (d.radius ?? 0) < 1 && d.x2 === undefined) { canvas.remove(d); return; }
  d.set({ selectable: true, evented: true });
  setTool("select");
  canvas.setActiveObject(d);
  saveState(); // 绘制期间抑制了快照, 完成后统一记录
}

function setTool(t) {
  emit("update:tool", t);
}

// ---- 历史快照管理 ----
function snapshot() {
  return JSON.stringify(canvas.toJSON());
}

function saveState() {
  // 拖拽绘制中由 onUp 完成后统一记录; 恢复/批量操作期间跳过
  if (restoring || batching || drawing) return;
  const s = snapshot();
  if (undoStack[undoStack.length - 1] === s) return; // 状态未变化, 不重复入栈
  undoStack.push(s);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack = []; // 新操作会丢弃重做分支
}

function resetHistory() {
  undoStack = [snapshot()];
  redoStack = [];
}

async function restoreState(state) {
  restoring = true;
  try {
    canvas.discardActiveObject();
    await canvas.loadFromJSON(state);
    canvas.requestRenderAll();
    count();
  } finally {
    restoring = false;
  }
}

async function undo() {
  // 至少保留一份初始状态; 画笔绘制中不响应
  if (canvas.isDrawingMode || undoStack.length <= 1) return;
  const cur = undoStack.pop();
  redoStack.push(cur);
  await restoreState(undoStack[undoStack.length - 1]);
}

async function redo() {
  if (canvas.isDrawingMode || !redoStack.length) return;
  const state = redoStack.pop();
  undoStack.push(state);
  await restoreState(state);
}

function emitSel() {
  const o = canvas.getActiveObject();
  // 多选组 (activeselection) 不携带子对象的具体属性, 仅报告类型以启用删除/图层按钮;
  // 文字对象需上报字号, 供字号输入框跟随 (拖角缩放折算后同步);
  // angle: 单选=对象绝对角度, 多选组=组合体相对角度, 归一化到 0~360
  const isText = o && (o.type === "i-text" || o.type === "textbox");
  const angle = o ? Math.round(((o.angle % 360) + 360) % 360) : undefined;
  emit("update:selection",
    o ? {
      type: o.type,
      isMulti: o.type === "activeselection",
      fontSize: isText ? o.fontSize : undefined,
      angle,
    } : null);
}

function count() {
  emit("object-count", canvas ? canvas.getObjects().length : 0);
}

function onKey(e) {
  if (!canvas) return;
  const ao = canvas.getActiveObject();
  const editing = ao?.isEditing || ao?.__editing;
  // Ctrl+Z 撤销 / Ctrl+Y 或 Ctrl+Shift+Z 重做; 文字编辑中交还 Fabric 处理
  if ((e.ctrlKey || e.metaKey) && !editing) {
    const k = e.key.toLowerCase();
    if (k === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (k === "y") {
      e.preventDefault();
      redo();
      return;
    }
  }
  if (!ao) return;
  if ((e.key === "Delete" || e.key === "Backspace") && !editing) {
    e.preventDefault();
    canvas.getActiveObjects().forEach((o) => canvas.remove(o));
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  }
}

// 围绕对象中心旋转到指定角度 (与交互式旋转柄的固定中心锚点行为一致)
function rotateAroundCenter(obj, angle) {
  const center = obj.getCenterPoint();
  obj.set("angle", angle);
  obj.setPositionByOrigin(center, "center", "center");
}

// 供外部调用
defineExpose({
  // 导出超采样画布 (4x = 960x1664, 无 zoom)
  // 注意: toCanvasElement 默认用画布显示尺寸与 getZoom(), 必须显式传宽高并临时复位视口;
  // 超采样后由 pipeline.resizeToImageData 以 imageSmoothingQuality:high 降采样回 240x416,
  // 降采样的灰度边缘等价于亚像素级抗锯齿, 可显著减轻二值化锯齿 (线宽等矢量属性随 multiplier 自动缩放)
  exportCanvas() {
    const prev = canvas.viewportTransform;
    canvas.viewportTransform = [1, 0, 0, 1, 0, 0];
    const out = canvas.toCanvasElement(4, { width: W, height: H });
    canvas.viewportTransform = prev;
    return out;
  },
  getJSON() { return canvas.toJSON(); },
  async loadJSON(json) {
    await canvas.loadFromJSON(json);
    canvas.requestRenderAll();
    count();
    resetHistory(); // 载入即历史新起点
  },
  clearAll() {
    // 批量删除, 避免中间态逐个入栈, 完成后记录一次
    batching = true;
    canvas.getObjects().forEach((o) => canvas.remove(o));
    batching = false;
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    saveState();
  },
  deleteSelected() {
    const ao = canvas.getActiveObject();
    if (ao) {
      batching = true;
      canvas.getActiveObjects().forEach((o) => canvas.remove(o));
      batching = false;
      canvas.discardActiveObject();
      canvas.requestRenderAll();
      saveState();
    }
  },
  applyProps(props2) {
    const ao = canvas.getActiveObject();
    if (!ao) return;
    const isText = ao.type === "i-text" || ao.type === "textbox";
    const { angle, ...rest } = props2;
    // 仅应用显式提供的属性, 避免 rotation-only 更新污染其他属性
    const clean = {};
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) clean[k] = v;
    if (ao.isEditing) {
      // 双击编辑中: 仅同步文字属性 (颜色/字号), 不中断输入
      if (clean.fill !== undefined) ao.set("fill", clean.fill);
      if (clean.fontSize !== undefined) ao.set("fontSize", clean.fontSize);
    } else if (ao.type === "activeselection") {
      // 多选组: 属性逐个应用到子对象 (直接 set 组合不传播);
      // 文字子对象仅应用填充色, 跳过描边/线宽 (描边会让笔画变粗) 与字号;
      // 角度应用于组合体本身 (相对角度), 取消选择时 Fabric 会把变换传播给子对象, 无需存储
      ao.getObjects().forEach((o) => {
        const isChildText = o.type === "i-text" || o.type === "textbox";
        if (isChildText) {
          if (clean.fill !== undefined) o.set("fill", clean.fill);
        } else {
          o.set(clean);
        }
      });
      if (angle !== undefined) rotateAroundCenter(ao, angle);
      ao.setCoords();
    } else if (isText) {
      // 文字对象: 只应用颜色/字号, 忽略描边/线宽 (文字模式下不提供, 避免隐性污染)
      const t = {};
      if (clean.fill !== undefined) t.fill = clean.fill;
      if (clean.fontSize !== undefined) t.fontSize = clean.fontSize;
      ao.set(t);
      if (angle !== undefined) rotateAroundCenter(ao, angle);
    } else {
      ao.set(clean);
      if (angle !== undefined) rotateAroundCenter(ao, angle);
    }
    ao.setCoords();
    canvas.requestRenderAll();
    if (angle !== undefined) emitSel(); // 同步归一化后的角度回输入框
    if (!rotatingNow) saveState(); // 拖拽旋转期间逐帧跳过, 由 object:modified 统一记录
  },
  // 图层顺序: front=置顶 / up=上移 / down=下移 / back=置底 (作用于选中对象)
  reorder(dir) {
    const ao = canvas.getActiveObject();
    if (!ao || ao.type === "activeselection") return;
    if (dir === "front") canvas.bringObjectToFront(ao);
    else if (dir === "up") canvas.bringObjectForward(ao);
    else if (dir === "down") canvas.sendObjectBackwards(ao);
    else if (dir === "back") canvas.sendObjectToBack(ao);
    canvas.requestRenderAll();
    saveState();
  },
  setPen(on, color, width) {
    canvas.isDrawingMode = on;
    if (on) {
      canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
      canvas.freeDrawingBrush.color = color === "none" ? "#000000" : color;
      canvas.freeDrawingBrush.width = Math.max(1, width) * ZOOM;
    }
  },
  undo,
  redo,
});
</script>

<template>
  <div class="editor-wrap">
    <canvas ref="el"></canvas>
  </div>
</template>

<style scoped>
.editor-wrap {
  width: fit-content;
  border: 1px solid #999;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  background: #fff;
}
</style>
