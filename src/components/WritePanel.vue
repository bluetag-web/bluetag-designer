<script setup>
import { ref, computed, watch } from "vue";
import { getStatus, writeTag, validateTag, getApiBase, setApiBase } from "../lib/api.js";

// 验证按钮仅在开发模式 (npm run dev) 显示; npm run build 产物不含此按钮
const isDev = import.meta.env.DEV;

const props = defineProps({
  blob: { type: Object, default: null }, // 导出的 PNG Blob
});
const emit = defineEmits(["written"]);

const base = ref(getApiBase());
const readerOk = ref(null); // null=未检查
const readerInfo = ref("");
const running = ref(false);
const pct = ref(0);
const phaseText = ref("");
const logs = ref([]);
const error = ref("");
const doneMsg = ref("");
const showProgress = ref(false); // 写卡进行中的进度模态
const showSuccess = ref(false); // 写卡成功的提示模态
const successSeconds = ref(0);

const phaseName = {
  reset: "断电复位", activate: "激活标签", handshake: "握手",
  BW: "写黑白通道", RD: "写红色通道", refresh: "触发刷新", hold: "保场刷新中",
};
// 与内置页面一致的阶段权重 (reset..refresh 共 108 单位, hold 15 单位另计)
const doneUnits = { reset: 0, activate: 1, handshake: 2, BW: 3, RD: 55, refresh: 107 };

function log(msg, cls = "") {
  logs.value.push({ msg, cls });
}

function setProgress(phase, done, total) {
  if (phase === "hold") {
    pct.value = 95 + ((total - done) / total) * 5;
    phaseText.value = `保场刷新中 剩余 ${done}/${total}`;
  } else {
    pct.value = ((doneUnits[phase] ?? 0) + done) / (108 + 15) * 95;
    phaseText.value = (phaseName[phase] || phase) + (total > 1 ? ` ${done}/${total}` : "");
  }
}

async function checkStatus() {
  error.value = "";
  try {
    const s = await getStatus();
    readerOk.value = s.ok;
    readerInfo.value = s.ok
      ? `${s.reader}${s.busy ? " (正在写卡)" : ""}`
      : (s.error || "读卡器不可用");
  } catch (e) {
    readerOk.value = false;
    readerInfo.value = "无法连接: " + e.message;
  }
}

async function startWrite() {
  error.value = "";
  doneMsg.value = "";
  running.value = true;
  logs.value = [];
  pct.value = 0;
  showSuccess.value = false;
  showProgress.value = true; // 弹出进度模态
  try {
    const seconds = await writeTag(props.blob, {
      onProgress: setProgress,
      onLog: (m) => log(m),
    });
    pct.value = 100;
    phaseText.value = "";
    doneMsg.value = `写卡完成! 用时 ${seconds}s, 可移开标签。`;
    log(doneMsg.value, "ok");
    emit("written");
    // 关闭进度模态, 弹出成功模态
    showProgress.value = false;
    successSeconds.value = seconds;
    showSuccess.value = true;
  } catch (e) {
    showProgress.value = false;
    error.value = e.message;
    log("失败: " + e.message, "err");
  } finally {
    running.value = false;
  }
}

function saveBase() {
  setApiBase(base.value);
  log("API 地址已保存: " + base.value);
}

const canWrite = computed(() => !!props.blob && !running.value && readerOk.value === true);

// ---- 服务端预检验证 (仅开发模式) ----
const validating = ref(false);
const validateMsg = ref("");
const validateOk = ref(false);

// 重新导出后, 上一次的验证结果已过期, 清除
watch(() => props.blob, () => { validateMsg.value = ""; });

async function doValidate() {
  if (!props.blob || validating.value) return;
  validating.value = true;
  validateMsg.value = "";
  try {
    const r = await validateTag(props.blob);
    validateOk.value = true;
    validateMsg.value = `服务端校验通过: 白 ${r.white} / 黑 ${r.black} / 红 ${r.red}`;
  } catch (e) {
    validateOk.value = false;
    validateMsg.value = e.message;
  } finally {
    validating.value = false;
  }
}
</script>

