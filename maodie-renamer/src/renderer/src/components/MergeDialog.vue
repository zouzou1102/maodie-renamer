<script setup lang="ts">
/**
 * 文件夹合并对话框（P3-7 / 第 7 批 · SCR-10 外壳 / SCR-11 表单 / SCR-12 报告）。
 *
 * 独立子系统、不碰主流程（拍板第 7 条）：关掉后对改名零影响。
 *
 * ── 关键纪律（设计 §7.3）─────────────────────────────────────────────
 *   · 干跑报告与执行**共用主进程同一份 `merge-plan`** → 「干跑 ≡ 执行」（TC-87）。
 *     这里只把 `plan` 的结果原样展示，执行时又把同一请求发给 `run`，
 *     渲染层**不重算任何落点**。
 *   · 绝不覆盖：冲突项由主进程标成 skip，这里只红字展示，不做「覆盖」选项。
 *   · 剪切两阶段由主进程保证（先全复制再删源），这里只展示结果（含半移动态标红）。
 *
 * 复用：AppModal 外壳、既有 .md-btn / .md-select / .md-check / .md-hint 令牌，
 *       零新增色值 / 令牌。watch(open) 复位所有临时状态。
 */
import { computed, ref, watch } from 'vue'
import AppModal from './AppModal.vue'
import MdIcon from './MdIcon.vue'
import type {
  MergeMode,
  MergeOperation,
  MergePlanResult,
  MergeRequest,
  MergeRunResult,
} from '@shared/types'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

/* ── 表单状态 ───────────────────────────────────────────────────────── */

const sourcePaths = ref<string[]>([])
const mode = ref<MergeMode>('same')
const operation = ref<MergeOperation>('copy')
const targetMode = ref<'existing' | 'new'>('existing')
const existingTarget = ref('')
const newParent = ref('')
const newName = ref('合并')
const recurse = ref(true)
const openAfter = ref(true)

const planning = ref(false)
const running = ref(false)
const plan = ref<MergePlanResult | null>(null)
const runResult = ref<MergeRunResult | null>(null)

/** 每次打开都回到默认（设计 §5：独立对话框、零回归面，状态绝不渗出）*/
watch(
  () => props.open,
  (now) => {
    if (!now) return
    sourcePaths.value = []
    mode.value = 'same'
    operation.value = 'copy'
    targetMode.value = 'existing'
    existingTarget.value = ''
    newParent.value = ''
    newName.value = '合并'
    recurse.value = true
    openAfter.value = true
    planning.value = false
    running.value = false
    plan.value = null
    runResult.value = null
  },
)

const MODES: Array<{ value: MergeMode; label: string }> = [
  { value: 'same', label: '只合并到同一目录' },
  { value: 'byExt', label: '按扩展名各建一个文件夹' },
  { value: 'byCreated', label: '按创建日期（到日）' },
  { value: 'byModified', label: '按修改日期（到日）' },
]

/** 目标绝对路径（新建 = 父目录 + 名称）*/
const target = computed<string>(() => {
  if (targetMode.value === 'existing') return existingTarget.value
  if (newParent.value && newName.value.trim()) return `${newParent.value}\\${newName.value.trim()}`
  return ''
})

const sourceCount = computed(() => sourcePaths.value.length)
const canPlan = computed(() => sourceCount.value > 0 && target.value !== '' && !planning.value && !running.value)

/** 整批被拒（目标在源内 / 新建目标已存在 / 空源 / 超限）→ 禁用执行 */
const rejected = computed(() => plan.value?.rejected ?? null)

/** 报告里展示的条目上限，超出显示「还有 N 条」提示（避免长列表卡 UI）*/
const VISIBLE_ENTRIES = 200
const visibleEntries = computed(() => (plan.value ? plan.value.entries.slice(0, VISIBLE_ENTRIES) : []))
const hiddenEntries = computed(() =>
  plan.value ? Math.max(0, plan.value.entries.length - VISIBLE_ENTRIES) : 0,
)

function buildReq(): MergeRequest {
  return {
    target: target.value,
    mode: mode.value,
    operation: operation.value,
    sourcePaths: sourcePaths.value,
    recurse: recurse.value,
    targetNew: targetMode.value === 'new',
    openAfter: openAfter.value,
  }
}

