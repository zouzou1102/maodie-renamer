<script setup lang="ts">
/**
 * EL-133 导入表格预览弹窗（P3-4 / 第 4 批 · 设计 §2.2）。
 *
 * ── 四个部分，每一个都有理由 ─────────────────────────────────────────
 * ① 「我这样读的」+ 三个下拉：自动识别**可能认错**，而认错在这里等于**改错文件**。
 *    所以识别结果只是**预填**，最终以你确认为准（「不猜」原则）。
 * ② 三行统计：一眼知道「能改几个、几个对不上、几个有问题」。
 * ③ 对照表：把「第几行 → 哪个文件 → 改成什么」逐条摆出来。这是本批唯一的
 *    「看得见」，也是安全底线。**对不上的行默认就列出来** ——
 *    静默丢掉未匹配的行是这功能最危险的失败方式：用户会以为 10 行全导入了。
 * ④ 主按钮带数字（「导入这 8 项」）：用户不用回去数。
 *
 * ── 零新增令牌 / 零新增色值 ──────────────────────────────────────────
 * 三个下拉复用 `.md-select`，标记色全部是既有令牌
 * （`ok` / `bad` / `warn` / `ink-3`），外壳复用 `AppModal`（宽 700）。
 */
import { computed, ref, watch } from 'vue'
import AppModal from './AppModal.vue'
import {
  assignmentsOf,
  buildMapping,
  detectColumns,
  type ColumnChoice,
  type ColumnInfo,
  type MappingRow,
  type MappingVerdict,
  type MatchMode,
} from '@shared/table-map'
import { MAPPING_VERDICT_LABEL, MAPPING_VERDICT_MARK, MATCH_MODE_OPTIONS } from '@shared/labels'
import type { ImportedTable } from '@shared/types'
import { useFilesStore } from '../stores/files'

const props = defineProps<{
  open: boolean
  /** 用户选中的表格文件名（显示在标题里）*/
  fileName: string
  /** 解析结果；未导入过或已取消时为 null */
  table: ImportedTable | null
}>()

const emit = defineEmits<{ (e: () => void): void; (e: 'close'): void }>()

const files = useFilesStore()

/* ── 三个选择（＝三个下拉的值）──────────────────────────────────────── */

const nameCol = ref(0)
const newCol = ref(1)
const mode = ref<MatchMode>('byOrder')
const headerRow = ref(-1)
/** 对照表是否显示「全部」（默认只显示要处理的那些）*/
const showAll = ref(false)

/**
 * ★ 每次换一张表，都从自动识别的结果重新预填。
 *
 * 这也是「临时 UI 状态显式归位」的落实：上一次导入时手动改过的列，
 * 绝不该渗到下一次（本项目在 `cliOpen` / 教程 `step` 上已经踩过两次）。
 */
watch(
  () => props.table,
  (t) => {
    if (t === null) return
    const g = detectColumns(t.rows)
    nameCol.value = g.nameCol
    newCol.value = g.newCol
    mode.value = g.mode
    headerRow.value = g.headerRow
    showAll.value = false
  },
  { immediate: true },
)

/** 自动识别的完整结果（含 why / columns，用于下拉选项与那句说明）*/
const guess = computed(() => (props.table === null ? null : detectColumns(props.table.rows)))

const columns = computed<ColumnInfo[]>(() => guess.value?.columns ?? [])

const choice = computed<ColumnChoice>(() => ({
  nameCol: nameCol.value,
  newCol: newCol.value,
  mode: mode.value,
  headerRow: headerRow.value,
}))

/** 列表里能配的文件（**顺序即列表顺序** —— 按行顺序就靠它）*/
const mappingFiles = computed(() =>
  files.items.map((i) => ({ id: i.id, name: i.name, isDir: i.isDir })),
)

/**
 * ★ 对照表是**算出来的**，不是从主进程搬过来的。
 *
 * 改任何一个下拉 → 这个 computed 立刻重算 → 数字与标记跟着变。
 * 用户「发现它认错了 → 改一下 → 看看对不对」是一个 3 秒的动作（设计 §5 ①）。
 */
const mapping = computed(() =>
  props.table === null ? null : buildMapping(props.table.rows, choice.value, mappingFiles.value),
)

const counts = computed(
  () => mapping.value?.counts ?? { ok: 0, unmatched: 0, problem: 0, same: 0 },
)

/** 默认只列「对不上」和「有问题」的；可以切到「全部」*/
const rowsToShow = computed<MappingRow[]>(() => {
  const all = mapping.value?.rows ?? []
  if (showAll.value) return all
  return all.filter((r) => r.verdict === 'unmatched' || r.verdict === 'problem')
})

const nothingToWarn = computed(
  () => !showAll.value && rowsToShow.value.length === 0 && counts.value.ok > 0,
)

const orderWarn = computed(
  () => mapping.value !== null && mapping.value.orderCheck.checked && !mapping.value.orderCheck.ok,
)

