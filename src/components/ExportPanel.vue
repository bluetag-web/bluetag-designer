<script setup>
import { ref } from "vue";
import { processToTriColor, validateTriColor, canvasToBlob } from "../lib/pipeline.js";

const props = defineProps({
  getCanvas: { type: Function, required: true },
});
const emit = defineEmits(["exported"]);

const threshold = ref(128);
const dither = ref(false);
const busy = ref(false);
const preview = ref("");
const stats = ref("");
const error = ref("");

// 三色模式: 画布只含白/黑/红时直接导出 (无损);
// 含其他颜色时走 阈值/抖动 管线转换
async function doExport() {
  error.value = "";
  stats.value = "";
  busy.value = true;
  try {
    const src = props.getCanvas();
    const q = await processToTriColor(src, {
      threshold: threshold.value,
      dither: dither.value,
    });
    const msg = validateTriColor(q.canvas);
    if (msg) {
      error.value = msg;
      return;
    }
    const blob = await canvasToBlob(q.canvas);
    preview.value = q.canvas.toDataURL("image/png");
    stats.value = `白 ${q.white} / 黑 ${q.black} / 红 ${q.red} 像素`;
    emit("exported", { blob, dataUrl: preview.value, stats: stats.value });
  } catch (e) {
    error.value = "导出失败: " + e.message;
  } finally {
    busy.value = false;
  }
}

function download() {
  if (!preview.value) return;
  const a = document.createElement("a");
  a.href = preview.value;
  a.download = "design.png";
  a.click();
}

defineExpose({ doExport });
</script>

<template>
  <div class="card">
    <div class="panel-title">导出 (240×416 纯三色)</div>
    <label style="font-size: 13px; margin-right: 10px">
      黑白阈值 <input type="number" v-model.number="threshold" min="0" max="255" style="width: 56px">
    </label>
    <label style="font-size: 13px; margin-right: 10px">
      <input type="checkbox" v-model="dither"> 抖动
    </label>
    <button class="primary" :disabled="busy" @click="doExport">生成预览</button>
    <button :disabled="!preview" @click="download" style="margin-left: 6px">下载 PNG</button>
    <div v-if="error" class="err" style="font-size: 13px; margin-top: 6px; white-space: pre-wrap">{{ error }}</div>
    <div v-else-if="stats" class="ok" style="font-size: 13px; margin-top: 6px">{{ stats }}</div>
    <div style="margin-top: 8px">
      <img v-if="preview" :src="preview" alt="预览" style="width: 100%; max-width: 240px; image-rendering: pixelated; border: 1px solid #ccc">
    </div>
  </div>
</template>
