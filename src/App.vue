<script setup>
import { ref, computed, watch } from "vue";
import CanvasEditor from "./components/CanvasEditor.vue";
import ExportPanel from "./components/ExportPanel.vue";
import WritePanel from "./components/WritePanel.vue";

const tools = [
  { id: "select", label: "选择" },
  { id: "rect", label: "矩形" },
  { id: "circle", label: "圆" },
  { id: "ellipse", label: "椭圆" },
  { id: "triangle", label: "三角" },
  { id: "line", label: "直线" },
  { id: "text", label: "文字" },
  { id: "pen", label: "画笔" },
];

// 三色屏调色板; "none" = 无填充/无描边
const palette = ["#000000", "#FF0000", "#FFFFFF", "none"];
// 文字颜色调色板 (文字必须可见, 不提供"无"选项)
const textPalette = ["#000000", "#FF0000", "#FFFFFF"];
// 线条颜色调色板 (直线/画笔必须有颜色, 不提供"无"选项)
const linePalette = ["#000000", "#FF0000", "#FFFFFF"];

const editor = ref(null);
const tool = ref("select");
const fill = ref("#000000");
const stroke = ref("#000000");
const strokeWidth = ref(2);
const fontSize = ref(24);
const selection = ref(null);
const rotation = ref(0); // 选中对象的旋转角度 (单选=绝对角度, 多选=组合体相对角度)
const objCount = ref(0);
const blob = ref(null); // 导出的纯三色 PNG Blob
const fileInput = ref(null);

// 文字模式: 使用文字工具, 或选中了文字对象 — 此时只显示 文字颜色 + 字号
const isTextMode = computed(() =>
  tool.value === "text" ||
  selection.value?.type === "i-text" ||
  selection.value?.type === "textbox"
);

// 线条模式: 使用直线/画笔工具, 或选中了直线/画笔路径 — 此时只显示 线条颜色 (+线宽)
const isLineMode = computed(() =>
  tool.value === "line" ||
  tool.value === "pen" ||
  selection.value?.type === "line" ||
  selection.value?.type === "path"
);

// 线条模式不提供"无颜色", 从图形模式带入的"无描边"回退为黑色
watch(isLineMode, (v) => {
  if (v && stroke.value === "none") stroke.value = "#000000";
});

watch(tool, (t) => editor.value?.setPen(t === "pen", stroke.value, strokeWidth.value));
watch([fill, stroke, strokeWidth, fontSize, rotation], () => {
  const s = selection.value;
  if (!s?.type) return;
  // 按选中类型构造最小属性载荷, 避免旋转等无关操作改写其他属性 (如多选时改写文字字号)
  const payload = {};
  if (s.isMulti) {
    // 多选组: 颜色/线宽应用到子对象; 不传字号
    payload.fill = fill.value === "none" ? "transparent" : fill.value;
    payload.stroke = stroke.value === "none" ? "" : stroke.value;
    payload.strokeWidth = stroke.value === "none" ? 0 : strokeWidth.value;
  } else if (s.type === "i-text" || s.type === "textbox") {
    // 文字对象: 仅颜色 + 字号
    payload.fill = fill.value === "none" ? "transparent" : fill.value;
    payload.fontSize = fontSize.value;
  } else if (s.type === "line" || s.type === "path") {
    // 直线/画笔路径: 仅线条颜色 + 线宽 (fill 恒为透明, 不能写入)
    payload.stroke = stroke.value === "none" ? "" : stroke.value;
    payload.strokeWidth = stroke.value === "none" ? 0 : strokeWidth.value;
  } else {
    payload.fill = fill.value === "none" ? "transparent" : fill.value;
    payload.stroke = stroke.value === "none" ? "" : stroke.value;
    payload.strokeWidth = stroke.value === "none" ? 0 : strokeWidth.value;
  }
  payload.angle = rotation.value;
  editor.value?.applyProps(payload);
});

function swatchStyle(c) {
  return {
    background: c === "none"
      ? "repeating-linear-gradient(45deg, #fff, #fff 4px, #ddd 4px, #ddd 6px)"
      : c,
  };
}

function onSelection(s) {
  selection.value = s;
  // 选中文字对象时, 字号输入框跟随对象实际字号; 多选组无具体字号, 跳过
  if (s?.fontSize) fontSize.value = s.fontSize;
  // 旋转角度跟随: 拖动旋转柄时由 object:rotating 实时触发
  if (s?.angle !== undefined) rotation.value = s.angle;
  if (!s?.type && tool.value === "pen") editor.value?.setPen(true, stroke.value, strokeWidth.value);
}

function onExported(p) {
  blob.value = p.blob;
}

function doDelete() {
  editor.value?.deleteSelected();
}

function saveJSON() {
  const data = JSON.stringify(editor.value.getJSON());
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  a.download = "design.json";
  a.click();
}

function loadJSONFile(e) {
  const f = e.target.files[0];
  if (!f) return;
  f.text().then((t) => editor.value.loadJSON(t));
  e.target.value = "";
}