/** 「表外」那部分要说清楚 —— 它们是**正常继续按规则改**的，不是被漏掉 */
const outsideText = computed(() => {
  const m = mapping.value
  if (m === null || m.outsideFiles === 0) return ''
  return `列表里另有 ${m.outsideFiles} 个文件不在这张表里，它们继续按规则算`
})

/**
 * ⚠️ xlsx 读取器的能力边界**必须写在界面上**（设计 §10 末段）：
 * 不写的话，用户会拿一张带合并单元格的表来，然后困惑「为什么读出来是空的」。
 */
const xlsxNote = computed(() => {
  const t = props.table
  if (t === null || t.sheetName === '') return ''
  return `只读第一张工作表（${t.sheetName}）；合并单元格、公式、日期格式不处理`
})

const truncatedNote = computed(() => {
  const t = props.table
  if (t === null || !t.truncated) return ''
  return `这张表有 ${t.totalRows} 行，超过 1 万行，只读了前 1 万行`
})

/* ── 能不能导 ───────────────────────────────────────────────────────── */

const canImport = computed(() => {
  const m = mapping.value
  if (m === null) return false
  if (m.rejected !== '') return false
  if (m.listEmpty) return false
  return m.counts.ok > 0
})

/** 按钮为什么是灰的（灰着且没有解释 = 用户以为软件坏了）*/
const blockReason = computed(() => {
  const m = mapping.value
  if (m === null) return ''
  if (m.rejected !== '') return '这张表跟列表对不上，先在下面看看原因'
  if (m.listEmpty) return '列表里还没有文件，先把文件拖进来'
  if (m.empty) return '这张表里没有数据行'
  if (m.counts.ok === 0) return '没有能改的项'
  return ''
})

function colLabel(c: ColumnInfo): string {
  return c.label === '' ? `第 ${c.col} 列` : `第 ${c.col} 列：${c.label}`
}

function verdictOf(v: MappingVerdict): string {
  return `${MAPPING_VERDICT_MARK[v]} ${MAPPING_VERDICT_LABEL[v]}`
}

function doImport(): void {
  const m = mapping.value
  if (m === null || !canImport.value) return
  // 只把「真的会改」的那些交出去；其它项**原样不动**（不清空、不标红）
  const n = files.applyImport(assignmentsOf(m), props.fileName)
  files.showTransient(`已导入 ${n} 项：这些名字来自 ${props.fileName}`)
  emit('close')
}
</script>

<template>
  <AppModal
    v-if="props.open"
    :title="`导入表格 · ${props.fileName}`"
    :width="700"
    @close="emit('close')"
  >
    <div class="md-import">
      <!-- ① 我这样读的 -->
      <div class="md-import__how">
        <p class="md-import__howtitle">我这样读的（不对可以改）：</p>
        <p class="md-hint md-import__why" data-import-why>{{ guess?.why ?? '' }}</p>
        <div class="md-import__ctrls">
          <label class="md-import__ctrl">
            <span class="md-import__ctrllabel">原文件名列</span>
            <select
              class="md-select md-import__select"
              data-import-name-col
              :value="String(nameCol)"
              @change="nameCol = Number(($event.target as HTMLSelectElement).value)"
            >
              <option value="0">没有这一列</option>
              <option v-for="c in columns" :key="`n${c.col}`" :value="String(c.col)">
                {{ colLabel(c) }}
              </option>
            </select>
          </label>

          <label class="md-import__ctrl">
            <span class="md-import__ctrllabel">新文件名列</span>
            <select
              class="md-select md-import__select"
              data-import-new-col
              :value="String(newCol)"
              @change="newCol = Number(($event.target as HTMLSelectElement).value)"
            >
              <option v-for="c in columns" :key="`w${c.col}`" :value="String(c.col)">
                {{ colLabel(c) }}
              </option>
            </select>
          </label>

          <label class="md-import__ctrl">
            <span class="md-import__ctrllabel">匹配方式</span>
            <select
              class="md-select md-import__select"
              data-import-mode
              :value="mode"
              @change="mode = ($event.target as HTMLSelectElement).value as MatchMode"
            >
              <option v-for="o in MATCH_MODE_OPTIONS" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </select>
          </label>
        </div>
      </div>

      <!-- ② 统计 -->
      <p class="md-import__stats" data-import-stats>
        能改 <b>{{ counts.ok }}</b> 项 · 对不上 <b>{{ counts.unmatched }}</b> 行 · 有问题
        <b>{{ counts.problem }}</b> 项<span v-if="counts.same > 0"> · 没变化 {{ counts.same }} 项</span>
      </p>
      <p v-if="outsideText" class="md-hint" data-import-outside>{{ outsideText }}</p>

      <!-- 拒绝 / 顺序警告 -->
      <p v-if="mapping && mapping.rejected" class="md-import__alert" data-import-reject>
        {{ mapping.rejected }}
      </p>
      <p v-else-if="orderWarn" class="md-import__warn" data-import-order-warn>
        {{ mapping?.orderCheck.message }}
      </p>

      <!-- ③ 对照表 -->
      <div class="md-import__table">
        <div class="md-import__head">
          <span>行</span>
          <span>表格里的原名</span>
          <span></span>
          <span>表格里的新名</span>
          <span>列表里的文件</span>
        </div>
        <div class="md-import__body md-scroll">
          <div
            v-for="r in rowsToShow"
            :key="r.rowNumber"
            class="md-import__row"
            data-import-row
            :data-verdict="r.verdict"
          >
            <span class="md-import__cell md-import__cell--num">{{ r.rowNumber }}</span>
            <span class="md-import__cell">{{ r.rawName || '—' }}</span>
            <span class="md-import__cell md-import__cell--arrow">→</span>
            <span class="md-import__cell">{{ r.rawNew || '—' }}</span>
            <span class="md-import__cell md-import__cell--result" :class="`is-${r.verdict}`">
              {{ verdictOf(r.verdict) }}
              <span class="md-import__file">{{
                r.fileName !== '' ? r.fileName : r.reason
              }}</span>
            </span>
          </div>
        </div>
      </div>

      <div class="md-import__tablefoot">
        <p v-if="nothingToWarn" class="md-hint" data-import-allgood>
          这张表里的每一行都对上了，没有要提醒你的。
        </p>
        <button class="md-btn md-btn--ghost" data-import-filter @click="showAll = !showAll">
          {{ showAll ? '只看对不上 / 有问题的' : '显示全部行' }}
        </button>
      </div>

      <!-- ④ 能力边界 -->
      <p v-if="xlsxNote" class="md-hint" data-import-note>{{ xlsxNote }}</p>
      <p v-if="truncatedNote" class="md-hint" data-import-truncated>{{ truncatedNote }}</p>
    </div>

    <template #foot>
      <span v-if="blockReason" class="md-hint" data-import-block>{{ blockReason }}</span>
      <button class="md-btn md-btn--secondary" @click="emit('close')">取消</button>
      <button
        class="md-btn md-btn--primary"
        data-import-confirm
        :disabled="!canImport"
        @click="doImport"
      >
        导入这 {{ counts.ok }} 项
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.md-import {
  display: flex;
  flex-direction: column;
  gap: var(--md-space-3);
}