/* ── 源：选文件 / 选文件夹 / 拖入 / 移除 ─────────────────────────────── */

async function addFiles(): Promise<void> {
  const res = await window.maodie.fs.pickFiles()
  if (res.ok && !res.data.canceled) pushSources(res.data.paths)
}

async function addFolder(): Promise<void> {
  const res = await window.maodie.fs.pickDirectory()
  if (res.ok && !res.data.canceled) pushSources(res.data.paths)
}

/** 选「目标：选择已有」*/
async function pickExistingTarget(): Promise<void> {
  const res = await window.maodie.fs.pickDirectory()
  if (res.ok && !res.data.canceled && res.data.paths.length > 0) {
    existingTarget.value = res.data.paths[0]
  }
}

/** 选「目标：新建」的父目录 */
async function pickNewParent(): Promise<void> {
  const res = await window.maodie.fs.pickDirectory()
  if (res.ok && !res.data.canceled && res.data.paths.length > 0) {
    newParent.value = res.data.paths[0]
  }
}

function pushSources(paths: string[]): void {
  const set = new Set(sourcePaths.value.map((p) => p.toLowerCase()))
  for (const p of paths) {
    if (!set.has(p.toLowerCase())) {
      sourcePaths.value.push(p)
      set.add(p.toLowerCase())
    }
  }
}

function removeSource(i: number): void {
  sourcePaths.value.splice(i, 1)
}

/**
 * 从 DataTransfer 挑出真实文件系统路径（与 useDragDrop 的 extractPaths 同款逻辑）。
 * ★ 关键：必须在 `items` 上取 `getAsFile()?.path` —— 在 `contextIsolation:true` 下，
 *   `dataTransfer.files[i].path` 经常是 `undefined`，只有 `items` 这条路能拿到真实路径
 *   （这正是「拖不进」的根因）。文件夹在 Windows 上也走 'Files'，同样能拿到。
 */
function extractDroppedPaths(dt: DataTransfer | null): string[] {
  if (!dt) return []
  const out: string[] = []
  for (const it of Array.from(dt.items ?? [])) {
    if (it.kind !== 'file') continue
    const p = (it.getAsFile() as (File & { path?: string }) | null)?.path
    if (typeof p === 'string' && p !== '') out.push(p)
  }
  if (out.length > 0) return out
  // 兜底：某些环境只有 files 带 path
  for (const file of Array.from(dt.files ?? [])) {
    const p = (file as File & { path?: string }).path
    if (typeof p === 'string' && p !== '') out.push(p)
  }
  return out
}

/** 拖拽悬停：必须 preventDefault + 显式 dropEffect='copy'，否则 drop 事件不会触发（bug 报障 ①）*/
function onDragOver(e: DragEvent): void {
  e.preventDefault()
  if (e.dataTransfer) {
    const hasFs = Array.from(e.dataTransfer.types ?? []).includes('Files')
    e.dataTransfer.dropEffect = hasFs ? 'copy' : 'none'
  }
}

/** 拖拽进入：同样 preventDefault，给后续 drop 放行 */
function onDragEnter(e: DragEvent): void {
  e.preventDefault()
}

/** 拖入文件 / 文件夹（Electron 渲染层读 dataTransfer 的真实路径）*/
function onDrop(e: DragEvent): void {
  e.preventDefault()
  const paths = extractDroppedPaths(e.dataTransfer)
  if (paths.length) pushSources(paths)
}

/* ── 干跑 + 执行 ────────────────────────────────────────────────────── */

async function doPlan(): Promise<void> {
  if (!canPlan.value) return
  planning.value = true
  runResult.value = null
  try {
    const res = await window.maodie.merge.plan(buildReq())
    if (!res.ok) {
      plan.value = {
        target: target.value,
        fileCount: 0,
        entries: [],
        summary: { ready: 0, skip: 0, error: 0 },
        rejected: { code: res.code, reason: reasonOf(res.code) },
      }
      return
    }
    plan.value = res.data
  } catch (err) {
    // ★ 任何意外（IPC 异常等）都应显式展示，绝不让「点击没反应」静默发生（bug 报障 ②）
    plan.value = {
      target: target.value,
      fileCount: 0,
      entries: [],
      summary: { ready: 0, skip: 0, error: 0 },
      rejected: { code: 'E_UNKNOWN', reason: `干跑失败：${err instanceof Error ? err.message : String(err)}` },
    }
  } finally {
    planning.value = false
  }
}

