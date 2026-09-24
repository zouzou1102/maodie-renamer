<script setup lang="ts">
/**
 * 文件提取对话框（P3-8 / 第 8 批 · SCR-13 外壳 / SCR-14 表单 / SCR-15 报告）。
 *
 * 独立子系统、不碰主流程（拍板第 5 条）：关掉后对改名零影响。
 *
 * ── 关键纪律（设计 §7.3）─────────────────────────────────────────────
 *   · 源 = 主界面**当前已加载的文件列表**（拍板第 7 条）：只读展示数量，
 *     不在对话框内增删源；对话框只设筛选条件。
 *   · 筛选（extract-filter 纯函数）与干跑 / 执行**共用同一份命中集** → 干跑≡执行（TC-95）。
 *     这里只把 plan 的结果原样展示，执行时又把同一请求发给 run，渲染层不重算落点。
 *   · 绝不覆盖：冲突项由主进程标成 skip，这里只红字展示，不做「覆盖」选项（DEC-28）。
 *   · 剪切两阶段由主进程保证（先全复制再删源），这里只展示结果（含半移动态标红）。
 *   · 按 Excel 复用 P3-4 解析器（fs.importTable → excelFilenamesOf），解析失败即报错、不干跑。
 *
 * 复用：AppModal 外壳、既有 .md-btn / .md-select / .md-check / .md-hint 令牌，零新增色值 / 令牌。
 *       watch(open) 复位所有临时状态（与 MergeDialog 同款纪律）。
 */
import { computed, ref, watch } from 'vue'
import AppModal from './AppModal.vue'
import MdIcon from './MdIcon.vue'
import type {
  ExtractFilter,
  ExtractPlanResult,
  ExtractRequest,
  ExtractRunResult,
  FileCategory,
  MergePlanEntry,
} from '@shared/types'
import { excelFilenamesOf } from '@shared/extract-filter'
import { useFilesStore } from '../stores/files'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const files = useFilesStore()

/* ── 筛选状态 ───────────────────────────────────────────────────────── */

/** 按类型：勾选的类别（空 = 不按类型筛）*/
const categories = ref<FileCategory[]>([])
/** 按名称 */
const nameKeyword = ref('')
const nameUseRegex = ref(false)
/** 按 Excel：文件名数组 + 来源文件名（展示用）*/
const excelNames = ref<string[]>([])
const excelFileName = ref('')
const excelError = ref('')