function clearAll() {
  if (confirm("清空画布?")) {
    editor.value?.clearAll();
    blob.value = null;
  }
}
</script>

<template>
  <div class="layout">
    <!-- 左: 工具栏 -->
    <div class="card side">
      <div class="panel-title">工具</div>
      <div class="tool-grid">
        <button v-for="t in tools" :key="t.id" :class="{ primary: tool === t.id }" @click="tool = t.id">
          {{ t.label }}
        </button>
      </div>
      <!-- 文字模式: 仅文字颜色 -->
      <template v-if="isTextMode">
        <div class="panel-title" style="margin-top: 14px;">文字颜色</div>
        <div class="swatches">
          <button v-for="c in textPalette" :key="c" class="swatch" :class="{ active: fill === c }"
            :style="swatchStyle(c)" @click="fill = c" :title="c"></button>
        </div>
      </template>

      <!-- 线条模式 (直线/画笔): 仅线条颜色 -->
      <template v-else-if="isLineMode">
        <div class="panel-title" style="margin-top: 14px;">线条颜色</div>
        <div class="swatches">
          <button v-for="c in linePalette" :key="c" class="swatch" :class="{ active: stroke === c }"
            :style="swatchStyle(c)" @click="stroke = c" :title="c"></button>
        </div>
      </template>

      <!-- 图形模式: 填充色 + 描边色 -->
      <template v-else>
        <div class="panel-title" style="margin-top: 14px;">填充色</div>
        <div class="swatches">
          <button v-for="c in palette" :key="c" class="swatch" :class="{ active: fill === c }"
            :style="swatchStyle(c)" @click="fill = c" :title="c === 'none' ? '无填充' : c"></button>
        </div>
        <div class="panel-title" style="margin-top: 14px">描边色</div>
        <div class="swatches">
          <button v-for="c in palette" :key="c" class="swatch" :class="{ active: stroke === c }"
            :style="swatchStyle(c)" @click="stroke = c" :title="c === 'none' ? '无描边' : c"></button>
        </div>
      </template>

      <div class="panel-title" style="margin-top: 14px">属性</div>
      <div v-if="!isTextMode" style="margin-top: 14px; font-size: 13px">
        线宽 <input type="number" v-model.number="strokeWidth" min="1" max="20" style="width: 52px">
      </div>
      <div v-if="isTextMode" style="margin-top: 14px; font-size: 13px">
        字号 <input type="number" v-model.number="fontSize" min="8" max="72" style="width: 52px">
      </div>
      <div v-if="selection?.type" style="margin-top: 8px; font-size: 13px">
        角度 <input type="number" v-model.number="rotation" min="0" max="360" step="1" style="width: 52px">°
      </div>
      <div class="panel-title" style="margin-top: 14px">操作</div>
      <button @click="doDelete" :disabled="!selection?.type">删除选中</button>
      <div class="tool-grid" style="margin-top: 6px">
        <button @click="editor?.reorder('front')" :disabled="!selection?.type">置顶</button>
        <button @click="editor?.reorder('up')" :disabled="!selection?.type">上移</button>
        <button @click="editor?.reorder('down')" :disabled="!selection?.type">下移</button>
        <button @click="editor?.reorder('back')" :disabled="!selection?.type">置底</button>
      </div>
      <button @click="clearAll" style="margin-top: 6px">清空画布</button>
      <div style="margin-top: 10px">
        <button @click="saveJSON">保存设计</button>
        <button @click="fileInput.click()" style="margin-top: 6px">载入设计</button>
        <input ref="fileInput" type="file" accept=".json" hidden @change="loadJSONFile">
      </div>
      <div style="margin-top: 12px; font-size: 12px; color: #888">对象: {{ objCount }}</div>
    </div>

    <!-- 中: 画布 -->
    <div class="center">
      <div class="hint">画布 240×416 (3.7″ 三色电子墨水屏) — 双击文字可编辑, Ctrl/Shift+点按多选, Delete 删除选中, Ctrl+Z 撤销, Ctrl+Y 重做</div>
      <CanvasEditor ref="editor" v-model:tool="tool" v-model:fill="fill" v-model:stroke="stroke"
        :stroke-width="strokeWidth" :font-size="fontSize"
        @update:selection="onSelection" @object-count="(n) => (objCount = n)" />
    </div>

    <!-- 右: 导出 + 写卡 -->
    <div class="side">
      <ExportPanel :get-canvas="() => editor?.exportCanvas()" @exported="onExported" />
      <WritePanel :blob="blob" style="margin-top: 12px" />
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  gap: 14px;
  padding: 14px;
  max-width: 1280px;
  margin: 0 auto;
  align-items: flex-start;
}
.side { width: 220px; flex-shrink: 0; }
.center { flex: 1; }
.hint { font-size: 13px; color: #666; margin-bottom: 8px; }
.tool-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.swatches { display: flex; gap: 8px; }
.swatch { width: 36px; height: 36px; border-radius: 4px; border: 2px solid #bbb; }
.swatch.active { border-color: #1677ff; outline: 2px solid #1677ff44; }
</style>
