<script setup lang="ts">
/**
 * EL-033 ~ EL-036 列表行（设计规范 §5.1 / §5.2）。
 *
 * · 行高固定 36px（虚拟滚动的前提）
 * · 行内**不放** box-shadow / filter —— 每帧重绘上万个阴影 GPU 扛不住
 * · 冲突 / 非法行整行底色 `#FFF7F6`、文字全红，并且**必须有文字徽标**
 *   （无障碍：颜色不能是唯一信息载体）
 */
import { computed } from 'vue'
import DiffText from './DiffText.vue'
import MdIcon from './MdIcon.vue'
import { CONFLICT_KIND_LABEL } from '@shared/labels'
import type { FileItem } from '@shared/types'

const props = defineProps<{
  item: FileItem
  selected: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle', id: string): void
  (e: 'remove', id: string): void
}>()

const unchanged = computed(() => props.item.status === 'unchanged')
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

const title = computed(() => {
  const base = `${props.item.name} → ${props.item.newName || '—'}`
  return props.item.reason ? `${base}\n${props.item.reason}` : base
})
</script>

<template>
  <div
    class="md-filelist__row"
    :class="{
      'md-filelist__row--conflict': item.status === 'conflict',
      'md-filelist__row--invalid': item.status === 'invalid',
    }"
    :title="title"
  >
    <label class="md-check md-check--sm md-filelist__check">
      <input type="checkbox" :checked="selected" @change="emit('toggle', item.id)" />
      <span class="md-check__box"><MdIcon name="check" :size="12" /></span>
    </label>

    <span class="md-filelist__icon">
      <MdIcon :name="item.isDir ? 'folder' : 'file'" :size="15" />
    </span>

    <!-- EL-033 原名 -->
    <span class="md-filelist__name">
      <DiffText :text="item.name" :diff="item.diffRange" side="old" />
    </span>

    <!-- EL-034 箭头 -->
    <span class="md-filelist__arrow"><MdIcon name="arrowRight" :size="14" /></span>

    <!-- EL-035 新名 -->
    <span class="md-filelist__newname">
      <DiffText
        :text="unchanged ? '' : item.newName"
        :diff="item.diffRange"
        side="new"
        :unchanged="unchanged"
      />
    </span>

    <!-- 状态徽标（文字，不依赖颜色）+ P3-4：名字来自导入的表格时加一个「表」徽标
         （设计 §2.5）—— 用户滚动一长串列表时，要能一眼看出**哪些是表里给的、
         哪些是规则算的**。
         ⚠️ 包一层 span 而不是再加一个并列子元素：本行是 **7 列 grid**，
            多一个直接子元素会凭空多出一列，整行布局就错位了。 -->
    <span class="md-filelist__badges">
      <span v-if="item.override !== undefined" class="md-badge md-badge--muted" data-badge-table>
        表
      </span>
      <span v-if="problemKind" class="md-badge md-badge--bad">
        <MdIcon name="warn" :size="12" />
        {{ badgeText }}
      </span>
      <span v-else-if="item.isSymlink" class="md-badge md-badge--muted">链接</span>
    </span>

    <!-- EL-036 行内删除（悬停出现）-->
    <button
      class="md-iconbtn md-filelist__del"
      title="从列表移除（不会删除文件）"
      aria-label="从列表移除"
      @click.stop="emit('remove', item.id)"
    >
      <MdIcon name="rowDelete" :size="14" />
    </button>
  </div>
</template>

<style scoped>
.md-filelist__row {
  height: var(--md-row-h);
  display: grid;
  grid-template-columns: 22px 20px minmax(0, 1fr) 22px minmax(0, 1fr) auto 26px;
  align-items: center;
  gap: var(--md-space-1);
  padding: 0 var(--md-space-2) 0 var(--md-space-3);
  border-bottom: 1px solid var(--md-line);
  font-size: 13px;
  color: var(--md-ink-1);
}

.md-filelist__check {
  margin: 0;
}

.md-filelist__icon {
  display: inline-flex;
  align-items: center;
}

.md-filelist__name,
.md-filelist__newname {
  min-width: 0;
  overflow: hidden;
}

.md-filelist__arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.md-filelist__badges {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

</style>
