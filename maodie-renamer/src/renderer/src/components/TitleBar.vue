<script setup lang="ts">
/**
 * R-01 标题栏（EL-001 ~ EL-004）。
 *
 * `frame: false` + 自绘三按钮，所以窗口控制走 window.maodie.window.*。
 * EL-004 关闭按钮**不做「确认退出」**（交互说明 §2.3）—— 改名已完成、
 * 列表不持久化，弹确认只会让人烦。
 *
 * ── C 方案施工单（2026-09-27）：46px 全宽，★ 两组胶囊 ───────────────────
 *
 *   [猫头 Maodie] [添加文件·添加文件夹·导入表格] ……
 *   …… [改名工作台 · N 项已就位] [导出清单·清空列表·文件夹合并·文件提取·撤销/历史] [设置] [— □ ✕]
 *
 * · 「往里加东西」（原 ActionPanel）整组搬进标题栏：addFiles / addFolder /
 *   importTable / exportList / clearList 的处理函数与 `data-*` 锚点**原样迁入**
 *   （锚点名不改，冒烟断言不红）；ActionPanel.vue 随之删除。
 * · 状态副题「改名工作台 · N 项已就位」：等宽 11px / --ink3；
 *   ⚠️ 窗口收到 1180 宽时这条要收起来（CSS 媒体查询），否则最小窗口挤不下。
 * · 「撤销 / 历史」从动作区搬来（施工单 §二）：它是**改完之后**的下一个动作，
 *   与窗口工具同属「打开历史页」这一件事；点击经 App 转发到历史视图。
 * · EL-106「设置」入口保留在窗口键左侧（用户 2026-09-27 拍板：设计稿没画，
 *   但设置弹窗承载主题切换 / 减少动画，不能没有入口）。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { catSvg, windowButtonSvg } from '../assets/cats'
import { ICONS } from '../assets/icons'
import ExportOptionsModal from './ExportOptionsModal.vue'
import { useFilesStore } from '../stores/files'
import { useRuleStore } from '../stores/rule'
import { useTaskStore } from '../stores/task'

const task = useTaskStore()
const files = useFilesStore()
const rule = useRuleStore()

const BTN_ICON = {
  minimize: windowButtonSvg('minimize'),
  maximize: windowButtonSvg('maximize'),
  restore: windowButtonSvg('restore'),
  close: windowButtonSvg('close'),
} as const

/** 品牌猫头标（设计稿 §04：24×24，与品牌字间距 9px）。
 *  ★ 直接复用 `resources/cats` 的 ST-01 形象（本批已换成设计稿同款「头+胡须」）——
 *    色值留在 SVG 资源里（猫不参与换色），组件里零硬编码色值（TC-32）。 */
const BRAND_MARK = catSvg('ST-01')

const maximized = ref(false)
let off: (() => void) | null = null

onMounted(async () => {
  const state = await window.maodie.window.getState()
  maximized.value = state.maximized
  off = window.maodie.window.onMaximizeChanged((p) => {
    maximized.value = p.maximized
  })
})

onUnmounted(() => off?.())

async function toggle(): Promise<void> {
  maximized.value = await window.maodie.window.toggleMaximize()
}

// 模板里访问不到全局 window，必须包成方法（Vue 模板的作用域是组件实例）
function minimize(): void {
  window.maodie.window.minimize()
}

function close(): void {
  window.maodie.window.close()
}

/* ── 「往里加东西」从 ActionPanel 原样迁入（锚点与函数名不改）────────── */

const emit = defineEmits<{ (e: 'open-history'): void }>()

/** EL-127 导出选项气泡的开合（P3-2）。TitleBar 常驻挂载，关闭即复位。 */
const exportOpen = ref(false)

async function pickFiles(): Promise<void> {
  const res = await window.maodie.fs.pickFiles()
  if (res.ok && !res.data.canceled) await files.addPaths(res.data.paths)
}

async function pickDirectory(): Promise<void> {
  // DEC-01：多选也只是「一次加 N 个文件夹本身」，每个都不递归内部文件
  const res = await window.maodie.fs.pickDirectory()
  if (res.ok && !res.data.canceled) await files.addPaths(res.data.paths)
}

/**
 * EL-132 导入表格（P3-4）。
 *
 * ★ P3-5：导入已升级为**第五个模式**（五选一互斥）。所以这里**先切到「导入」模式
 *   再选表** —— 否则表格导进来了却不生效（设计 §1.5）。
 */
async function onImportClick(): Promise<void> {
  rule.setMode('import')
  await files.pickTable()
}
</script>

