<script setup lang="ts">
/**
 * SCR-01 主窗口（PRD §5.2）。
 *
 * ── C 方案施工单（2026-09-27）：12 列 × 5 行，猫块跨行 1-2 ───────────────
 *
 * 设计稿画布是**固定 1440×900**（`C-面板阵列.html` 的 `.win{width:1440px;height:900px}`），
 * 窗口默认尺寸同步为 1440×900（见 `shared/constants.ts`）。
 *
 * 网格照施工单定死的两行字：
 *
 *   ┌──────────────┬───────┬───────┬──────┐
 *   │              │ 将变化 │ 无变化 │ 撞名  │  ← 三张统计卡横排
 *   │   猫块 (1-4) ├───────┴───────┴──────┤
 *   │   （跨两行）  │      规则 (5-12)      │  ← ★ 规则在**列表上方**
 *   ├──────────────┼──────────────┬───────┤
 *   │              │              │ G 格   │
 *   │  列表 (1-8)   │              ├───────┤
 *   │  （跨三行）   │              │ 开始改名│
 *   └──────────────┴──────────────┴───────┘
 *
 * ⚠️ 行高**别**写全 `auto`（窗口会涨到 1271px）、也别写纯 `fr`（会撑到 2354px）——
 *    就按施工单这行：`auto auto minmax(0,1fr) minmax(0,1fr) auto`。
 *    中间两行吸收剩余空间**并受约束**：G 格被压住、由它自己滚，窗口固定 900 不长高。
 *
 * 「往里加东西」（原 ActionPanel / add 区）已整组搬进标题栏（EL-155 / 施工单 §二）。
 *
 * 拖拽监听挂在**整个窗口**上（EL-010 全窗口可落），蒙层覆盖主区。
 */
import { onUnmounted, ref } from 'vue'
import ActionBar from '../components/ActionBar.vue'
import CatStage from '../components/CatStage.vue'
import ExtractDialog from '../components/ExtractDialog.vue'
import FileList from '../components/FileList.vue'
import ImportTableModal from '../components/ImportTableModal.vue'
import MergeDialog from '../components/MergeDialog.vue'
import RulePanel from '../components/RulePanel.vue'
import StatsPanel from '../components/StatsPanel.vue'
import { useDragDrop } from '../composables/useDragDrop'
import { useFilesStore } from '../stores/files'
import { useTaskStore } from '../stores/task'

const files = useFilesStore()
const task = useTaskStore()
const root = ref<HTMLElement | null>(null)

const { visible, rejected, onDragEnter, onDragOver, onDragLeave, onDrop } = useDragDrop({
  onPaths: (paths) => {
    if (paths.length === 0) {
      // EX-08：拖入网页链接 / 纯文本 → 状态栏提示，不入列
      files.showTransient('只能拖入文件或文件夹哦')
      return
    }
    void files.addPaths(paths)
  },
})

// ★ P3-9：两个「搬文件」对话框的状态在 task store 里，而弹窗挂在本视图 ——
//   切到历史页会把本视图卸载，必须顺手把开合复位，否则回来时弹窗自己弹出来。
onUnmounted(() => task.closeTools())
</script>

<template>
  <div
    ref="root"
    class="md-main"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- 设计稿的 12 列 × 5 行网格。各组件用 `grid-area` 落到自己的格子里
         （子组件的根元素在 scoped 样式里用 :deep 点名）。 -->
    <div class="md-grid">
      <CatStage />
      <StatsPanel />
      <RulePanel />
      <FileList />
      <ActionBar />
    </div>

    <!-- EL-012 拖拽蒙层（拖拽时显示，非文件对象时显示拒绝态）-->
    <div v-if="visible" class="md-dropzone" :class="{ 'md-dropzone--reject': rejected }">
      <template v-if="rejected">只能拖入文件或文件夹哦</template>
      <template v-else>松手就行，交给耄耋～</template>
    </div>

    <!-- EL-133 导入预览弹窗（★ P3-5：从 ActionPanel 提到这里 —— 左栏按钮与「导入」
         页签的入口共用同一个动作，只该有一个弹窗实例）。AppModal 内部 Teleport 到
         body，挂在这里只是「就近」。 -->
    <ImportTableModal
      :open="files.importOpen"
      :file-name="files.importName"
      :table="files.importTable"
      @close="files.closeImport()"
    />

    <!-- EL-141 文件夹合并（P3-7）/ EL-149 文件提取（P3-8）。
         ★ P3-9：入口搬到了标题栏（EL-155），所以弹窗也**上移到视图层**。 -->
    <MergeDialog :open="task.mergeOpen" @close="task.closeTools()" />
    <ExtractDialog :open="task.extractOpen" @close="task.closeTools()" />
  </div>
