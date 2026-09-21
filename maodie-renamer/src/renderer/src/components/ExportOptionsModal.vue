<script setup lang="ts">
/**
 * EL-127 导出选项气泡（P3-2 / 第 2 批 · 设计 §2.2）。
 *
 * 三行：格式 / 范围 / 列。**零新增 SCR、零新增样式令牌、零新增色值** ——
 * 格式与范围复用既有 `.md-select`，列复用既有 `.md-check`，
 * 外壳复用 `AppModal`（宽 480，与设置弹窗同宽）。
 *
 * ── ★ 本组件最要紧的一处：`previewPending` 门控（设计 §7.5 第 4 行）──
 * 预览有 **200ms 防抖 + Worker 往返**。若在「算的过程中」导出，拿到的
 * `newName` 是**上一轮的旧值** —— 用户看着屏幕上的新名、清单里却是别的名字，
 * **而界面完全正常**。这与 P2-A 的 `theme` 坑是同一类症状（值不对、界面无异常），
 * 只能靠门控 + 断言抓。所以「导出…」按钮在 `previewPending` 期间**必须置灰**。
 *
 * ── 为什么「取消」之后直接关掉气泡 ───────────────────────────────────
 * 「另存为」里点取消不是失败（设计 §4 第 3 行）：**静默返回，不报错、不提示**。
 * 同时把气泡关掉 —— 让用户看到「这次操作结束了」，而不是一个还杵在屏幕上的框，
 * 让他以为「刚才是不是没点上」。
 */
import { computed, ref, watch } from 'vue'
import AppModal from './AppModal.vue'
import MdIcon from './MdIcon.vue'
import { errorText } from '@shared/errors'
import {
  EXPORT_COLUMN_LABEL,
  EXPORT_COLUMN_ORDER,
  buildExportTable,
  suggestExportName,
  type ExportColumn,
} from '@shared/export-rows'
import { EXPORT_FORMAT_OPTIONS } from '@shared/labels'
import type { ExportFormat } from '@shared/types'
import { useFilesStore } from '../stores/files'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const files = useFilesStore()

/* ── 三个选项 ───────────────────────────────────────────────────────── */

/** 默认 Excel（设计 §3.3 / 拍板第 4 条）*/
const format = ref<ExportFormat>('xlsx')
const scope = ref<'all' | 'selected'>('all')
/** 默认勾「原名 / 新名 / 状态」，**不勾「所在文件夹」**（设计 §5.④ 隐私理由）*/
const columns = ref<Set<ExportColumn>>(new Set<ExportColumn>(['name', 'newName', 'status']))
const exporting = ref(false)

/**
 * ★ 每次打开都回到默认选项 —— **不记上次用的格式与路径**（设计 §5.③）。
 *
 * 两个理由：① 导出是低频动作，为省一次下拉选择去动持久化层性价比是负的；
 * ② P2-A 的教训 —— 动 `prefs` 的 schema 要付出「值不变、界面却无异常」的代价。
 *
 * 顺带这也是「临时 UI 状态显式归位」的落实：本组件若被复用，上一次的
 * 选择绝不该渗到下一次。
 */
watch(
  () => props.open,
  (now) => {
    if (!now) return
    format.value = 'xlsx'
    scope.value = 'all'
    columns.value = new Set<ExportColumn>(['name', 'newName', 'status'])
    exporting.value = false
  },
)

const hasSelection = computed(() => files.selectedIds.size > 0)

/**
 * 「导出…」能不能点（设计 §2.4 三处置灰）。
 *
 * ⚠️ 「列表为空」不在这里判 —— 那种情况下入口按钮已经置灰，气泡根本打不开。
 *    真正需要在这里挡的是下面两条。
 */
const canExport = computed(
  () =>
    !exporting.value &&
    // ① ★ 最要紧的一条：预览正在算 → 导出的会是上一轮的旧新名（见文件头注释）
    !files.previewPending &&
    // ② 选了「仅选中项」却一项都没勾 → 不导出一份空表
    !(scope.value === 'selected' && files.selectedIds.size === 0),
)

/**
 * 按钮为什么是灰的。
 *
 * ★ 刻意不用 `title` 工具提示：非技术用户不会去悬停找原因，
 *   而「按钮灰着、没有任何解释」正是最容易被当成「软件坏了」的情形。
 */
const blockReason = computed(() => {
  if (files.previewPending) return '正在重新计算，稍等一下'
  if (scope.value === 'selected' && files.selectedIds.size === 0) return '还没有勾选任何文件'
  return ''
})

function toggleColumn(c: ExportColumn): void {
  const next = new Set(columns.value)
  if (next.has(c)) next.delete(c)
  else next.add(c)
  columns.value = next
}

