<script setup lang="ts">
/**
 * R-02 形象区（EL-010 ~ EL-017）—— 状态机载体，同时是拖拽落区。
 *
 * 状态与文案全部来自 `resources/cats/manifest.json`（一键替换形象的关键），
 * 本组件不硬编码任何一句猫咪文案。
 *
 * ── C 方案施工单（2026-09-27）：A 猫块跨行 1-2 ─────────────────────────
 *
 * 整块横排：左边固定 **240px 槽**（内边距 8px、居中）装猫插画（画到 **224×209**，
 * 槽要比猫大 —— 呼吸动画会撑大包围盒）；右半边竖排：进度环 → 状态行 → 副行。
 *
 * 进度环（EL-157）：SVG **100×100 / 半径 40 / 线宽 6 / 起点 −90°**，内圈净宽 74px。
 * 环上显示的是**真实比例**，不是装饰：
 *  · 没在改名 → 「将变化 / 总数」的比例（空环 = 还没有文件 / 正在算）
 *  · 正在改名 → 两阶段改名的真实进度
 *
 * ★ 环心两条硬规矩（§07，实测踩出来的）：
 *  1. 数字**绝对定位钉圆心**（left:50%; top:50%; translate:-50% -50%）——
 *     别用 grid + place-items:center 居中「数字+说明」两行，隐式行会被拉伸成
 *     各占半圆，数字被顶到上半圆（实测盒中心比圆心高 22.2px）。
 *  2. 分数 **≤5 字符显分数、≥6 字符改百分比（取整）** —— 23px 字号下 5 字符=69px
 *     塞得下、6 字符=82px 塞不下（内圈净宽 74px）。不要用「缩小字号」硬塞。
 *     环心说明「将变化」绝对定位在圆心正下方 24px（该高度圆内还有 56px 净宽），
 *     且要补 `padding-left:1px` —— 字距会在最后一个字后面多出 1px，让字偏左 0.5px。
 *
 * ⚠️ **没有加「眨眼」**：眼睛在 `resources/cats/*.svg` 里，而那是**可整体替换的
 *   形象资源**（manifest 约定）。把眨眼画进组件等于把某个具体形象的内部结构
 *   写死在代码里，换一套形象就废（`animations.css` 文件头已经写过同一条理由）。
 */
import { computed } from 'vue'
import CatBiteLane from './CatBiteLane.vue'
import { useCatStore } from '../stores/cat'
import { useFilesStore } from '../stores/files'
import { usePrefsStore } from '../stores/prefs'
import { useTaskStore } from '../stores/task'

const cat = useCatStore()
const files = useFilesStore()
const prefs = usePrefsStore()
const task = useTaskStore()

/** ST-03 的卡片队列：与列表同源，只取会变化的项 */
const biteEntries = computed(() =>
  files.items
    .filter((i) => i.status === 'changed' || i.status === 'conflict')
    .map((i) => ({ fromName: i.name, toName: i.newName || i.name, isDir: i.isDir })),
)

const isExecuting = computed(() => cat.state === 'ST-03')

/* ── 进度环（EL-157）──────────────────────────────────────────────── */

/** 半径 40 的周长（设计稿：viewBox 0 0 100 100、r=40）*/
const RING_C = 2 * Math.PI * 40

/** 「将变化」= 会改名的项（将改 + 撞名都要动）*/
const willChange = computed(() => files.stats.changed + files.stats.conflict)

/**
 * 当前该画多少。
 *
 * ★ 三态必须**穷尽**，不许写 `running ? x : y` 这种兜底式 —— 兜底式写法在加第四种
 *   状态时会静默掉进 else 分支（第 6 类静默 bug，本项目已中过四次）。
 */
const ringPercent = computed(() => {
  if (task.running) return Math.max(0, Math.min(100, task.overallPercent))
  if (files.total === 0) return 0
  if (files.previewPending) return 0
  return (willChange.value / files.total) * 100
})

const ringArc = computed(() => `${(RING_C * ringPercent.value) / 100} ${RING_C}`)

/** 分数 ≤5 字符显分数、≥6 字符改百分比（§07 环心规矩 2）*/
function fracOrPercent(a: number, b: number, percent: number): string {
  const frac = `${a}/${b}`
  if (frac.length <= 5) return frac
  return `${Math.round(percent)}%`
}

const ringText = computed(() => {
  if (task.running) return fracOrPercent(task.progress.done, task.progress.total, task.overallPercent)
  return fracOrPercent(willChange.value, files.total, ringPercent.value)
})

const ringCaption = computed(() => (task.running ? '已处理' : '将变化'))

/** 副行：与设计稿同构「N 个文件 · 无重名」*/
const subLine = computed(() => {
  if (files.total === 0) return '还没有文件 · 拖进来就行'
  const clash = files.stats.conflict
  return `${files.total} 个文件 · ${clash > 0 ? `${clash} 个撞名` : '无重名'}`
})
</script>