.md-import__how {
  background: var(--md-bg-warm);
  border-radius: var(--md-radius-input);
  padding: var(--md-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--md-space-2);
}

.md-import__howtitle {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--md-ink-1);
}

/* `<p>` 在这套纵向节奏里会多出一截默认外边距 */
.md-hint {
  margin: 0;
}

.md-import__ctrls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--md-space-3);
}

.md-import__ctrl {
  display: flex;
  align-items: center;
  gap: var(--md-space-2);
}

.md-import__ctrllabel {
  font-size: 12.5px;
  color: var(--md-ink-2);
}

/* 三个下拉宽 220px（设计 §7.6）*/
.md-import__select {
  width: 220px;
}

.md-import__stats {
  margin: 0;
  font-size: 13px;
  color: var(--md-ink-2);
}

.md-import__stats b {
  font-family: var(--md-font-num);
  font-size: 14px;
  color: var(--md-ink-1);
}

.md-import__alert {
  margin: 0;
  font-size: 12.5px;
  line-height: 18px;
  color: var(--md-bad);
  background: var(--md-bad-bg);
  border-radius: var(--md-radius-input);
  padding: var(--md-space-2) var(--md-space-3);
}

.md-import__warn {
  margin: 0;
  font-size: 12.5px;
  line-height: 18px;
  color: var(--md-warn);
  background: var(--md-warn-bg);
  border-radius: var(--md-radius-input);
  padding: var(--md-space-2) var(--md-space-3);
}

.md-import__table {
  border: 1px solid var(--md-line);
  border-radius: var(--md-radius-input);
  overflow: hidden;
}

.md-import__head,
.md-import__row {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 18px minmax(0, 1fr) minmax(0, 1.2fr);
  align-items: center;
  gap: var(--md-space-2);
  padding: 0 var(--md-space-3);
}

.md-import__head {
  height: 30px;
  background: var(--md-bg-muted);
  font-size: 12px;
  font-weight: 600;
  color: var(--md-ink-3);
}

.md-import__body {
  max-height: 216px;
  overflow: auto;
}

/* 行高 32px（设计 §7.6）*/
.md-import__row {
  height: 32px;
  font-size: 12.5px;
  color: var(--md-ink-1);
  border-top: 1px solid var(--md-line);
}

.md-import__cell {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.md-import__cell--num,
.md-import__cell--arrow {
  color: var(--md-ink-3);
  font-family: var(--md-font-num);
}

.md-import__cell--result {
  display: flex;
  align-items: center;
  gap: var(--md-space-2);
}

.md-import__file {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--md-ink-3);
}

/* 四个标记的颜色（设计 §7.6：✓ ok · ✕ bad · ⚠ warn · ○ ink-3），全是既有令牌 */
.is-ok {
  color: var(--md-ok);
}

.is-unmatched {
  color: var(--md-bad);
}

.is-problem {
  color: var(--md-warn);
}

.is-same {
  color: var(--md-ink-3);
}

.md-import__tablefoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--md-space-3);
}
</style>