/* ── 导出 ───────────────────────────────────────────────────────────── */

async function doExport(): Promise<void> {
  if (!canExport.value) return
  exporting.value = true
  try {
    // 组装在 `shared/export-rows.ts` 里做 —— 纯函数、可单测（TC-52 就靠它）
    const table = buildExportTable([...files.items], files.selectedIds, {
      scope: scope.value,
      columns: [...columns.value],
    })

    const res = await window.maodie.fs.exportList({
      format: format.value,
      header: table.header,
      rows: table.rows,
      // 只给文件名，落点由用户在「另存为」里亲手选（设计 §1.3 第 1 条）
      suggestedName: suggestExportName(format.value),
    })

    if (!res.ok) {
      // 错误文案走 `errors.ts` 的唯一来源，不在这里硬编码（接口文档 §6.2）
      files.showTransient(errorText(res.code))
      emit('close')
      return
    }

    // 用户点了取消：静默 —— 取消不是失败
    if (res.data.canceled) {
      emit('close')
      return
    }

    const name = res.data.filePath.split(/[\\/]/).pop() ?? ''
    // 完成反馈只走状态栏 3 秒轻提示，**不弹成功弹窗**（设计 §2.3）：
    // 导出是轻动作且可重做，为它弹一个要点关闭的窗是打断。
    files.showTransient(`已导出 ${table.rows.length} 项到 ${name}`)
    emit('close')
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <AppModal v-if="props.open" title="导出清单" :width="480" @close="emit('close')">
    <div class="md-export">
      <label class="md-export__row">
        <span class="md-export__label">格式</span>
        <select
          class="md-select md-export__select"
          data-export-format
          :value="format"
          @change="format = ($event.target as HTMLSelectElement).value as ExportFormat"
        >
          <option v-for="o in EXPORT_FORMAT_OPTIONS" :key="o.value" :value="o.value">
            {{ o.label }}
          </option>
        </select>
      </label>

      <!-- 范围用**下拉**而不是两个方框（设计 §2.2）：互斥的选择长成两个能同时
           勾上的方框，用户会以为可以都选；为它专门造一个圆点单选控件又是多一处
           要维护的样式。用既有 `.md-select` 最省，而且与「格式」那一行对齐。 -->
      <label class="md-export__row">
        <span class="md-export__label">范围</span>
        <select
          class="md-select md-export__select"
          data-export-scope
          :value="scope"
          @change="scope = ($event.target as HTMLSelectElement).value as 'all' | 'selected'"
        >
          <option value="all">全部</option>
          <option value="selected" :disabled="!hasSelection">仅选中项</option>
        </select>
      </label>

      <div class="md-export__row">
        <span class="md-export__label">列</span>
        <div class="md-export__cols">
          <!-- 「序号」不在这里 —— 它恒有、不可取消（设计 §3.1）-->
          <label v-for="c in EXPORT_COLUMN_ORDER" :key="c" class="md-check">
            <input
              type="checkbox"
              :data-export-col="c"
              :checked="columns.has(c)"
              @change="toggleColumn(c)"
            />
            <span class="md-check__box"><MdIcon name="check" :size="11" /></span>
            <span class="md-check__label">{{ EXPORT_COLUMN_LABEL[c] }}</span>
          </label>
        </div>
      </div>

      <p class="md-hint">清单里写的是当前规则算出来的新名，跟你屏幕上看到的是同一份。</p>
    </div>

    <template #foot>
      <span v-if="blockReason" class="md-hint" data-export-block>{{ blockReason }}</span>
      <button class="md-btn md-btn--secondary" @click="emit('close')">取消</button>
      <button
        class="md-btn md-btn--primary"
        data-export-confirm
        :disabled="!canExport"
        @click="doExport"
      >
        导出…
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.md-export {
  display: flex;
  flex-direction: column;
  /* 行间距 16px（设计 §7.6）*/
  gap: var(--md-space-4);
}

.md-export__row {
  display: flex;
  align-items: center;
  gap: var(--md-space-3);
  min-height: var(--md-ctrl-h);
}

.md-export__label {
  flex: none;
  font-size: 14px;
  font-weight: 600;
  color: var(--md-ink-1);
}

/* 格式下拉宽 200px（设计 §7.6）；范围下拉与它等宽，两行右边缘对齐 */
.md-export__select {
  width: 200px;
}

.md-export__cols {
  display: flex;
  flex-wrap: wrap;
  gap: var(--md-space-3);
}

/* `<p>` 的浏览器默认外边距在这套纵向节奏里会多出一截 */
.md-hint {
  margin: 0;
}
</style>