const CATEGORIES: Array<{ value: FileCategory; label: string }> = [
  { value: 'image', label: '图片' },
  { value: 'doc', label: '文档' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
  { value: 'archive', label: '压缩包' },
  { value: 'other', label: '其他' },
]

function toggleCategory(v: FileCategory): void {
  const i = categories.value.indexOf(v)
  if (i >= 0) categories.value.splice(i, 1)
  else categories.value.push(v)
}

/* ── 操作 / 目标 / 开关 ─────────────────────────────────────────────── */

const operation = ref<'copy' | 'cut'>('copy')
const targetMode = ref<'existing' | 'new'>('existing')
const existingTarget = ref('')
const newParent = ref('')
const newName = ref('提取')
const openAfter = ref(true)

/* ── 运行态 ─────────────────────────────────────────────────────────── */

const planning = ref(false)
const running = ref(false)
const plan = ref<ExtractPlanResult | null>(null)
const runResult = ref<ExtractRunResult | null>(null)

/** 每次打开都回到默认（独立对话框、零回归面，状态绝不渗出）*/
watch(
  () => props.open,
  (now) => {
    if (!now) return
    categories.value = []
    nameKeyword.value = ''
    nameUseRegex.value = false
    excelNames.value = []
    excelFileName.value = ''
    excelError.value = ''
    operation.value = 'copy'
    targetMode.value = 'existing'
    existingTarget.value = ''
    newParent.value = ''
    newName.value = '提取'
    openAfter.value = true
    planning.value = false
    running.value = false
    plan.value = null
    runResult.value = null
  },
)

/** 目标绝对路径（新建 = 父目录 + 名称）*/
const target = computed<string>(() => {
  if (targetMode.value === 'existing') return existingTarget.value
  if (newParent.value && newName.value.trim()) return `${newParent.value}\\${newName.value.trim()}`
  return ''
})

const sourceCount = computed(() => files.items.length)

/** 按名称正则即时校验（EX-22）：非法则红框 + 拒绝干跑 */
const nameRegexError = computed<string>(() => {
  if (!nameUseRegex.value || nameKeyword.value.trim() === '') return ''
  try {
    // 与 extract-filter 同款：默认忽略大小写
    new RegExp(nameKeyword.value, 'i')
    return ''
  } catch {
    return '正则语法不对，检查后再干跑'
  }
})

const canPlan = computed(
  () =>
    sourceCount.value > 0 &&
    target.value !== '' &&
    !planning.value &&
    !running.value &&
    nameRegexError.value === '',
)

/** 整批被拒（空列表 / 目标在源内 / 新建目标已存在 / 正则非法）→ 禁用执行 */
const rejected = computed(() => plan.value?.rejected ?? null)

const VISIBLE_ENTRIES = 200
const visibleEntries = computed(() => (plan.value ? plan.value.entries.slice(0, VISIBLE_ENTRIES) : []))
const hiddenEntries = computed(() =>
  plan.value ? Math.max(0, plan.value.entries.length - VISIBLE_ENTRIES) : 0,
)

/* ── 构造请求：把主列表裁成 ExtractSourceFile[]，组装筛选 ────────────── */

function buildFilter(): ExtractFilter {
  const f: ExtractFilter = {}
  if (categories.value.length > 0) f.categories = [...categories.value]
  if (nameKeyword.value.trim() !== '') f.name = { keyword: nameKeyword.value.trim(), useRegex: nameUseRegex.value }
  if (excelNames.value.length > 0) f.excelNames = [...excelNames.value]
  return f
}

function buildReq(): ExtractRequest {
  return {
    target: target.value,
    operation: operation.value,
    items: files.items.map((it) => ({
      fullPath: it.fullPath,
      name: it.name,
      ext: it.ext,
      isDir: it.isDir,
    })),
    filter: buildFilter(),
    targetNew: targetMode.value === 'new',
    openAfter: openAfter.value,
  }
}

/* ── 选目标 ─────────────────────────────────────────────────────────── */

async function pickExistingTarget(): Promise<void> {
  const res = await window.maodie.fs.pickDirectory()
  if (res.ok && !res.data.canceled && res.data.paths.length > 0) existingTarget.value = res.data.paths[0]
}

async function pickNewParent(): Promise<void> {
  const res = await window.maodie.fs.pickDirectory()
  if (res.ok && !res.data.canceled && res.data.paths.length > 0) newParent.value = res.data.paths[0]
}

/* ── 按 Excel：复用 P3-4 解析器选表 → 取文件名列 ────────────────────── */

async function pickExcel(): Promise<void> {
  excelError.value = ''
  const res = await window.maodie.fs.importTable()
  if (!res.ok) {
    excelError.value = '读取表格失败'
    return
  }
  if (res.data.canceled || !res.data.table) return
  const r = excelFilenamesOf(res.data.table)
  if (!r.ok) {
    // EX-21 解析失败（没认出「原文件名」列）→ 报错、不进干跑
    excelError.value = '没在表里找到「原文件名」列，请检查表头或改用其他筛选'
    excelNames.value = []
    excelFileName.value = ''
    return
  }
  excelNames.value = r.names
  excelFileName.value = res.data.fileName
}

/* ── 干跑 + 执行 ────────────────────────────────────────────────────── */

async function doPlan(): Promise<void> {
  if (!canPlan.value) return
  planning.value = true
  runResult.value = null
  excelError.value = ''
  try {
    const res = await window.maodie.extract.plan(buildReq())
    if (!res.ok) {
      plan.value = {
        target: target.value,
        sourceCount: sourceCount.value,
        hitCount: 0,
        fileCount: 0,
        entries: [],
        summary: { ready: 0, skip: 0, error: 0 },
        unmatched: [],
        rejected: { code: res.code, reason: res.detail ?? '无法开始提取' },
      }
      return
    }
    plan.value = res.data
  } finally {
    planning.value = false
  }
}

async function doRun(): Promise<void> {
  if (!plan.value || rejected.value || nameRegexError.value !== '') return
  running.value = true
  try {
    const res = await window.maodie.extract.run(buildReq())
    if (res.ok) runResult.value = res.data
  } finally {
    running.value = false
  }
}

function shortName(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return i >= 0 ? p.slice(i + 1) : p
}

function outcomeLabel(o: MergePlanEntry['outcome']): string {
  if (o === 'ready') return operation.value === 'cut' ? '将移动' : '将复制'
  if (o === 'skip') return '跳过'
  return '失败'
}
</script>

<template>
  <AppModal v-if="props.open" title="文件提取" :width="600" @close="emit('close')">
    <div class="md-extract">
      <!-- ── SCR-14 表单 ── -->
      <section class="md-extract__form">
        <!-- 源（只读，来自主列表）-->
        <div class="md-extract__row">
          <span class="md-extract__label">源</span>
          <p class="md-extract__src" data-extract-source>
            当前已加载 <b>{{ sourceCount }}</b> 个文件（来自主列表，不可在此增删）
          </p>
        </div>

        <!-- 筛选条件 -->
        <p class="md-extract__sectiontitle">筛选条件（多个同时满足 · AND）</p>

        <!-- 按类型 -->
        <div class="md-extract__row">
          <span class="md-extract__label">按类型</span>
          <div class="md-extract__cats" data-extract-cats>
            <label v-for="c in CATEGORIES" :key="c.value" class="md-check md-check--inline">
              <input
                type="checkbox"
                :checked="categories.includes(c.value)"
                :data-extract-cat="c.value"
                @change="toggleCategory(c.value)"
              />
              <span class="md-check__box"><MdIcon name="check" :size="11" /></span>
              <span class="md-check__label">{{ c.label }}</span>
            </label>
          </div>
        </div>

        <!-- 按名称 -->
        <div class="md-extract__row">
          <span class="md-extract__label">按名称</span>
          <div class="md-extract__name">
            <input
              v-model="nameKeyword"
              class="md-input md-extract__nameinput"
              :class="{ 'is-bad': nameRegexError !== '' }"
              data-extract-name
              placeholder="文件名包含的关键词"
            />
            <label class="md-check md-check--inline">
              <input v-model="nameUseRegex" type="checkbox" data-extract-regex />
              <span class="md-check__box"><MdIcon name="check" :size="11" /></span>
              <span class="md-check__label">使用正则</span>
            </label>
            <p v-if="nameRegexError" class="md-extract__fieldbad" data-extract-regex-error>{{ nameRegexError }}</p>
          </div>
        </div>

        <!-- 按 Excel -->
        <div class="md-extract__row">
          <span class="md-extract__label">按Excel</span>
          <div class="md-extract__excel">
            <button class="md-btn md-btn--secondary" data-extract-excel-pick @click="pickExcel">选择文件…</button>
            <span v-if="excelFileName" class="md-extract__excelname" :title="excelFileName">{{ excelFileName }}（{{ excelNames.length }} 个名字）</span>
            <span v-else class="md-hint">未选</span>
            <p v-if="excelError" class="md-extract__fieldbad" data-extract-excel-error>{{ excelError }}</p>
          </div>
        </div>

        <!-- 操作 -->
        <div class="md-extract__row">
          <span class="md-extract__label">操作</span>
          <div class="md-extract__modes" data-extract-op>
            <label class="md-radio">
              <input v-model="operation" type="radio" name="extractOp" value="copy" />
              <span>复制（保留源）</span>
            </label>
            <label class="md-radio">
              <input v-model="operation" type="radio" name="extractOp" value="cut" />
              <span>剪切（移动，删源）</span>
            </label>
          </div>
        </div>

        <!-- 目标目录 -->
        <div class="md-extract__row">
          <span class="md-extract__label">目标目录</span>
          <div class="md-extract__target">
            <label class="md-radio">
              <input v-model="targetMode" type="radio" name="extractTarget" value="existing" />
              <span>选择已有</span>
            </label>
            <button
              class="md-btn md-btn--secondary md-extract__pick"
              data-extract-pick-existing
              :disabled="targetMode !== 'existing'"
              @click="pickExistingTarget"
            >
              选择…
            </button>
            <span v-if="targetMode === 'existing' && existingTarget" class="md-extract__targetpath" :title="existingTarget">{{ existingTarget }}</span>

            <label class="md-radio md-radio--block">
              <input v-model="targetMode" type="radio" name="extractTarget" value="new" />
              <span>新建于</span>
            </label>
            <div v-if="targetMode === 'new'" class="md-extract__new">
              <button
                class="md-btn md-btn--secondary"
                data-extract-pick-newparent
                :disabled="targetMode !== 'new'"
                @click="pickNewParent"
              >
                选择父目录…
              </button>
              <input
                v-model="newName"
                class="md-input md-extract__name"
                data-extract-newname
                placeholder="文件夹名"
              />
              <span v-if="newParent" class="md-extract__targetpath" :title="target">{{ target }}</span>
            </div>
          </div>
        </div>

        <!-- 开关 -->
        <div class="md-extract__row md-extract__row--opts">
          <label class="md-check">
            <input v-model="openAfter" type="checkbox" data-extract-openafter />
            <span class="md-check__box"><MdIcon name="check" :size="11" /></span>
            <span class="md-check__label">完成后打开目标目录</span>
          </label>
        </div>
      </section>

      <!-- ── SCR-15 干跑报告 ── -->
      <section v-if="plan" class="md-extract__report" data-extract-report>
        <div v-if="rejected" class="md-extract__reject" data-extract-reject>⚠️ 不能开始：{{ rejected.reason }}</div>
        <template v-else>
          <p class="md-extract__summary">
            当前列表 {{ plan.sourceCount }} → 筛出 <b>{{ plan.hitCount }}</b> 个 → <b>{{ plan.target }}</b><br />
            将{{ operation === 'cut' ? '移动' : '复制' }}
            <b class="ok">{{ plan.summary.ready }}</b> ·
            将跳过 <b class="bad">{{ plan.summary.skip }}</b> ·
            失败 <b class="bad">{{ plan.summary.error }}</b>
          </p>
          <p v-if="plan.note" class="md-extract__note">{{ plan.note }}</p>
          <p v-if="plan.unmatched.length" class="md-extract__unmatched" data-extract-unmatched>
            ⚠️ Excel 里有 {{ plan.unmatched.length }} 个名字在主列表里没对上：{{ plan.unmatched.slice(0, 8).join('、') }}<template v-if="plan.unmatched.length > 8">…</template>
          </p>
          <ul class="md-extract__entries">
            <li
              v-for="(e, i) in visibleEntries"
              :key="i"
              class="md-extract__entry"
              :class="e.outcome"
              :data-extract-entry="e.outcome"
            >
              <span class="md-extract__epath">{{ shortName(e.srcPath) }}</span>
              <span class="md-extract__arrow">→</span>
              <span class="md-extract__epath">{{ shortName(e.destPath) }}</span>
              <span class="md-extract__badge" :class="e.outcome">{{ outcomeLabel(e.outcome) }}</span>
              <span v-if="e.reason" class="md-extract__ereason">{{ e.reason }}</span>
            </li>
          </ul>
          <p v-if="hiddenEntries" class="md-hint">…还有 {{ hiddenEntries }} 条未显示</p>
        </template>
      </section>

      <!-- ── 执行结果 ── -->
      <section v-if="runResult" class="md-extract__done" data-extract-done>
        <p class="md-extract__summary">
          {{ operation === 'cut' ? '移动' : '复制' }}
          <b class="ok">{{ runResult.summary.copied }}</b> ·
          跳过 <b class="bad">{{ runResult.summary.skipped }}</b> ·
          失败 <b class="bad">{{ runResult.summary.errored }}</b>
          <template v-if="runResult.summary.deleted">· 已删除源 {{ runResult.summary.deleted }}</template>
        </p>
        <p v-if="runResult.halfMoved" class="md-extract__reject">⚠️ 有文件移动后删不掉，已复制的部分保留在目标处</p>
        <p v-else class="md-hint">提取完成。</p>
      </section>
    </div>

    <template #foot>
      <template v-if="!plan || rejected">
        <span v-if="!canPlan" class="md-hint" data-extract-block>
          <template v-if="sourceCount === 0">列表为空，请先添加文件</template>
          <template v-else-if="nameRegexError">正则语法不对</template>
          <template v-else>先选目标目录</template>
        </span>
        <button class="md-btn md-btn--secondary" @click="emit('close')">取消</button>
        <button
          class="md-btn md-btn--primary"
          data-extract-plan
          :disabled="!canPlan"
          :class="{ busy: planning }"
          @click="doPlan"
        >
          {{ planning ? '计算中…' : '干跑并预览' }}
        </button>
      </template>
      <template v-else>
        <button class="md-btn md-btn--secondary" @click="emit('close')">关闭</button>
        <button
          v-if="!runResult"
          class="md-btn md-btn--primary"
          data-extract-run
          :disabled="running || plan.hitCount === 0 || nameRegexError !== ''"
          :class="{ busy: running }"
          @click="doRun"
        >
          {{ running ? '执行中…' : '确认执行' }}
        </button>
      </template>
    </template>
  </AppModal>
</template>

<style scoped>
.md-extract {
  display: flex;
  flex-direction: column;
  gap: var(--md-space-4);
}

.md-extract__row {
  display: flex;
  align-items: flex-start;
  gap: var(--md-space-3);
}

.md-extract__label {
  flex: none;
  width: 76px;
  font-size: 14px;
  font-weight: 600;
  color: var(--md-ink-1);
  padding-top: 4px;
}

.md-extract__src {
  flex: 1;
  margin: 0;
  font-size: 13.5px;
  color: var(--md-ink-2);
}
.md-extract__src b {
  color: var(--md-ink-1);
}

.md-extract__sectiontitle {
  margin: var(--md-space-1) 0 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--md-ink-3);
}

