<script setup lang="ts">
/**
 * R-04 文件列表区（EL-030 ~ EL-037）。
 *
 * 三件事必须做对：
 *  1. **虚拟滚动**（> 500 行启用，ADR-005 自实现）。行高固定 46px（★ 施工单 2026-09-27）。
 *  2. **全选 / 行内删除基于 id，不基于 DOM 索引** —— 虚拟滚动会让「第 3 行」
 *     在滚动后变成别的文件，这是虚拟滚动最常见的陷阱。
 *  3. **预览刷新后立即重绘、无过渡动画**（设计规范 §7），避免列表闪动。
 *
 * ── C 方案施工单 §六：三段式 ──────────────────────────────────────────
 * 头部固定 42px（「文件」+ 计数 + 右端两枚小胶囊）→ 行区内部滚 → 表底摘要条 54px。
 * 列头行 30px（勾选 34 / 序号 42 / 原名 1fr / 新名 1fr / 状态 72）。
 * 「只看将变化」是**组件本地 UI 状态**：只过滤显示，不影响选择与执行
 * （执行看的是每项自己的勾选与状态，与过滤器无关）。
 */
import { computed, ref } from 'vue'
import EmptyState from './EmptyState.vue'
import FileRow from './FileRow.vue'
import { useFilesStore } from '../stores/files'
import { useVirtualList } from '../composables/useVirtualList'

const files = useFilesStore()

/** 只看将变化（将改 + 撞名）。纯显示过滤器 —— 不动 store */
const showChangedOnly = ref(false)

const displayItems = computed(() => {
  if (!showChangedOnly.value) return files.items
  return files.items.filter((i) => i.status === 'changed' || i.status === 'conflict')
})

const scroller = ref<HTMLElement | null>(null)
const count = computed(() => displayItems.value.length)
const { enabled, totalHeight, startIndex, endIndex, offsetY, onScroll } = useVirtualList(scroller, count)

/** 非虚拟化时渲染全部；虚拟化时只渲染可视区（上下各 5 行缓冲）*/
const visibleRows = computed(() => {
  const list = displayItems.value
  if (!enabled.value) return list.map((item, i) => ({ item, index: i }))
  const out: Array<{ item: (typeof list)[number]; index: number }> = []
  for (let i = startIndex.value; i < endIndex.value; i++) {
    if (list[i]) out.push({ item: list[i], index: i })
  }
  return out
})

/** 表底摘要条：分段比例（将改+撞名 vs 其余）*/
const willChangeCount = computed(() => files.stats.changed + files.stats.conflict)
const restCount = computed(() => Math.max(0, files.total - willChangeCount.value))
</script>

<template>
  <section class="md-filelist">
    <!-- ① 头部固定 42px：标题 + 计数 + 右端两枚小胶囊 -->
    <header class="md-filelist__head">
      <b class="md-filelist__title">文件</b>
      <span class="md-filelist__count">{{ files.total }} 项</span>
      <span v-if="files.previewPending" class="md-filelist__busy">计算中…</span>
      <span v-else-if="files.lastElapsedMs > 0" class="md-filelist__elapsed">
        预览 {{ files.lastElapsedMs }}ms
      </span>
      <div class="md-filelist__pills">
        <button
          type="button"
          class="md-filelist__pill"
          :class="{ 'md-filelist__pill--on': showChangedOnly }"
          :aria-pressed="showChangedOnly"
          data-only-changed
          @click="showChangedOnly = !showChangedOnly"
        >
          只看将变化
        </button>
        <button
          type="button"
          class="md-filelist__pill"
          :disabled="files.items.length === 0"
          data-select-all
          @click="files.toggleSelectAll()"
        >
          {{ files.allSelected ? '取消全选' : '全选' }}
        </button>
      </div>
    </header>

    <!-- 列头行 30px：勾选 34 / 序号 42 / 原名 1fr / 新名 1fr / 状态 72（+26 删除钮）-->
    <div class="md-filelist__cols" aria-hidden="true">
      <span></span>
      <span>No.</span>
      <span>原本的名字</span>
      <span>改完的名字</span>
      <span>状态</span>
      <span></span>
    </div>

    <!-- ② 行区内部滚（虚拟滚动必需）-->
    <div ref="scroller" class="md-filelist__body md-scroll" @scroll="onScroll">
      <EmptyState v-if="files.items.length === 0" />

      <p v-else-if="displayItems.length === 0" class="md-filelist__none">
        没有将变化的文件 —— 关掉「只看将变化」看看全部
      </p>

      <div v-else :style="enabled ? { height: `${totalHeight}px`, position: 'relative' } : undefined">
        <div :style="enabled ? { transform: `translateY(${offsetY}px)` } : undefined">
          <FileRow
            v-for="row in visibleRows"
            :key="row.item.id"
            :item="row.item"
            :index="row.index"
            :selected="files.selectedIds.has(row.item.id)"
            @toggle="files.toggleSelect"
            @remove="files.removeItem"
          />
        </div>
      </div>
    </div>

    <!-- ③ 表底摘要条 54px：标签 + 分段条 + 三个图例 -->
    <footer class="md-filelist__foot">
      <span class="md-filelist__sumlbl">改动摘要</span>
      <div class="md-filelist__stack" aria-hidden="true">
        <i v-if="willChangeCount > 0" class="md-filelist__seg md-filelist__seg--on" :style="{ flex: willChangeCount }" />
        <i v-if="restCount > 0" class="md-filelist__seg" :style="{ flex: restCount }" />
        <i v-if="files.total === 0" class="md-filelist__seg" style="flex: 1" />
      </div>
      <span class="md-filelist__lg"><b>{{ willChangeCount }}</b> 将改</span>
      <span class="md-filelist__lg"><b>{{ files.stats.unchanged }}</b> 无变化</span>
      <span class="md-filelist__lg"><b>{{ files.stats.conflict }}</b> 撞名</span>
    </footer>
  </section>
