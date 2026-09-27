<script setup lang="ts">
/**
 * EL-033 ~ EL-036 列表行（设计规范 §5.1 / §5.2）。
 *
 * · 行高固定 46px（★ 施工单 2026-09-27，虚拟滚动的前提）
 * · 行内**不放** box-shadow / filter —— 每帧重绘上万个阴影 GPU 扛不住
 * · 冲突 / 非法行整行底色红、文字全红，并且**必须有文字徽标**
 *   （无障碍：颜色不能是唯一信息载体）
 *
 * ── C 方案施工单 §六：行网格 = 勾选 34 / 序号 42 / 原名 1fr / 新名 1fr / 状态 72（+26 删除钮）
 * 行号等宽 11px / --ink3；超长一律省略号；选中行淡橘底。
 */
import { computed } from 'vue'
import DiffText from './DiffText.vue'
import MdIcon from './MdIcon.vue'
import { CONFLICT_KIND_LABEL } from '@shared/labels'
import type { FileItem } from '@shared/types'
import { useFilesStore } from '../stores/files'

const props = defineProps<{
  item: FileItem
  index: number
  selected: boolean
}>()

const files = useFilesStore()

/**
 * ★ P3-5：导入模式下的「表外项」—— 列表里有、表里没有，保持原名不动。
 * 由 store 统一判定（要同时看「当前模式」与「导没导过表」），行组件只负责显示。
 */
const outsideImport = computed(() => files.importOutsideIds.has(props.item.id))

const emit = defineEmits<{
  (e: 'toggle', id: string): void
  (e: 'remove', id: string): void
}>()

const unchanged = computed(() => props.item.status === 'unchanged')
const willChange = computed(() => props.item.status === 'changed')
const problemKind = computed(() => {
  if (props.item.status === 'conflict') return '重名'
  if (props.item.status === 'invalid') return '非法'
  return ''
})

const badgeText = computed(() => {
  if (props.item.status === 'conflict') {
    return props.item.conflictKind ? CONFLICT_KIND_LABEL[props.item.conflictKind] || '重名' : '重名'
  }
  return '非法'
})

/** 行号：两位等宽（01 起）*/
const indexLabel = computed(() => String(props.index + 1).padStart(2, '0'))

const title = computed(() => {
  const base = `${props.item.name} → ${props.item.newName || '—'}`
  return props.item.reason ? `${base}\n${props.item.reason}` : base
})
</script>

<template>
  <div
    class="md-filelist__row"
    :class="{
      'md-filelist__row--sel': selected,
      'md-filelist__row--conflict': item.status === 'conflict',
      'md-filelist__row--invalid': item.status === 'invalid',
    }"
    :title="title"
    @click="emit('toggle', item.id)"
  >
    <span class="md-filelist__ck" @click.stop>
      <label class="md-check md-check--sm">
        <input type="checkbox" :checked="selected" @change="emit('toggle', item.id)" />
        <span class="md-check__box"><MdIcon name="check" :size="12" /></span>
      </label>
    </span>

    <span class="md-filelist__no">{{ indexLabel }}</span>

    <!-- EL-033 原名 -->
    <span class="md-filelist__name">
      <DiffText :text="item.name" :diff="item.diffRange" side="old" />
    </span>

    <!-- EL-035 新名 -->
    <span class="md-filelist__newname">
      <DiffText
        :text="unchanged ? '' : item.newName"
        :diff="item.diffRange"
        side="new"
        :unchanged="unchanged"
      />
    </span>

    <!-- 状态列：徽标（文字，不依赖颜色）+ 状态词
         ⚠️ 包一层 span：本行是 6 列 grid，子元素数量必须与列数一致 -->
    <span class="md-filelist__st">
      <span v-if="item.override !== undefined" class="md-badge md-badge--muted" data-badge-table>
        表
      </span>
      <span v-if="outsideImport" class="md-badge md-badge--muted" data-badge-outside>
        表里没有
      </span>
      <span v-if="problemKind" class="md-badge md-badge--bad">
        <MdIcon name="warn" :size="12" />
        {{ badgeText }}
      </span>
      <span v-else-if="item.isSymlink" class="md-badge md-badge--muted">链接</span>
      <span
        v-else-if="willChange"
        class="md-filelist__sttext md-filelist__sttext--go"
      >将改</span>
      <span
        v-else-if="unchanged"
        class="md-filelist__sttext md-filelist__sttext--hold"
      >无变化</span>
    </span>

    <!-- EL-036 行内删除（悬停出现）-->
    <span class="md-filelist__delcell">
      <button
        class="md-iconbtn md-filelist__del"
        title="从列表移除（不会删除文件）"
        aria-label="从列表移除"
        @click.stop="emit('remove', item.id)"
      >
        <MdIcon name="rowDelete" :size="14" />
      </button>
    </span>
  </div>
</template>

<style scoped>
.md-filelist__row {
  height: var(--md-row-h);
  display: grid;
  /* 与列头行同网格：勾选 34 / 序号 42 / 原名 1fr / 新名 1fr / 状态 72 / 删除 26 */
  grid-template-columns: 34px 42px minmax(0, 1fr) minmax(0, 1fr) 72px 26px;
  align-items: center;
  gap: var(--md-space-1);
  padding: 0 var(--md-space-5);
  border-bottom: 1px solid var(--md-line);
  font-size: 13px;
  color: var(--md-ink-1);
  cursor: pointer;
  transition: background-color 0.12s ease;
}

/* 选中行淡橘底（施工单 §六）—— 类名避开裸词 .sel（那是 <select> 的样式类，
   同权重排后会互相覆盖，历史教训见设计稿 C 的注释）*/
.md-filelist__row--sel {
  background: var(--md-brand-tint);
}

.md-filelist__row:hover {
  background: var(--md-bg-warm);
}

.md-filelist__row--sel:hover {
  background: var(--md-brand-tint);
}

.md-filelist__ck {
  display: grid;
  place-items: center;
}

.md-filelist__ck .md-check {
  margin: 0;
}

/* 行号：等宽 11px / --ink3 */
.md-filelist__no {
  font-family: var(--md-font-num);
  font-size: 11px;
  color: var(--md-ink-3);
  font-variant-numeric: tabular-nums;
}

.md-filelist__name,
.md-filelist__newname {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.md-filelist__st {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}

/* 状态词：10px / 600 / 全大写 / 字距 1px（设计稿 .st）*/
.md-filelist__sttext {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1px;
  text-transform: uppercase;
  white-space: nowrap;
}

.md-filelist__sttext--go {
  color: var(--md-orange-dark);
}

.md-filelist__sttext--hold {
  color: var(--md-ink-3);
}

.md-filelist__delcell {
  display: grid;
  place-items: center;
}
</style>
