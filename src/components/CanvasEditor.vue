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

onMounted(() => {
  canvas = new fabric.Canvas(el.value, {
    width: W * ZOOM,
    height: H * ZOOM,
    backgroundColor: "#fff",
    selection: props.tool === "select",
    preserveObjectStacking: true,
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
  window.addEventListener("keydown", onKey);
  count();
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
}

function setTool(t) {
  emit("update:tool", t);
}

function emitSel() {
  const o = canvas.getActiveObject();
  emit("update:selection",
    o ? { type: o.type, fill: o.fill, stroke: o.stroke, fontSize: o.fontSize } : null);
}

function count() {
  emit("object-count", canvas ? canvas.getObjects().length : 0);
}

function onKey(e) {
  if (!canvas) return;
  const ao = canvas.getActiveObject();
  if (!ao) return;
  const editing = ao.isEditing || ao.__editing;
  if ((e.key === "Delete" || e.key === "Backspace") && !editing) {
    e.preventDefault();
    canvas.getActiveObjects().forEach((o) => canvas.remove(o));
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  }
}

// 供外部调用
defineExpose({
  // 导出 240x416 纯画布 (无 zoom)
  // 注意: toCanvasElement 默认用画布显示尺寸与 getZoom(), 必须显式传宽高并临时复位视口
  exportCanvas() {
    const prev = canvas.viewportTransform;
    canvas.viewportTransform = [1, 0, 0, 1, 0, 0];
    const out = canvas.toCanvasElement(1, { width: W, height: H });
    canvas.viewportTransform = prev;
    return out;
  },
  getJSON() { return canvas.toJSON(); },
  async loadJSON(json) {
    await canvas.loadFromJSON(json);
    canvas.requestRenderAll();
    count();
  },
  clearAll() { canvas.getObjects().forEach((o) => canvas.remove(o)); canvas.discardActiveObject(); },
  deleteSelected() {
    const ao = canvas.getActiveObject();
    if (ao) { canvas.getActiveObjects().forEach((o) => canvas.remove(o)); canvas.discardActiveObject(); canvas.requestRenderAll(); }
  },
  applyProps(props2) {
    const ao = canvas.getActiveObject();
    if (!ao) return;
    if (ao.isEditing) {
      // 双击编辑中: 仅同步文字属性 (fontSize), 不中断输入
      if (props2.fontSize) ao.set("fontSize", props2.fontSize);
    } else {
      ao.set(props2);
    }
    ao.setCoords();
    canvas.requestRenderAll();
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
  },
  setPen(on, color, width) {
    canvas.isDrawingMode = on;
    if (on) {
      canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
      canvas.freeDrawingBrush.color = color === "none" ? "#000000" : color;
      canvas.freeDrawingBrush.width = Math.max(1, width) * ZOOM;
    }
  },
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
