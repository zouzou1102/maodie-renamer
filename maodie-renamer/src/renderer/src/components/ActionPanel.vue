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
import { useFilesStore } from '../stores/files'
import { useRuleStore } from '../stores/rule'
import { useTaskStore } from '../stores/task'

const files = useFilesStore()
const rule = useRuleStore()
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
 * ★ P3-5：导入已升级为**第五个模式**（五选一互斥）。所以这里**先切到「导入」模式
 *   再选表** —— 否则表格导进来了却不生效（设计 §1.5：选了别的模式，表格整个不生效），
 *   用户会以为「点了没反应」。
 * 选文件 / 解析 / 开弹窗 / 装名字的逻辑现在都在 `files` store 里，
 * 与「导入」页签里的入口**共用同一份**（设计 §2.2）。
 */
async function onImportClick(): Promise<void> {
  rule.setMode('import')
  await files.pickTable()
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
    <button class="md-btn md-btn--ghost md-actionpanel__wide" data-import-open @click="onImportClick">
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