.md-extract__cats {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: var(--md-space-2) var(--md-space-3);
}
.md-check--inline {
  display: inline-flex;
}

.md-extract__name {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--md-space-2);
}
.md-extract__nameinput {
  flex: 1;
  min-width: 160px;
  height: var(--md-ctrl-h, 32px);
  padding: 0 var(--md-space-2);
  border: 1px solid var(--md-line-strong);
  border-radius: 6px;
  font-size: 13.5px;
  background: var(--md-bg-card);
  color: var(--md-ink-1);
}
.md-extract__nameinput.is-bad {
  border-color: var(--md-bad);
}
.md-extract__fieldbad {
  flex-basis: 100%;
  margin: 0;
  color: var(--md-bad);
  font-size: 12px;
}

.md-extract__excel {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--md-space-2);
}
.md-extract__excelname {
  font-size: 12.5px;
  color: var(--md-ink-2);
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.md-extract__modes {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.md-radio {
  display: inline-flex;
  align-items: center;
  gap: var(--md-space-2);
  font-size: 13.5px;
  color: var(--md-ink-1);
  cursor: pointer;
}
.md-radio--block {
  margin-top: var(--md-space-2);
}

.md-extract__target {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--md-space-2);
}
.md-extract__targetpath {
  font-size: 12.5px;
  color: var(--md-ink-2);
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.md-extract__new {
  flex-basis: 100%;
  display: flex;
  align-items: center;
  gap: var(--md-space-2);
  margin-top: 4px;
}
.md-extract__name.md-extract__name {
  width: 160px;
}

.md-extract__row--opts {
  flex-direction: column;
  gap: var(--md-space-2);
}

/* 报告 */
.md-extract__report {
  border-top: 1px solid var(--md-line);
  padding-top: var(--md-space-3);
  max-height: 300px;
  overflow: auto;
}
.md-extract__summary {
  margin: 0 0 var(--md-space-2);
  font-size: 13.5px;
  color: var(--md-ink-1);
  line-height: 1.6;
}
.md-extract__note {
  margin: 0 0 var(--md-space-2);
  font-size: 13px;
  color: var(--md-ink-2);
}
.md-extract__unmatched {
  margin: 0 0 var(--md-space-2);
  font-size: 12.5px;
  color: var(--md-bad);
  background: var(--md-bad-bg-soft);
  border-radius: 6px;
  padding: var(--md-space-1) var(--md-space-2);
}
.md-extract__entries {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.md-extract__entry {
  display: flex;
  align-items: center;
  gap: var(--md-space-2);
  font-size: 12px;
  color: var(--md-ink-2);
  padding: 2px 4px;
  border-radius: 4px;
}
.md-extract__entry.skip,
.md-extract__entry.error {
  background: var(--md-bad-bg-soft);
}
.md-extract__epath {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.md-extract__arrow {
  color: var(--md-ink-3);
}
.md-extract__badge {
  flex: none;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--md-bg-muted);
  color: var(--md-ink-2);
}
.md-extract__badge.skip,
.md-extract__badge.error {
  background: var(--md-bad-bg);
  color: var(--md-bad);
}
.md-extract__ereason {
  color: var(--md-bad);
  font-size: 11.5px;
}
.md-extract__reject {
  color: var(--md-bad);
  font-size: 13px;
  font-weight: 600;
  background: var(--md-bad-bg-soft);
  border-radius: 6px;
  padding: var(--md-space-2) var(--md-space-3);
}
.md-extract__done {
  border-top: 1px solid var(--md-line);
  padding-top: var(--md-space-3);
}

.ok {
  color: var(--md-ok);
}
.bad {
  color: var(--md-bad);
}
.busy {
  opacity: 0.7;
}
</style>