async function doRun(): Promise<void> {
  if (!plan.value || rejected.value) return
  running.value = true
  try {
    const res = await window.maodie.merge.run(buildReq())
    if (res.ok) runResult.value = res.data
  } finally {
    running.value = false
  }
}

/** 业务码 → 中文（兜底；主进程通常已在 plan.rejected.reason 给了更具体的）*/
function reasonOf(code: string): string {
  const map: Record<string, string> = {
    E_TARGET_INSIDE_SOURCE: '目标文件夹不能设在源文件夹里面',
    E_TARGET_EXISTS: '这个文件夹已经存在了，换个名字或改用「选择已有」',
    E_FLATTEN_OVERFLOW: '源里的文件太多，先分批整理再合并',
    E_LIST_EMPTY: '没有可合并的文件',
  }
  return map[code] ?? '无法开始合并'
}

function shortName(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return i >= 0 ? p.slice(i + 1) : p
}

function outcomeLabel(o: 'ready' | 'skip' | 'error'): string {
  if (o === 'ready') return '将复制'
  if (o === 'skip') return '跳过'
  return '失败'
}
</script>

<template>
  <AppModal v-if="props.open" title="文件夹合并" :width="720" @close="emit('close')">
    <div class="md-merge">
      <!-- ── SCR-11 表单 ── -->
      <section class="md-merge__form">
        <!-- 源 -->
        <div class="md-merge__row">
          <span class="md-merge__label">源</span>
          <div class="md-merge__src">
            <div
              class="md-merge__drop"
              data-merge-drop
              :class="{ 'is-empty': sourceCount === 0 }"
              @dragenter="onDragEnter"
              @dragover="onDragOver"
              @drop="onDrop"
            >
              <p v-if="sourceCount === 0" class="md-hint">拖入文件 / 文件夹，或点下面按钮添加</p>
              <ul v-else class="md-merge__list">
                <li v-for="(p, i) in sourcePaths" :key="p" :title="p">
                  <span class="md-merge__item">{{ p }}</span>
                  <button class="md-merge__x" :data-merge-remove="i" @click="removeSource(i)">
                    <MdIcon name="rowDelete" :size="12" />
                  </button>
                </li>
              </ul>
            </div>
            <div class="md-merge__srcbtns">
              <button class="md-btn md-btn--secondary" data-merge-add-files @click="addFiles">添加文件</button>
              <button class="md-btn md-btn--secondary" data-merge-add-folder @click="addFolder">添加文件夹</button>
            </div>
            <p class="md-hint">已选 {{ sourceCount }} 个（文件夹会按开关递归摊平）</p>
          </div>
        </div>

        <!-- 合并方式 -->
        <div class="md-merge__row">
          <span class="md-merge__label">合并方式</span>
          <div class="md-merge__modes" data-merge-mode>
            <label v-for="m in MODES" :key="m.value" class="md-radio">
              <input v-model="mode" type="radio" name="mergeMode" :value="m.value" />
              <span>{{ m.label }}</span>
            </label>
          </div>
        </div>

        <!-- 操作 -->
        <div class="md-merge__row">
          <span class="md-merge__label">操作</span>
          <div class="md-merge__modes" data-merge-op>
            <label class="md-radio">
              <input v-model="operation" type="radio" name="mergeOp" value="copy" />
              <span>复制（保留源）</span>
            </label>
            <label class="md-radio">
              <input v-model="operation" type="radio" name="mergeOp" value="cut" />
              <span>剪切（移动，删源）</span>
            </label>
          </div>
        </div>

        <!-- 目标文件夹 -->
        <div class="md-merge__row">
          <span class="md-merge__label">目标文件夹</span>
          <div class="md-merge__target">
            <label class="md-radio">
              <input v-model="targetMode" type="radio" name="mergeTarget" value="existing" />
              <span>选择已有</span>
            </label>
            <button
              class="md-btn md-btn--secondary md-merge__pick"
              data-merge-pick-existing
              :disabled="targetMode !== 'existing'"
              @click="pickExistingTarget"
            >
              选择…
            </button>
            <span v-if="targetMode === 'existing' && existingTarget" class="md-merge__targetpath" :title="existingTarget">{{ existingTarget }}</span>

            <label class="md-radio md-radio--block">
              <input v-model="targetMode" type="radio" name="mergeTarget" value="new" />
              <span>新建于</span>
            </label>
            <div v-if="targetMode === 'new'" class="md-merge__new">
              <button
                class="md-btn md-btn--secondary"
                data-merge-pick-newparent
                :disabled="targetMode !== 'new'"
                @click="pickNewParent"
              >
                选择父目录…
              </button>
              <input
                v-model="newName"
                class="md-input md-merge__name"
                data-merge-newname
                placeholder="文件夹名"
              />
              <span v-if="newParent" class="md-merge__targetpath" :title="target">{{ target }}</span>
            </div>
          </div>
        </div>

        <!-- 开关 -->
        <div class="md-merge__row md-merge__row--opts">
          <label class="md-check">
            <input v-model="recurse" type="checkbox" data-merge-recurse />
            <span class="md-check__box"><MdIcon name="check" :size="11" /></span>
            <span class="md-check__label">递归摊平子文件夹（深度≤20，文件≤10000）</span>
          </label>
          <label class="md-check">
            <input v-model="openAfter" type="checkbox" data-merge-openafter />
            <span class="md-check__box"><MdIcon name="check" :size="11" /></span>
            <span class="md-check__label">完成后打开目标目录</span>
          </label>
        </div>
      </section>

      <!-- ── SCR-12 干跑报告 ── -->
      <section v-if="plan" class="md-merge__report" data-merge-report>
        <div v-if="rejected" class="md-merge__reject" data-merge-reject>
          ⚠️ 不能开始：{{ rejected.reason }}
        </div>
        <template v-else>
          <p class="md-merge__summary">
            共 {{ plan.fileCount }} 个文件 → <b>{{ plan.target }}</b><br />
            将复制 <b class="ok">{{ plan.summary.ready }}</b> ·
            将跳过 <b class="bad">{{ plan.summary.skip }}</b> ·
            失败 <b class="bad">{{ plan.summary.error }}</b>
          </p>
          <ul class="md-merge__entries">
            <li
              v-for="(e, i) in visibleEntries"
              :key="i"
              class="md-merge__entry"
              :class="e.outcome"
              :data-merge-entry="e.outcome"
            >
              <span class="md-merge__epath">{{ shortName(e.srcPath) }}</span>
              <span class="md-merge__arrow">→</span>
              <span class="md-merge__epath">{{ shortName(e.destPath) }}</span>
              <span class="md-merge__badge" :class="e.outcome">{{ outcomeLabel(e.outcome) }}</span>
              <span v-if="e.reason" class="md-merge__ereason">{{ e.reason }}</span>
            </li>
          </ul>
          <p v-if="hiddenEntries" class="md-hint">…还有 {{ hiddenEntries }} 条未显示</p>
        </template>
      </section>

      <!-- ── 执行结果 ── -->
      <section v-if="runResult" class="md-merge__done" data-merge-done>
        <p class="md-merge__summary">
          复制 <b class="ok">{{ runResult.summary.copied }}</b> ·
          跳过 <b class="bad">{{ runResult.summary.skipped }}</b> ·
          失败 <b class="bad">{{ runResult.summary.errored }}</b>
          <template v-if="runResult.summary.deleted">· 已删除源 {{ runResult.summary.deleted }}</template>
        </p>
        <p v-if="runResult.halfMoved" class="md-merge__reject">⚠️ 有文件移动后删不掉，已复制的部分保留在目标处</p>
        <p v-else class="md-hint">合并完成。</p>
      </section>
    </div>

    <template #foot>
      <template v-if="!plan || rejected">
        <span v-if="!canPlan" class="md-hint" data-merge-block>
          {{ sourceCount === 0 ? '先选源文件 / 文件夹' : '先选目标文件夹' }}
        </span>
        <button class="md-btn md-btn--secondary" @click="emit('close')">取消</button>
        <button class="md-btn md-btn--primary" data-merge-plan :disabled="!canPlan" :class="{ busy: planning }" @click="doPlan">
          {{ planning ? '计算中…' : '干跑并预览' }}
        </button>
      </template>
      <template v-else>
        <button class="md-btn md-btn--secondary" @click="emit('close')">关闭</button>
        <button
          v-if="!runResult"
          class="md-btn md-btn--primary"
          data-merge-run
          :disabled="running || rejected !== null"
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
.md-merge {
  display: flex;
  flex-direction: column;
  gap: var(--md-space-4);
}