<style scoped>
.row {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.row input {
  flex: 1;
  min-width: 0;
  width: auto;
}
.row .shrink {
  flex-shrink: 0;
  white-space: nowrap;
}
.wide {
  width: 100%;
}

/* ---- 模态窗口 ---- */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal {
  background: var(--card);
  border-radius: 8px;
  padding: 18px;
  width: 320px;
  max-width: calc(100vw - 40px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
}
.bar {
  height: 16px;
  background: #eee;
  border-radius: 8px;
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  background: var(--primary);
  transition: width 0.2s;
}
.log-box {
  margin-top: 10px;
  font: 11px/1.6 monospace;
  max-height: 100px;
  overflow-y: auto;
  white-space: pre-wrap;
  color: #555;
  background: #fafafa;
  border-radius: 4px;
  padding: 6px 8px;
}
</style>

<template>
  <div class="card" style="margin-top: 14px;">
    <div class="panel-title">写卡 (全程约 20 秒, 勿移开标签)</div>
    <div class="row">
      <input type="text" v-model="base" @change="saveBase" title="写卡服务地址">
      
    </div>
    <div v-if="isDev" class="row">
      <button class="wide" :disabled="!blob || validating || running" @click="doValidate">
        {{ validating ? "验证中…" : "验证 (服务端预检, 不写卡)" }}
      </button>
    </div>
    <div v-if="isDev && validateMsg" style="font-size: 13px; margin-top: 0; margin-bottom: 8px; white-space: pre-wrap"
      :class="validateOk ? 'ok' : 'err'">{{ validateMsg }}</div>
    <div class="row">
      <button @click="checkStatus" :disabled="running" class="shrink">检查读卡器</button>
      <button class="danger wide" :disabled="!canWrite" @click="startWrite">开始写入</button>
    </div>
    <div v-if="readerOk !== null" style="font-size: 13px; margin-top: 8px" :class="readerOk ? 'ok' : 'err'">
      {{ readerOk ? "读卡器: " + readerInfo : "读卡器不可用: " + readerInfo }}
    </div>
    <div v-if="!blob && !running" style="font-size: 12px; color: #999; margin-top: 6px">请先在左侧生成预览</div>
    <div v-if="pct > 0 || phaseText" style="margin-top: 10px">
      <div style="height: 16px; background: #eee; border-radius: 8px; overflow: hidden">
        <div style="height: 100%; background: #2196f3; transition: width .2s" :style="{ width: pct + '%' }"></div>
      </div>
      <div style="font-size: 13px; color: #666; margin-top: 4px">{{ phaseText }}</div>
    </div>
    <div v-if="error" class="err" style="font-size: 13px; margin-top: 6px; white-space: pre-wrap">{{ error }}</div>
    <div style="font: 12px/1.6 monospace; max-height: 160px; overflow-y: auto; white-space: pre-wrap; color: #555; margin-top: 6px">
      <div v-for="(l, i) in logs" :key="i" :class="l.cls">{{ l.msg }}</div>
    </div>
  </div>

  <!-- 写卡进度模态 -->
  <Teleport to="body">
    <div v-if="showProgress" class="overlay">
      <div class="modal">
        <div class="panel-title" style="text-align: center">正在写卡, 请勿移开标签</div>
        <div class="bar">
          <div class="bar-fill" :style="{ width: pct + '%' }"></div>
        </div>
        <div style="text-align: center; margin-top: 4px; font-size: 13px; color: #666">
          {{ Math.round(pct) }}% {{ phaseText ? "— " + phaseText : "" }}
        </div>
        <div class="log-box">
          <div v-for="(l, i) in logs" :key="i" :class="l.cls">{{ l.msg }}</div>
        </div>
      </div>
    </div>

    <!-- 写卡成功模态 -->
    <div v-if="showSuccess" class="overlay" @click.self="showSuccess = false">
      <div class="modal">
        <div class="ok" style="font-size: 44px; line-height: 1; text-align: center">✔</div>
        <div class="panel-title" style="text-align: center; margin-top: 8px">写卡成功</div>
        <div style="text-align: center; font-size: 13px; color: #666">
          用时 {{ successSeconds }}s, 可移开标签。
        </div>
        <button class="primary" style="width: 100%; margin-top: 14px" @click="showSuccess = false">确定</button>
      </div>
    </div>
  </Teleport>
</template>
