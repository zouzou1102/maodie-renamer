<script setup lang="ts">
/**
 * R-08 统计面板（EL-151 ~ EL-154）—— P3-9 照「C-面板阵列」加的「三个大数字」。
 *
 * 数据源**就是** `files.stats` 的四个真数（`changed / unchanged / conflict / invalid`），
 * 面板一个都不新算 —— 它只负责把同一份数字放大给人看，所以「界面上写的」
 * 与「状态栏写的」「真正会改的」永远是同一个源。
 *
 * ── 三条纪律 ────────────────────────────────────────────────────────
 *
 * 1. ★ **过期值不能装作是真的**。`files.stats` 是「**当前列表值**」：预览有 200ms
 *    防抖 + Worker 往返，改规则的一瞬间 stats 里装的还是**上一轮**的数。
 *    不等落定就读 → 显示旧数而界面完全正常（第 2 类静默 bug）。
 *    处理办法不是「藏起来」（那会闪），而是：**照常显示，但整块降饱和 + 顶上写
 *    「计算中」** —— 让人一眼看出「这几个数正在重算」，而不是被一个旧数骗。
 *
 * 2. **分段条按项数分支，写成穷尽判断**。C 的「一格一项」在项数多时放不下，
 *    必须切到比例条 —— 而「兜底式写法」（`a || b ? x : y`）正是加档位时静默出错的
 *    高发区（第 6 类静默 bug）。这里只用 `<= 8` 一个明确分支，没有兜底链。
 *
 * 3. 数字一律 `tabular-nums`。不然 1 → 7 的时候整行会左右跳一下，
 *    而这一块是全屏字号最大的地方，跳起来最扎眼。
 */
import { computed, onUnmounted, ref, watch, type Ref } from 'vue'
import { useFilesStore } from '../stores/files'
import { usePrefsStore } from '../stores/prefs'

const files = useFilesStore()
const prefs = usePrefsStore()

/**
 * 「从旧值数到新值」的显示值。
 *
 * ⚠️ 两条必须成立的保证：
 *  · 结束时**精确等于**目标值（`shown.value = to`），不是「约等于」——
 *    否则界面上会出现一个真的不存在的数字。
 *  · 开了「减少动画」就**直接跳**（不数）—— 数数是动效，不是信息。
 */
function useCountUp(read: () => number): Ref<number> {
  const shown = ref(read())
  let raf = 0

  watch(read, (to, from) => {
    cancelAnimationFrame(raf)
    if (prefs.prefs.reduceMotion || from === undefined || from === to) {
      shown.value = to
      return
    }
    const started = performance.now()
    const step = (now: number): void => {
      const p = Math.min(1, (now - started) / 380)
      // 大缓出：起步快、收尾慢（与面板入场的缓动同一条曲线）
      shown.value = Math.round(from + (to - from) * (1 - (1 - p) ** 3))
      if (p < 1) raf = requestAnimationFrame(step)
      else shown.value = to
    }
    raf = requestAnimationFrame(step)
  })

  onUnmounted(() => cancelAnimationFrame(raf))
  return shown
}

const raw = computed(() => files.stats)
const changed = useCountUp(() => files.stats.changed)
const unchanged = useCountUp(() => files.stats.unchanged)
const conflict = useCountUp(() => files.stats.conflict)

/** 分段条：项数 ≤ 8 时一格一项；更多时切 8 格比例条 */
function bar(value: number, total: number): { cells: number; filled: number } {
  if (total <= 8) return { cells: Math.max(total, 1), filled: value }
  return { cells: 8, filled: Math.round((value / total) * 8) }
}

interface StatCard {
  /** 稳定标识：既是 EL-SCR 锚点也是测试选择器 */
  key: 'changed' | 'unchanged' | 'conflict'
  eyebrow: string
  label: string
  value: number
  cells: number
  filled: number
  caption: string
}

const cards = computed<StatCard[]>(() => {
  const s = raw.value
  const total = s.changed + s.unchanged + s.conflict + s.invalid

  const a = bar(s.changed, total)
  const b = bar(s.unchanged, total)
  const c = bar(s.conflict, total)

  return [
    {
      key: 'changed',
      eyebrow: 'WILL CHANGE',
      label: '将变化',
      value: changed.value,
      cells: a.cells,
      filled: a.filled,
      caption:
        s.changed > 0
          ? `${s.changed} 个名字会变`
          : total > 0
            ? '当前规则不会改变任何名字'
            : '还没有文件',
    },
    {
      key: 'unchanged',
      eyebrow: 'KEEP',
      label: '无变化',
      value: unchanged.value,
      cells: b.cells,
      filled: b.filled,
      caption: s.unchanged > 0 ? `${s.unchanged} 个原样保留` : '每一项都会变',
    },
    {
      key: 'conflict',
      eyebrow: 'CLASH',
      label: '重名',
      value: conflict.value,
      cells: c.cells,
      filled: c.filled,
      caption:
        s.invalid > 0
          ? `${s.invalid} 个名字非法，不能改`
          : s.conflict > 0
            ? '默认跳过，绝不会覆盖'
            : '没有一个重名',
    },
  ]
})