.md-merge__row {
  display: flex;
  align-items: flex-start;
  gap: var(--md-space-3);
}

.md-merge__label {
  flex: none;
  width: 76px;
  font-size: 14px;
  font-weight: 600;
  color: var(--md-ink-1);
  padding-top: 4px;
}

.md-merge__src {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--md-space-2);
}

.md-merge__drop {
  border: 1px dashed var(--md-line-strong);
  border-radius: 8px;
  padding: var(--md-space-2) var(--md-space-3);
  min-height: 48px;
  max-height: 140px;
  overflow: auto;
  background: var(--md-bg-muted);
}

.md-merge__drop.is-empty {
  display: flex;
  align-items: center;
  justify-content: center;
}

.md-merge__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.md-merge__list li {
  display: flex;
  align-items: flex-start;
  gap: var(--md-space-2);
  font-size: 12.5px;
  color: var(--md-ink-2);
}

.md-merge__item {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-all;
  white-space: normal;
}

.md-merge__x {
  flex: none;
  border: none;
  background: transparent;
  color: var(--md-ink-3);
  cursor: pointer;
  display: inline-flex;
  padding: 2px;
  border-radius: 4px;
}
.md-merge__x:hover {
  background: var(--md-bg-muted);
  color: var(--md-ink-1);
}

