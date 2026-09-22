<script setup lang="ts">
/**
 * R-03 操作区（EL-020 / EL-021 / EL-022）。
 *
 * IX-020：打开系统文件多选框 → 选中后**攒起来统一调一次** resolvePaths。
 * 为什么不在拿到路径后逐个入列：resolvePaths 会做去重、去除非文件对象、
 * 取目录快照，这些**都是批量操作**；逐个调用会对同一个目录重复 readdir。
 */
import { ref } from 'vue'
import MdIcon from './MdIcon.vue'
import ExportOptionsModal from './ExportOptionsModal.vue'
import ImportTableModal from './ImportTableModal.vue'
import { errorText } from '@shared/errors'
import type { ImportedTable } from '@shared/types'
import { useFilesStore } from '../stores/files'
import { useTaskStore } from '../stores/task'

const files = useFilesStore()
const task = useTaskStore()
const busy = ref(false)

/**
 * EL-127 导出选项气泡的开合（P3-2）。
 *
 * ★ 用**组件本地状态**而不是 `task.modal`：这个气泡只被左栏那一个按钮打开、
 *   只用一次，没有跨组件协调的需求；塞进全局模态状态机只会给 `task.ts`
 *   增加一个永远只有一处用到的分支。
 *
 * 为什么不需要 P2-C 那样的「关窗复位」watch：`ActionPanel` 由 `MainView` 的
 * `v-if="view === 'main'"` 控制，切到历史页会整体卸载，`exportOpen` 随之销毁 ——
 * 不存在跨视图的状态泄漏（`cliOpen` 是因为设置弹窗**常驻挂载**才必须手动复位）。
 */
const exportOpen = ref(false)

/** EL-133 导入预览弹窗的开合，以及它要展示的那张表（P3-4）*/
const importOpen = ref(false)
const importName = ref('')
const importTable = ref<ImportedTable | null>(null)

async function pickFiles(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    const res = await window.maodie.fs.pickFiles()
    if (res.ok && !res.data.canceled) await files.addPaths(res.data.paths)
  } finally {
    busy.value = false
  }
}

async function pickDirectory(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    const res = await window.maodie.fs.pickDirectory()
    // DEC-01：多选也只是「一次加 N 个文件夹本身」，每个都不递归内部文件
    if (res.ok && !res.data.canceled) await files.addPaths(res.data.paths)
  } finally {
    busy.value = false
  }
}

/**
 * EL-132 导入表格（P3-4）。
 *
 * ★ 顺序是「先选文件、解析成功**再**开弹窗」—— 反过来的话，用户要先面对一个
 *   空白弹窗、再去点「选择文件」，点取消时还得自己关掉那个空壳。
 *
 * 取消（`canceled`）不是失败：静默返回，不提示（与「另存为」同一条纪律）。
 * 读表失败（加密 / 损坏 / 太大）走 `E_TABLE_UNREADABLE`，文案只在 `errors.ts` 一处。
 */
async function pickTable(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    const res = await window.maodie.fs.importTable()
    if (!res.ok) {
      files.showTransient(errorText(res.code))
      return
    }
    if (res.data.canceled || res.data.table === null) return
    importName.value = res.data.fileName
    importTable.value = res.data.table
    importOpen.value = true
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="md-actionpanel">
    <button class="md-btn md-btn--secondary md-actionpanel__wide" @click="pickFiles">
      <MdIcon name="file" :size="15" />
      添加文件
    </button>
    <button class="md-btn md-btn--secondary md-actionpanel__wide" @click="pickDirectory">
      <MdIcon name="folder" :size="15" />
      添加文件夹
    </button>
    <!-- EL-132 导入表格（P3-4）。
         放在「添加文件夹」下面：它和上面两个同属「**往里加东西**」那一类；
         「导出清单」是产出、「清空列表」是销毁，都在它下面（设计 §2.1）。
         ★ 与导出不同：**列表为空时也让它可点** —— 空列表导入会全部落进
         「对不上」，那是**有信息量**的反馈，比一个点不动的灰按钮好（设计 §4 第 1 行）。 -->
    <button class="md-btn md-btn--ghost md-actionpanel__wide" data-import-open @click="pickTable">
      导入表格
    </button>

    <!-- EL-126 导出清单（P3-2）。
         放在「清空列表」**上面**：两个都是幽灵级操作，但导出是「产出」、
         清空是「销毁」—— 产出放前面，从上往下越来越「轻」（设计 §2.1）。
         为什么不放底部动作区：那里主按钮是「开始改名」，是全程序唯一会改文件的
         动作；把不改任何文件的导出塞进去，会糊掉「主按钮 = 危险动作」这条约定。 -->
    <button
      class="md-btn md-btn--ghost md-actionpanel__wide"
      data-export-open
      :disabled="files.items.length === 0"
      @click="exportOpen = true"
    >
      导出清单
    </button>

    <button
      class="md-btn md-btn--ghost md-actionpanel__wide"
      :disabled="files.items.length === 0"
      @click="task.askClear()"
    >
      清空列表
    </button>

    <p class="md-actionpanel__tip">拖到窗口里也行哦～</p>

    <!-- EL-127 导出选项气泡。AppModal 内部会 Teleport 到 body，
         所以挂在这里只是「就近」，对呈现位置没有影响。 -->
    <ExportOptionsModal :open="exportOpen" @close="exportOpen = false" />

    <!-- EL-133 导入预览弹窗。同上：AppModal 内部 Teleport 到 body，这里只是就近。 -->
    <ImportTableModal
      :open="importOpen"
      :file-name="importName"
      :table="importTable"
      @close="importOpen = false"
    />
  </section>
</template>

<style scoped>
.md-actionpanel {
  display: flex;
  flex-direction: column;
  gap: var(--md-space-2);
}

.md-actionpanel__wide {
  width: 100%;
}

.md-actionpanel__tip {
  margin: var(--md-space-1) 0 0;
  font-size: 11.5px;
  line-height: 16px;
  color: var(--md-ink-3);
  text-align: center;
}
</style>