<template>
  <header class="md-titlebar">
    <!-- 品牌：猫头标 + Maodie（施工单 §二：间距 9px，13.5px/600/字距2px/全大写）-->
    <div class="md-titlebar__brand">
      <span class="md-titlebar__mark" aria-hidden="true" v-html="BRAND_MARK" />
      <span class="md-titlebar__name">Maodie</span>
    </div>

    <!-- 左组胶囊 ×3：「往里加东西」（施工单：高30/圆角99/内边距0 13px/11.5px）-->
    <div class="md-titlebar__left">
      <button class="md-tbtn" data-add-files @click="pickFiles">添加文件</button>
      <button class="md-tbtn" data-add-folder @click="pickDirectory">添加文件夹</button>
      <button class="md-tbtn" data-import-open @click="onImportClick">导入表格</button>
    </div>

    <div class="md-titlebar__right">
      <!-- 状态副题：窗口收到 1180 宽时收起来（见样式里的媒体查询）-->
      <span class="md-titlebar__sub">改名工作台 · {{ files.total }} 项已就位</span>

      <!-- 右组胶囊 ×5：产出（导出）→ 销毁（清空）→ 窗口级工具（合并/提取）→ 历史 -->
      <div class="md-titlebar__tools">
        <button
          class="md-tbtn"
          data-export-open
          :disabled="files.items.length === 0"
          @click="exportOpen = true"
        >
          导出清单
        </button>
        <button
          class="md-tbtn"
          data-clear-open
          :disabled="files.items.length === 0"
          @click="task.askClear()"
        >
          清空列表
        </button>
        <button class="md-tbtn" data-merge-open @click="task.openMerge()">文件夹合并</button>
        <button
          class="md-tbtn"
          data-extract-open
          :disabled="files.items.length === 0"
          :title="files.items.length === 0 ? '列表里还没有文件' : '从当前列表里挑一批搬到别处'"
          @click="task.openExtract()"
        >
          文件提取
        </button>
        <button class="md-tbtn" data-history-open @click="emit('open-history')">撤销 / 历史</button>
      </div>

      <div class="md-titlebar__btns">
        <!-- EL-106 设置入口：设计稿没画，但设置弹窗（主题切换/减少动画）必须有入口
             —— 用户 2026-09-27 拍板保留在窗口键左侧。 -->
        <button class="md-winbtn md-winbtn--settings" title="设置" aria-label="设置" @click="task.openSettings()">
          <span class="md-icon md-icon--14" aria-hidden="true" v-html="ICONS.settings" />
        </button>
        <button class="md-winbtn" title="最小化" aria-label="最小化" @click="minimize">
          <span class="md-icon md-icon--16" aria-hidden="true" v-html="BTN_ICON.minimize" />
        </button>
        <button
          class="md-winbtn"
          :title="maximized ? '向下还原' : '最大化'"
          :aria-label="maximized ? '向下还原' : '最大化'"
          @click="toggle"
        >
          <span
            class="md-icon md-icon--16"
            aria-hidden="true"
            v-html="maximized ? BTN_ICON.restore : BTN_ICON.maximize"
          />
        </button>
        <button
          class="md-winbtn md-winbtn--close"
          title="关闭"
          aria-label="关闭"
          @click="close"
        >
          <span class="md-icon md-icon--16" aria-hidden="true" v-html="BTN_ICON.close" />
        </button>
      </div>
    </div>

    <!-- EL-127 导出选项气泡。AppModal 内部会 Teleport 到 body，挂在这里只是「就近」。 -->
    <ExportOptionsModal :open="exportOpen" @close="exportOpen = false" />
  </header>
</template>

<style scoped>
.md-titlebar {
  justify-content: flex-start;
}

/* 品牌：猫头 24×24 + Maodie（间距 9px）*/
.md-titlebar__brand {
  display: flex;
  align-items: center;
  gap: 9px;
  flex: 0 0 auto;
}

.md-titlebar__mark {
  width: 24px;
  height: 24px;
  display: block;
}

.md-titlebar__mark :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}

.md-titlebar__name {
  font-family: var(--md-font-num);
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--md-ink-1);
}

/* 左组胶囊：紧接品牌字，左边距 14px、gap 6px（施工单 §二）*/
.md-titlebar__left {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 14px;
  -webkit-app-region: no-drag;
}

.md-titlebar__right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  -webkit-app-region: no-drag;
}

/* 状态副题：等宽 11px / --ink3；窗口收到 1180 宽时收起（施工单 ⚠️）*/
.md-titlebar__sub {
  margin-right: 10px;
  font-family: var(--md-font-num);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--md-ink-3);
  white-space: nowrap;
}

@media (max-width: 1180px) {
  .md-titlebar__sub {
    display: none;
  }
}

.md-titlebar__tools {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 标题栏胶囊：高 30 / 圆角 99 / 内边距 0 13px / 11.5px（左右两组同款）。
   刻意不用 `.md-btn` —— 那是「内容区里干活」的按钮，
   标题栏上需要更轻的一档，否则会和主行动抢注意力。 */
.md-tbtn {
  height: 30px;
  padding: 0 13px;
  border: 1px solid var(--md-line);
  border-radius: 99px;
  background: var(--md-bg-warm);
  font-family: inherit;
  font-size: 11.5px;
  color: var(--md-ink-3);
  cursor: pointer;
  white-space: nowrap;
  transition:
    border-color var(--md-dur-hover) ease,
    color var(--md-dur-hover) ease;
}

.md-tbtn:hover:not(:disabled) {
  border-color: var(--md-line-strong);
  color: var(--md-ink-1);
}

.md-tbtn:active:not(:disabled) {
  background: var(--md-bg-sunken);
}

.md-tbtn:disabled {
  color: var(--md-ink-4);
  cursor: not-allowed;
}

.md-titlebar__btns {
  display: flex;
  gap: 6px;
}

/* 窗口键：32×30 / 无边框 / 12px（施工单 §二；✕ 悬停红底白字在 base.css）*/
.md-winbtn {
  width: 32px;
}
</style>
