<script setup lang="ts">
/**
 * 外壳：标题栏 R-01 + 视图切换（main / history）+ 状态栏 R-07 + 五个弹窗。
 *
 * 弹窗用 AppModal 里的 Teleport 挂到 body，所以它们与 view 无关
 * （切到历史页时弹窗依然能正确覆盖整个窗口）。
 *
 * 两件启动期的事在这里做：
 *  · 先注册 `md:app:storageWarning` 监听**再**做其它初始化 —— 数据文件损坏
 *    可能发生在启动早期，晚注册就漏掉了（接口文档 §3.1 明确提醒过这一点）
 *  · 加载偏好与应用 reduceMotion（无障碍开关）
 */
import { onMounted, onUnmounted, ref } from 'vue'
import TitleBar from './components/TitleBar.vue'
import StatusBar from './components/StatusBar.vue'
import ConfirmModal from './components/ConfirmModal.vue'
import ConflictModal from './components/ConflictModal.vue'
import ResultModal from './components/ResultModal.vue'
import SettingsModal from './components/SettingsModal.vue'
import CliGuideModal from './components/CliGuideModal.vue'
import MainView from './views/MainView.vue'
import HistoryView from './views/HistoryView.vue'
import { useKeyboard } from './composables/useKeyboard'
import { useFilesStore } from './stores/files'
import { useHistoryStore } from './stores/history'
import { usePrefsStore } from './stores/prefs'
import { useTaskStore } from './stores/task'

const view = ref<'main' | 'history'>('main')
const files = useFilesStore()
const history = useHistoryStore()
const prefs = usePrefsStore()
const task = useTaskStore()

let offStorageWarning: (() => void) | null = null

onMounted(async () => {
  // ★ 最先注册：启动早期的损坏告警不能漏
  offStorageWarning = window.maodie.app.onStorageWarning((w) => {
    task.setStatusOverride(w.message, 6000)
  })

  await prefs.load()
  await history.load()
})

onUnmounted(() => {
  offStorageWarning?.()
  files.dispose()
})

async function openHistory(): Promise<void> {
  await history.load()
  view.value = 'history'
}

useKeyboard({
  onAddFiles: () => {
    void (async () => {
      const res = await window.maodie.fs.pickFiles()
      if (res.ok && !res.data.canceled) await files.addPaths(res.data.paths)
    })()
  },
  onOpenHistory: () => void openHistory(),
  onDeleteSelected: () => {
    // Delete 键移除当前选中的行（按 id，不按 DOM 索引）
    for (const id of [...files.selectedIds]) files.removeItem(id)
  },
  onEscape: () => {
    if (task.modal !== 'none') {
      task.closeModal()
      return
    }
    if (view.value === 'history') view.value = 'main'
  },
  onEnterPrimary: () => void task.start(),
})
</script>

<template>
  <div class="md-window">
    <TitleBar />

    <MainView v-if="view === 'main'" @open-history="openHistory" />
    <HistoryView v-else @back="view = 'main'" />

    <StatusBar />

    <!-- 五个弹窗与 view 无关（Teleport 到 body，遮罩覆盖整个窗口）-->
    <ResultModal />
    <ConflictModal />
    <ConfirmModal />
    <SettingsModal />
    <CliGuideModal />
  </div>
</template>
