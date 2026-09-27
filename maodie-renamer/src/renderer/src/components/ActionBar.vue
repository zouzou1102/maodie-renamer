<script setup lang="ts">
/**
 * R-06 动作区（EL-060 / EL-061）—— 设计稿 C 的 H 格（开始改名）。
 *
 * EL-060 的状态矩阵（交互说明 §2.4 明确列出）：
 *   列表为空 → 置灰；有项但全部无变化 → 置灰；有可改项 → 可用；
 *   执行中 → 可用且文案变「取消」。
 *
 * ── C 方案施工单（2026-09-27）─────────────────────────────────────────
 * · 「撤销 / 历史」搬去了标题栏右组（EL-155 / 施工单 §二），本块只剩**唯一的主行动**。
 *   §4.2 铁律 ①：全窗口只有一个主按钮 —— 52px 高、占满它那一格的宽，摆在右下角。
 */
import { computed } from 'vue'
import { useFilesStore } from '../stores/files'
import { useTaskStore } from '../stores/task'

const files = useFilesStore()
const task = useTaskStore()

const primaryLabel = computed(() => (task.running ? '取消' : '开始改名'))
const primaryClass = computed(() => (task.running ? 'md-btn md-btn--danger' : 'md-btn md-btn--primary'))
const disabled = computed(() => (task.running ? false : !files.canExecute))

const hintTitle = computed(() => {
  if (task.running) return '点击可中止，已改动的项会自动改回去'
  if (files.items.length === 0) return '列表里还没有文件'
  if (!files.canExecute) return '当前规则不会改变任何名字'
  return `即将修改 ${files.executableCount} 项`
})
</script>

<template>
  <section class="md-actionbar">
    <button :class="primaryClass" :disabled="disabled" :title="hintTitle" @click="task.start()">
      {{ primaryLabel }}
    </button>
  </section>
</template>

<style scoped>
.md-actionbar {
  /* H 格：一块抬起的板子，主按钮占满格宽（施工单 §二 / 设计稿 .ph）*/
  height: 100%;
  min-height: 0;
  padding: 14px 16px;
  display: flex;
  align-items: stretch;
  background: var(--md-bg-card);
  border-radius: var(--md-radius-card);
  box-shadow: var(--md-shadow-card);
}

.md-actionbar .md-btn {
  width: 100%;
  /* §4.1 高度硬指标：主行动按钮 52px */
  height: 52px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.8px;
}
</style>