</template>

<style scoped>
.md-filelist {
  display: flex;
  flex-direction: column;
  /* ★ 2026-09-27：高度**交给网格格位**（list 跨行 3-5），只保底 180px。
     原来写的是 `height: clamp(180px,38vh,320px)` + `flex: 0 1 auto` —— 那是
     「窗口不固定、由内容撑高」时代的档位，搬进「窗口固定 900 + 网格分行」之后
     它就成了多余的硬高度，实测两头都出错：
       · 1440 下比自己的格位矮 56px → 表格下方留一条空带（违背「富余时吸收空档」）；
       · 1180×760 下比格位高 83px → 戳出格子、把主区顶超 69px（「开始改名」被挤下去）。
     格位本身已经是高度预算：行 3/4 是 minmax(0,1fr)、行 5 是 auto。 */
  min-height: 180px;
  background: var(--md-bg-card);
  border-radius: var(--md-radius-card);
  box-shadow: var(--md-shadow-card);
  overflow: hidden;
}

/* ── ① 头部 42px ─────────────────────────────────────────────────── */
.md-filelist__head {
  height: var(--md-list-head-h);
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 var(--md-space-5);
  border-bottom: 1px solid var(--md-line);
}

.md-filelist__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--md-ink-1);
}

.md-filelist__count {
  font-size: 11px;
  color: var(--md-ink-3);
  font-family: var(--md-font-num);
  font-variant-numeric: tabular-nums;
}

.md-filelist__busy {
  font-size: 11.5px;
  color: var(--md-warn);
}

.md-filelist__elapsed {
  font-size: 11.5px;
  color: var(--md-ink-4);
  font-family: var(--md-font-num);
}

.md-filelist__pills {
  margin-left: auto;
  display: flex;
  gap: 6px;
}

/* 小胶囊：复用页签胶囊那套（32px 高 / 圆角 99）*/
.md-filelist__pill {
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--md-line);
  border-radius: 99px;
  background: transparent;
  font-family: inherit;
  font-size: 12px;
  color: var(--md-ink-3);
  cursor: pointer;
  white-space: nowrap;
  transition:
    background-color var(--md-dur-hover) ease,
    border-color var(--md-dur-hover) ease,
    color var(--md-dur-hover) ease;
}

.md-filelist__pill:hover:not(:disabled) {
  border-color: var(--md-line-strong);
  color: var(--md-ink-1);
}

.md-filelist__pill--on {
  background: var(--md-orange-primary);
  border-color: var(--md-orange-primary);
  color: var(--md-on-brand);
  font-weight: 600;
}

.md-filelist__pill:disabled {
  color: var(--md-ink-4);
  cursor: not-allowed;
}

/* ── 列头行 30px（5 列网格，与数据行同网格对齐）──────────────────── */
.md-filelist__cols {
  height: 30px;
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: 34px 42px minmax(0, 1fr) minmax(0, 1fr) 72px 26px;
  align-items: center;
  gap: var(--md-space-1);
  padding: 0 var(--md-space-5);
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 1.4px;
  text-transform: uppercase;
  color: var(--md-ink-4);
  border-bottom: 1px solid var(--md-line);
}

/* ── ② 行区 ──────────────────────────────────────────────────────── */
.md-filelist__body {
  flex: 1 1 auto;
  min-height: 0;
  /* 预览刷新立即重绘、无过渡动画（避免列表闪动）*/
  will-change: transform;
}

.md-filelist__none {
  margin: 0;
  padding: var(--md-space-6);
  text-align: center;
  font-size: 12.5px;
  color: var(--md-ink-3);
}

/* ── ③ 表底摘要条 54px ───────────────────────────────────────────── */
.md-filelist__foot {
  flex: 0 0 54px;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 var(--md-space-5);
  background: var(--md-bg-cream);
}

.md-filelist__sumlbl {
  flex: 0 0 auto;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 1.7px;
  text-transform: uppercase;
  color: var(--md-ink-4);
}

.md-filelist__stack {
  flex: 1 1 auto;
  min-width: 80px;
  display: flex;
  gap: 3px;
  height: 8px;
}

.md-filelist__seg {
  display: block;
  border-radius: 2px;
  background: var(--md-line-strong);
}

.md-filelist__seg--on {
  background: var(--md-orange-primary);
}

.md-filelist__lg {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--md-ink-3);
  white-space: nowrap;
}

.md-filelist__lg b {
  font-family: var(--md-font-num);
  font-weight: 600;
  color: var(--md-ink-1);
  font-variant-numeric: tabular-nums;
}
</style>
