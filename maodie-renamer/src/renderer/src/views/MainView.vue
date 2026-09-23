<script setup lang="ts">
/**
 * SCR-01 主窗口（PRD §5.2 的横版宽屏左右分栏）。
 *
 * 布局纪律：
 *  · 左栏固定 300px（窗口 < 960px 收窄到 260px），右栏自适应
 *  · 右栏 = 滚动区（列表 + 规则，整体滚动）+ 常驻动作条（永远贴在窗口底部）
 *  · 列表与规则各按自己的高度完整展开，谁也不压缩谁
 *  · 窗口宽高变化只影响右栏，左栏不变
 */
import { computed, onMounted, ref } from 'vue'
import ActionBar from '../components/ActionBar.vue'
import ActionPanel from '../components/ActionPanel.vue'
import CatStage from '../components/CatStage.vue'
import FileList from '../components/FileList.vue'
import ImportTableModal from '../components/ImportTableModal.vue'
import RulePanel from '../components/RulePanel.vue'
import { useDragDrop } from '../composables/useDragDrop'
import { useFilesStore } from '../stores/files'

const emit = defineEmits<{ (e: 'open-history'): void }>()

const files = useFilesStore()
const root = ref<HTMLElement | null>(null)
const narrow = ref(false)

const { visible, rejected, onDragEnter, onDragOver, onDragLeave, onDrop } = useDragDrop({
  onPaths: (paths) => {
    if (paths.length === 0) {
      // EX-08：拖入网页链接 / 纯文本 → 状态栏提示，不入列
      files.showTransient('只能拖入文件或文件夹哦')
      return
    }
    void files.addPaths(paths)
  },
})

/**
 * 拖拽监听挂在**整个窗口**上（EL-010 全窗口可落），
 * 但蒙层只覆盖右栏与形象区 —— 这样「往里拖」的视觉反馈更聚焦。
 */
const leftWidth = computed(() => (narrow.value ? '260px' : '300px'))

onMounted(() => {
  const update = (): void => {
    narrow.value = window.innerWidth < 960
  }
  update()
  window.addEventListener('resize', update)
})
</script>

<template>
  <div
    ref="root"
    class="md-main"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- 左栏：R-02 形象区 + R-03 操作区 -->
    <aside class="md-main__left" :style="{ width: leftWidth }">
      <CatStage />
      <ActionPanel />
    </aside>

    <!-- 右栏：R-04 列表 + R-05 规则（两者一起滚）+ R-06 动作（常驻底部）-->
    <section class="md-main__right">
      <div class="md-main__right-body md-scroll">
        <FileList />
        <RulePanel />
      </div>
      <ActionBar @open-history="emit('open-history')" />
    </section>

    <!-- EL-012 拖拽蒙层（拖拽时显示，非文件对象时显示拒绝态）-->
    <div v-if="visible" class="md-dropzone" :class="{ 'md-dropzone--reject': rejected }">
      <template v-if="rejected">只能拖入文件或文件夹哦</template>
      <template v-else>松手就行，交给耄耋～</template>
    </div>

    <!-- EL-133 导入预览弹窗（★ P3-5：从 ActionPanel 提到这里 —— 左栏按钮与「导入」
         页签的入口共用同一个动作，只该有一个弹窗实例）。AppModal 内部 Teleport 到
         body，挂在这里只是「就近」。 -->
    <ImportTableModal
      :open="files.importOpen"
      :file-name="files.importName"
      :table="files.importTable"
      @close="files.closeImport()"
    />
  </div>
</template>

<style scoped>
.md-main {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  gap: var(--md-space-3);
  padding: var(--md-space-3);
}

.md-main__left {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--md-space-3);
  background: var(--md-bg-warm);
  border-radius: var(--md-radius-card);
  padding: 14px;
  overflow-y: auto;
}

.md-main__right {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--md-space-3);
  /* 右栏只负责「滚动区 + 常驻动作条」两行；滚动全部发生在下面那个 body 里 */
  overflow: hidden;
}

/* ★ 滚动区：列表 + 规则**作为一个整体**滚动。
   链接上一版的问题：规则区曾经自己内部滚（嵌套滚动条），列表被压到只剩最小高度。
   现在改成 —— 两块都按自己的高度完整展开，超出窗口就整块滚；
   动作条在这个滚动区外面，所以永远贴在窗口底部。 */
.md-main__right-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--md-space-3);
}
</style>
