/**
 * 枚举 → 中文标签。界面与规则摘要共用，避免同一枚举在两处出现不同措辞。
 */

import type { Theme } from './theme'
import type {
  CaseTransform,
  ConflictKind,
  DateFormat,
  ExportFormat,
  ItemStatus,
  SeqKind,
  SeqPosition,
} from './types'

export function seqPositionLabel(v: SeqPosition): string {
  if (v === 'prefix') return '排在最前'
  if (v === 'at') return '第 n 个字符后'
  return '排在最后'
}

/** P3-1 位置三档（顺序即界面顺序；新增档排在最后，前两档位置不动）*/
export const SEQ_POSITION_OPTIONS: Array<{ value: SeqPosition; label: string }> = [
  { value: 'suffix', label: '排在最后' },
  { value: 'prefix', label: '排在最前' },
  { value: 'at', label: '插在第 n 个字符后' },
]

/** P3-1 编号类型四选一（顺序即界面顺序）*/
export const SEQ_KIND_OPTIONS: Array<{ value: SeqKind; label: string }> = [
  { value: 'number', label: '数字' },
  { value: 'letter', label: '字母' },
  { value: 'random', label: '随机字符' },
  { value: 'time', label: '时间' },
]

export function seqKindLabel(v: SeqKind): string {
  return SEQ_KIND_OPTIONS.find((o) => o.value === v)?.label ?? '数字'
}

/**
 * 日期样式 5 档。**「启用日期」与「时间」类型共用同一张表**（设计 §3.5）——
 * 两处各写一份必然会漂移。label 用真实样例日期，用户不用看格式串就懂。
 */
export const DATE_FORMAT_OPTIONS: Array<{ value: DateFormat; label: string }> = [
  { value: 'YYYY-MM-DD', label: '2026-09-11' },
  { value: 'YYYYMMDD', label: '20260911' },
  { value: 'YYYY年MM月DD日', label: '2026年09月11日' },
  { value: 'MM月DD日', label: '09月11日' },
  { value: 'YYMMDD', label: '260911' },
]

export function dateFormatLabel(v: DateFormat): string {
  return v
}

/** F-11 大小写下拉的选项（顺序即界面顺序）*/
export const CASE_TRANSFORM_OPTIONS: Array<{ value: CaseTransform; label: string }> = [
  { value: 'none', label: '保持原样' },
  { value: 'lower', label: '全部小写' },
  { value: 'upper', label: '全部大写' },
  { value: 'capitalize', label: '首字母大写' },
]

/**
 * P3-2 导出格式四选一（顺序即界面顺序）。
 *
 * ★ 默认值是 `'xlsx'`，但**不由这张表决定** —— 表只负责「有哪些选项、叫什么」，
 *   默认值写在组件里（设计 §3.3：Excel 是默认档，因为收表的人多半要用它打开）。
 *   把默认值塞进选项表会让「排序」和「默认」两件事耦在一起。
 */
export const EXPORT_FORMAT_OPTIONS: Array<{ value: ExportFormat; label: string }> = [
  { value: 'xlsx', label: 'Excel (.xlsx)' },
  { value: 'txt', label: '文本 (.txt)' },
  { value: 'csv', label: 'CSV (.csv)' },
  { value: 'docx', label: 'Word (.docx)' },
]

/** F-14 主题三选一的选项（顺序即界面顺序：跟随系统 / 始终浅色 / 始终深色）*/
export const THEME_OPTIONS: Array<{ value: Theme; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '始终浅色' },
  { value: 'dark', label: '始终深色' },
]

/** 规则摘要里的大小写后缀；'none' → 空串（摘要不追加）*/
export function caseTransformLabel(v: CaseTransform): string {
  if (v === 'none') return ''
  return CASE_TRANSFORM_OPTIONS.find((o) => o.value === v)?.label ?? ''
}

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  pending: '待处理',
  unchanged: '无变化',
  changed: '将变化',
  conflict: '重名',
  invalid: '非法',
}

export const CONFLICT_KIND_LABEL: Record<ConflictKind, string> = {
  none: '',
  batch: '同批撞名',
  disk: '磁盘同名',
  self: '',
  'case-only': '大小写',
}