/** 非法名只影响「重名」那张卡的第二行（C 图里 CLASH 卡也只有两行）*/
const bad = computed(() => raw.value.conflict > 0 || raw.value.invalid > 0)
</script>

<template>
  <!-- ★ P3-10：不再是「一个面板装三张卡」，而是**三张各自独立的卡**（设计稿 C 的
       `.pb / .pc / .pd` 就是三个并列的面板）。所以这里渲染**三个根节点**，
       由 MainView 的网格分别放到 s1 / s2 / s3 格子里。
       `data-stats` 落在第一张卡上，保持既有测试选择器仍能命中。 -->
  <article
    v-for="(card, i) in cards"
    :key="card.key"
    class="md-stat md-card"
    :class="[
      `md-stat--${card.key}`,
      { 'md-stat--bad': card.key === 'conflict' && bad, 'md-stat--pending': files.previewPending },
    ]"
    :data-stat="card.key"
    :data-stats="i === 0 ? '' : null"
  >
    <header class="md-stat__head">
      <span class="md-stat__eyebrow">
        {{ card.eyebrow }}<span class="md-stat__sep">/</span>{{ card.label }}
      </span>
      <!-- 「计算中」只挂在第一张卡上：它是**三张卡共同的**状态，不是某一项的 -->
      <span v-if="i === 0 && files.previewPending" class="md-stat__busy" data-stats-busy>计算中…</span>
      <span v-else-if="i === 0" class="md-stat__settled">已落定</span>
    </header>

    <p class="md-stat__value">{{ String(card.value).padStart(2, '0') }}</p>

    <div class="md-stat__bar" aria-hidden="true">
      <span
        v-for="n in card.cells"
        :key="n"
        class="md-stat__cell"
        :class="{ 'is-on': n <= card.filled }"
      />
    </div>

    <p class="md-stat__caption">{{ card.caption }}</p>
  </article>
</template>

<style scoped>
/* ★ P3-10：每张卡自己就是一个面板（`.md-card` 提供面板底色/描边），
   不再是「一个大面板里嵌三张凹陷卡」。 */
.md-stat {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 14px 16px 16px;
  transition: opacity var(--md-dur-hover) ease;
}

/* ★ 计算中：整块降饱和，让人看出「这几个数正在重算」——
   不是藏起来（藏起来会闪），也不是装作没在算（那是拿旧数骗人）。 */
.md-stat--pending {
  opacity: 0.55;
}

.md-stat__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--md-space-2);
  min-width: 0;
}

.md-stat__busy {
  font-size: 11px;
  color: var(--md-warn);
  white-space: nowrap;
}

.md-stat__settled {
  font-size: 11px;
  color: var(--md-ink-4);
  white-space: nowrap;
}

.md-stat__eyebrow {
  margin: 0;
  font-family: var(--md-font-num);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.1em;
  color: var(--md-ink-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.md-stat__sep {
  margin: 0 5px;
  color: var(--md-line-strong);
}

/* 全屏字号最大的地方 —— 细字重 + 超大字号（靠字重对比撑气场，不靠发光）。
   ★ P3-10：字号跟设计稿对齐（`.bigno` = 60px），并用 clamp 让窄列时不撑破；
   数字压在卡片底部（设计稿是 `margin-top:auto`）。 */
.md-stat__value {
  margin: auto 0 0;
  font-family: var(--md-font-num);
  font-size: clamp(38px, 3.4vw, 60px);
  font-weight: 500;
  line-height: 1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--md-ink-1);
}

.md-stat--changed .md-stat__value {
  color: var(--md-orange-dark);
}

.md-stat--conflict .md-stat__value {
  color: var(--md-ok);
}

.md-stat--conflict.md-stat--bad .md-stat__value {
  color: var(--md-bad);
}

.md-stat__bar {
  display: flex;
  gap: 3px;
  margin-top: 9px;
  padding-top: 0;
}

.md-stat__cell {
  flex: 1 1 0;
  height: 4px;
  border-radius: 2px;
  background: var(--md-bg-disabled);
  transition: background var(--md-dur-hover) ease;
}

.md-stat--changed .md-stat__cell.is-on {
  background: var(--md-orange-primary);
}

.md-stat--unchanged .md-stat__cell.is-on {
  background: var(--md-ink-4);
}

.md-stat--conflict .md-stat__cell.is-on {
  background: var(--md-bad);
}

/* ★ 重名卡的空格是**绿色**（C 的设计：全绿 = 没有重名），
   与另外两张卡的「灰空格」语义相反 —— 所以单独写，不共用上面那条。 */
.md-stat--conflict .md-stat__cell {
  background: var(--md-ok-bg);
}

.md-stat__caption {
  margin: 7px 0 0;
  font-size: 11px;
  line-height: 15px;
  color: var(--md-ink-4);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