<template>
  <section class="md-catstage md-card" data-catstage>
    <!-- 左：240px 猫槽（比猫大 —— 呼吸动画会撑大包围盒）-->
    <div class="md-catstage__hero">
      <div class="md-cat" :class="`md-cat--${cat.state}`" v-html="cat.svg" />

      <!-- ST-04 撒花 / ST-05 怒气符号（叠加元素，不参与形象本身的动画）-->
      <div v-if="cat.state === 'ST-04'" class="md-sparkles" aria-hidden="true">
        <span class="md-sparkle" style="left: 18%; top: 22%" />
        <span class="md-sparkle" style="left: 76%; top: 18%" />
        <span class="md-sparkle" style="left: 62%; top: 42%" />
      </div>
      <div v-else-if="cat.state === 'ST-05'" class="md-anger" aria-hidden="true">
        <span>怒</span>
        <span>怒</span>
      </div>

      <!-- EL-013：仅 ST-03 挂载 -->
      <CatBiteLane
        :active="isExecuting"
        :entries="biteEntries"
        :reduce-motion="prefs.prefs.reduceMotion"
      />
    </div>

    <!-- 右：竖排 = 环 → 状态行 → 副行 -->
    <div class="md-catstage__side">
      <!-- EL-157 进度环：真实比例，不是装饰 -->
      <div class="md-ring" :class="{ 'md-ring--run': task.running }">
        <svg class="md-ring__svg" viewBox="0 0 100 100" role="img" :aria-label="`将变化 ${willChange}/${files.total}`">
          <circle class="md-ring__track" cx="50" cy="50" r="40" />
          <circle class="md-ring__arc" cx="50" cy="50" r="40" :stroke-dasharray="ringArc" />
        </svg>
        <!-- ★ 数字绝对定位钉圆心；说明钉圆心正下方 24px —— 都不用 grid 居中 -->
        <span class="md-ring__value">{{ ringText }}</span>
        <span class="md-ring__cap">{{ ringCaption }}</span>
      </div>

      <div class="md-catstage__st">
        <i class="md-catstage__lamp" aria-hidden="true" />
        <!-- EL-011 状态文字（manifest 驱动）-->
        <span class="md-catstage__sttext" :class="{ 'md-catstage__sttext--run': isExecuting }">
          {{ cat.message || '待机中…' }}
        </span>
      </div>

      <p class="md-catstage__sub">{{ subLine }}</p>
    </div>
  </section>
</template>

<style scoped>
.md-catstage {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--md-space-5);
  min-width: 0;
  min-height: 0;
  padding: 20px 20px 18px;
  /* 猫这块是「抬起」的主角面（设计稿 .p--raise）；底色比统计卡亮一档 */
  background: var(--md-bg-card);
}

/* ── 左：240px 猫槽（内边距 8px、居中；槽要比猫大）────────────────── */
.md-catstage__hero {
  position: relative;
  flex: 0 0 240px;
  min-width: 0;
  height: 100%;
  min-height: 0;
  padding: 8px;
  display: grid;
  place-items: center;
}

/* 猫画到 224×209（组件模板里的 .md-cat，压过 animations.css 的 200px 默认值）*/
.md-catstage__hero .md-cat {
  width: 224px;
  height: 209px;
}

/* ── 右：竖排信息 ─────────────────────────────────────────────────── */
.md-catstage__side {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

/* ── 进度环：100×100 / r40 / 线宽 6 / 起点 −90° ───────────────────── */
.md-ring {
  position: relative;
  width: 100px;
  height: 100px;
  flex: 0 0 auto;
  /* currentColor 供下面两条 circle 用 —— 组件里不写色值（P-10 / TC-32）*/
  color: var(--md-orange-primary);
}

.md-ring__svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  /* 从 12 点开始画 */
  transform: rotate(-90deg);
}

.md-ring__track {
  fill: none;
  stroke: var(--md-line);
  stroke-width: 6;
}

.md-ring__arc {
  fill: none;
  stroke: currentColor;
  stroke-width: 6;
  stroke-linecap: round;
  transition: stroke-dasharray var(--md-dur-progress) linear;
}

/* ★ 减少动画时环不该「滑」过去，应直接跳到位 —— 但过渡时长归零由
   tokens.css 的 `[data-reduce-motion]` 与 prefers-reduced-motion 两处统一管，
   这里不重复写一遍（重复写就会出现「两套开关不一致」的隐患）。 */

/* 环心数字：绝对定位钉圆心（23px / 600 / 等宽 / 行高 1）*/
.md-ring__value {
  position: absolute;
  left: 50%;
  top: 50%;
  translate: -50% -50%;
  font-family: var(--md-font-num);
  font-size: 23px;
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--md-ink-1);
}

/* 环心说明：绝对定位在圆心正下方 24px；
   ★ padding-left:1px —— 字距会在最后一个字后面多出 1px，让字偏左 0.5px */
.md-ring__cap {
  position: absolute;
  left: 50%;
  top: calc(50% + 24px);
  translate: -50% -50%;
  padding-left: 1px;
  font-size: 9.5px;
  letter-spacing: 1px;
  color: var(--md-ink-3);
  white-space: nowrap;
}

/* ── 状态行：7px 绿灯（呼吸）+ 文案 13px/600 ──────────────────────── */
.md-catstage__st {
  display: flex;
  align-items: center;
  gap: 8px;
}

.md-catstage__lamp {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--md-ok);
  display: block;
  animation: md-lamp 2.4s ease-in-out infinite;
}

@keyframes md-lamp {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.38;
    transform: scale(0.76);
  }
}

.md-catstage__sttext {
  font-size: 13px;
  font-weight: 600;
  color: var(--md-ink-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.md-catstage__sttext--run {
  color: var(--md-orange-dark);
}

/* ── 副行：11.5px / --ink3 / 等宽数字 ─────────────────────────────── */
.md-catstage__sub {
  margin: 0;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  color: var(--md-ink-3);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
</style>