.md-merge__srcbtns {
  display: flex;
  gap: var(--md-space-2);
}

.md-merge__modes {
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

.md-merge__target {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--md-space-2);
}

.md-merge__targetpath {
  font-size: 12.5px;
  color: var(--md-ink-2);
  flex-basis: 100%;
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-all;
  white-space: normal;
}

.md-merge__new {
  flex-basis: 100%;
  display: flex;
  align-items: center;
  gap: var(--md-space-2);
  margin-top: 4px;
}

.md-input {
  height: var(--md-ctrl-h, 32px);
  padding: 0 var(--md-space-2);
  border: 1px solid var(--md-line-strong);
  border-radius: 6px;
  font-size: 13.5px;
  background: var(--md-bg-card);
  color: var(--md-ink-1);
}

.md-merge__name {
  width: 160px;
}

.md-merge__row--opts {
  flex-direction: column;
  gap: var(--md-space-2);
}

/* 报告 */
.md-merge__report {
  border-top: 1px solid var(--md-line);
  padding-top: var(--md-space-3);
  max-height: 280px;
  overflow: auto;
}

.md-merge__summary {
  margin: 0 0 var(--md-space-2);
  font-size: 13.5px;
  color: var(--md-ink-1);
  line-height: 1.6;
}

.md-merge__entries {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.md-merge__entry {
  display: flex;
  align-items: center;
  gap: var(--md-space-2);
  font-size: 12px;
  color: var(--md-ink-2);
  padding: 2px 4px;
  border-radius: 4px;
}
.md-merge__entry.skip,
.md-merge__entry.error {
  background: var(--md-bad-bg-soft);
}

.md-merge__epath {
  max-width: 220px;
  overflow-wrap: anywhere;
  word-break: break-all;
  white-space: normal;
}
.md-merge__arrow {
  color: var(--md-ink-3);
}

.md-merge__badge {
  flex: none;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--md-bg-muted);
  color: var(--md-ink-2);
}
.md-merge__badge.skip,
.md-merge__badge.error {
  background: var(--md-bad-bg);
  color: var(--md-bad);
}

.md-merge__ereason {
  color: var(--md-bad);
  font-size: 11.5px;
}

.md-merge__reject {
  color: var(--md-bad);
  font-size: 13px;
  font-weight: 600;
  background: var(--md-bad-bg-soft);
  border-radius: 6px;
  padding: var(--md-space-2) var(--md-space-3);
}

.md-merge__done {
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
