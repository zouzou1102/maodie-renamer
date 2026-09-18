<script setup lang="ts">
/**
 * EL-084 历史卡片（设计规范 §5.3）。
 *
 * 「已撤销」的卡片：底 `#F7F3EC`、文字变浅、徽标「已撤销」、**不显示撤销按钮**。
 */
import { computed, ref } from 'vue'
import { hiddenDetailText, visibleDetailRows } from '@shared/history-detail'
import { truncateSummaryForDisplay } from '@shared/rule-summary'
import type { RenameTask } from '@shared/types'

const props = defineProps<{ task: RenameTask }>()
const emit = defineEmits<{ (e: 'undo', id: string): void }>()

const undone = computed(() => props.task.status === 'undone')

/**
 * P2-B §5.2：摘要里过长的引号内容（典型是「去掉括号」那串正则）要截断。
 *
 * ⚠️ 截断**只在这里发生**。`task.ruleSummary` 是从 `history.json` 读出来的持久化字段，
 *    `buildRuleSummary` 一个字都不能动 —— 那一层截断等于改变了持久化数据，
 *    新记录截断、老记录完整，同一份文件里两种格式。完整原文放 `title`，悬停可见。
 */
const summaryText = computed(() => truncateSummaryForDisplay(props.task.ruleSummary))
/** 只有真被截断时才挂 title（没截断时 tooltip 与正文一模一样，纯噪音）*/
const summaryTitle = computed(() =>
  summaryText.value === props.task.ruleSummary ? undefined : props.task.ruleSummary,
)

const timeText = computed(() => {
  const d = new Date(props.task.createdAt)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
})

const countsText = computed(() => {
  const c = props.task.counts
  const parts = [`共 ${c.total} 项`, `成功 ${c.success}`]
  if (c.skipped > 0) parts.push(`跳过 ${c.skipped}`)
  if (c.invalid > 0) parts.push(`未处理 ${c.invalid}`)
  if (c.failed > 0) parts.push(`失败 ${c.failed}`)
  return parts.join(' · ')
})

const firstExample = computed(() => props.task.entries[0] ?? null)

/* ── P2-C · EL-111 / EL-112 完整明细 ─────────────────────────────────
 * 展开是**纯 UI 状态**：不进数据模型、不进 IPC（与 P1「进阶设置」折叠区同理）。
 * 每条卡片各自独立展开、不联动 —— 没做手风琴，因为用户可能想**对比两批**明细。
 * 「已撤销」的卡片同样可以展开：撤销之后明细仍有参考价值。 */
const open = ref(false)
const detail = computed(() => visibleDetailRows(props.task.entries))
const moreText = computed(() => hiddenDetailText(detail.value.hidden, detail.value.total))
</script>

<template>
  <article class="md-history-card" :class="{ 'md-history-card--undone': undone }">
    <div class="md-spread">
      <span class="md-history-card__time">{{ timeText }}</span>
      <span class="md-badge" :class="undone ? 'md-badge--muted' : 'md-badge--ok'">
        {{ undone ? '已撤销' : '可撤销' }}
      </span>
    </div>

    <h3 class="md-history-card__summary" :title="summaryTitle">{{ summaryText }}</h3>
    <p class="md-history-card__counts">{{ countsText }}</p>

    <p v-if="firstExample" class="md-history-card__example">
      {{ firstExample.fromName }} → {{ firstExample.toName }}
      <span v-if="task.entries.length > 1" class="md-history-card__more">
        （等 {{ task.entries.length }} 项）
      </span>
    </p>

    <!-- EL-111 明细展开条（P2-C）：在「首条示例」下方一行 -->
    <button
      v-if="task.entries.length > 0"
      class="md-detail__bar"
      :class="{ 'md-detail__bar--open': open }"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="md-detail__caret" :class="{ 'md-detail__caret--open': open }" aria-hidden="true" />
      <span class="md-detail__label">{{ open ? '收起' : `查看全部 ${task.entries.length} 项` }}</span>
    </button>

    <!-- EL-112 明细列表：就地展开，最多渲染前 100 条（超出给一行提示）-->
    <div v-if="open" class="md-detail__list md-scroll">
      <p v-for="r in detail.rows" :key="r.index" class="md-detail__row">
        <span class="md-detail__no">{{ r.index }}</span>
        <span class="md-detail__pair">{{ r.fromName }} → {{ r.toName }}</span>
      </p>
      <p v-if="detail.hidden > 0" class="md-detail__more">{{ moreText }}</p>
    </div>

    <div v-if="!undone" class="md-history-card__actions">
      <button class="md-btn md-btn--card" @click="emit('undo', task.id)">撤销这一条</button>
    </div>
  </article>
</template>

<style scoped>
.md-history-card__time {
  font-family: var(--md-font-num);
  font-size: 11.5px;
  color: var(--md-ink-3);
}

.md-history-card__summary {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 20px;
  margin: var(--md-space-2) 0 var(--md-space-1);
  color: var(--md-ink-1);
}

.md-history-card__counts {
  font-size: 12px;
  color: var(--md-ink-3);
  margin: 0;
}

.md-history-card__example {
  font-size: 12.5px;
  color: var(--md-ink-2);
  margin: var(--md-space-2) 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.md-history-card__more {
  color: var(--md-ink-4);
}

.md-history-card__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--md-space-3);
}

/* ── P2-C · EL-111 明细展开条 ─────────────────────────────────────── */
.md-detail__bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--md-space-2);
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--md-ink-3);
}

.md-detail__label {
  font-size: 12.5px;
  font-weight: 500;
}

/* 箭头：与 P1 折叠条（RulePanel 的 .md-adv__caret）同一套三角画法 */
.md-detail__caret {
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 5px solid currentColor;
  transition: transform var(--md-dur-hover) var(--md-ease-pop);
}

.md-detail__caret--open {
  transform: rotate(180deg);
}

/* 展开后整条转 orange-dark（箭头随 currentColor 一起变）*/
.md-detail__bar--open {
  color: var(--md-orange-dark);
}

/* ── P2-C · EL-112 明细列表 ───────────────────────────────────────── */
.md-detail__list {
  margin-top: var(--md-space-2);
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--md-bg-sunken);
  /* 容器最高 220px，超出滚动（设计 §1.3）*/
  max-height: 220px;
  overflow-y: auto;
}

.md-detail__row {
  display: flex;
  align-items: center;
  gap: var(--md-space-2);
  margin: 0;
  height: 26px;
  font-size: 12.5px;
  color: var(--md-ink-2);
}

.md-detail__no {
  flex: 0 0 auto;
  width: 20px;
  text-align: right;
  font-family: var(--md-font-num);
  font-size: 11.5px;
  color: var(--md-ink-4);
}

.md-detail__pair {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.md-detail__more {
  margin: var(--md-space-1) 0 0;
  padding-left: 28px;
  font-size: 11.5px;
  color: var(--md-ink-4);
}
</style>