</template>

<style scoped>
.md-main {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  /* ★ 2026-09-26 产品负责人拍板（冲突 1 选 B + 冲突 2 按 §7.6）：
     网格正好铺满一屏，**主区不再整块滚**；装不下内容的格子各自开滚动窗口。
     这样「开始改名」恒在首屏可点（§7.6），一页就是设计稿那一页。 */
  overflow: hidden;
  /* ★ 几何对齐设计稿 §2：标题栏下方**无顶距**，左右各 14px、底部 14px。 */
  padding: 0 14px 14px;
  display: flex;
  flex-direction: column;
}

/* ── 设计稿 C 的 12 列 × 5 行网格（施工单 §一，行高这行字不许再改）──────
   ★ auto auto minmax(0,1fr) minmax(0,1fr) auto —— 中间两行吸收剩余空间并受约束：
   G 格被压住、由它自己滚；窗口固定 900 不长高。
   （全 auto → 1271px；纯 fr → 2354px，两种写法都实测过，别再来回改。） */
.md-grid {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  grid-template-areas:
    'cat  cat  cat  cat  s1 s1 s1 s2 s2 s2 s3 s3'
    'cat  cat  cat  cat  rule rule rule rule rule rule rule rule'
    'list list list list list list list list num num num num'
    'list list list list list list list list num num num num'
    'list list list list list list list list go  go  go  go';
  grid-template-rows: auto auto minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 12px;
  min-width: 0;
}

/* ── 各组件落到自己的格子 ────────────────────────────────────────────
   用 :deep() 点名：StatsPanel 是多根组件，子组件根节点拿不到父级 scope id（规格书 §6 坑 4）。
   ★ 每块都要 min-height: 0 —— 网格项默认 min-height:auto，会被内容顶大，
     整页就又超出 900px 了。 */

/* 全窗口只允许两条滚动条：G 格 + 文件列表。规则块**不滚**（行 2 是 auto，
   高度按内容给足；中间两行的 minmax(0,1fr) 会吸收剩余空间）。 */
:deep(.md-rulepanel) {
  grid-area: rule;
  min-height: 0;
}
:deep([data-numbering]) {
  grid-area: num;
  min-height: 0;
  overflow-y: auto;
}
:deep(.md-catstage) {
  grid-area: cat;
  min-height: 0;
}
:deep(.md-stat[data-stat='changed']) {
  grid-area: s1;
  min-height: 0;
}
:deep(.md-stat[data-stat='unchanged']) {
  grid-area: s2;
  min-height: 0;
}
:deep(.md-stat[data-stat='conflict']) {
  grid-area: s3;
  min-height: 0;
}
:deep(.md-filelist) {
  grid-area: list;
  min-height: 0;
}
:deep(.md-actionbar) {
  grid-area: go;
  min-height: 0;
  /* ★ 规格书 §6 坑 1：执行块要压住行底（它是全屏最有分量的一块） */
  align-self: end;
}

/* ── 入场：三块面板错开 ~70ms 依次浮起（C 方案的「有主次的入场」）。
   ⚠️ 只在**首次挂载**跑一次 —— 切到历史页再回来会重播，这是刻意的。 */
.md-grid > * {
  animation: md-panel-in var(--md-dur-panel) var(--md-ease-out) both;
}
.md-grid > *:nth-child(1) {
  animation-delay: 20ms;
}
.md-grid > *:nth-child(2) {
  animation-delay: 90ms;
}
.md-grid > *:nth-child(3) {
  animation-delay: 160ms;
}
</style>
