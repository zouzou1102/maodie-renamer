/**
 * 导出行的组装（纯函数）。P3-2 / 第 2 批。
 *
 * ── ★ 为什么放在 `shared/` 而不是 `stores/files.ts` ───────────────────
 * 设计文档 §7.4 把它列在 store 里，但那样**单测根本跑不了**：
 * `tsconfig.node.json` 的 include 不含 `src/renderer/**`，而 store 还
 * import 了 vue / pinia / preview-runner —— `node --test` 起不来。
 *
 * 而 §10 明确要求一条单测：「导出内容里的新名列 ≡ `items[].newName`，
 * 逐条逐字节相等」（TC-52）。P2-C 踩过「测试写了却从没跑过」的事故
 * （`p2c-guide.test.ts`），所以这里按 §7.3 的同一原则处理：
 * **纯逻辑放 `shared/`**（无 vue / pinia 依赖，能直接跑），store 只负责调用它。
 */

import { EXPORT_EXT } from './export-format'
import { ITEM_STATUS_LABEL } from './labels'
import { todayYmd } from './today'
import type { ExportFormat, FileItem } from './types'

/** 可勾选的列。「序号」不在其中 —— 它恒有、不可取消（设计 §3.1）*/
export type ExportColumn = 'name' | 'newName' | 'status' | 'dirPath'

/** 列的固定顺序（「序号」恒在最前）*/
export const EXPORT_COLUMN_ORDER: ExportColumn[] = ['name', 'newName', 'status', 'dirPath']

/**
 * 列的中文表头 —— **界面上的勾选框与导出文件里的表头共用这一份**。
 *
 * 各写一份的话，将来改文案必然出现「勾选框叫『所在文件夹』、表头叫『路径』」，
 * 而这种不一致只在导出文件被打开时才看得见（设计 §7.5 第 9 行）。
 */
export const EXPORT_COLUMN_LABEL: Record<ExportColumn, string> = {
  name: '原名',
  newName: '新名',
  status: '状态',
  dirPath: '所在文件夹',
}

/** 序号列表头 */
export const EXPORT_INDEX_LABEL = '序号'

export interface ExportBuildOptions {
  /** 导出范围：全部 / 仅选中项 */
  scope: 'all' | 'selected'
  /** 勾选的列（输出顺序恒按 EXPORT_COLUMN_ORDER，与勾选先后无关）*/
  columns: ExportColumn[]
}

export interface ExportTable {
  header: string[]
  rows: string[][]
}

/**
 * 组装导出表格。
 *
 * ★ 新名列直接取 `item.newName` —— 与**预览、与执行同源**。
 *   这正是「清单上的新名必然等于真正改出来的名字」的依据（TC-52）：
 *   三处用的是同一个 `items[].newName`，不存在第二份算法。
 *
 * 列表为空 / 一项都没选中时返回 `rows: []`，由主进程判 `E_LIST_EMPTY`
 * 并**拒绝产出一个 0 行的文件**（设计 §4 第 1 行）。
 */
export function buildExportTable(
  items: FileItem[],
  selectedIds: ReadonlySet<string>,
  opts: ExportBuildOptions,
): ExportTable {
  const picked = opts.scope === 'selected' ? items.filter((i) => selectedIds.has(i.id)) : items
  const cols = EXPORT_COLUMN_ORDER.filter((c) => opts.columns.includes(c))

  return {
    header: [EXPORT_INDEX_LABEL, ...cols.map((c) => EXPORT_COLUMN_LABEL[c])],
    // 序号是**导出范围内的行号**（1..N），不是列表里的原始下标 ——
    // 用户拿纸质清单对的是这一份的行。
    rows: picked.map((it, idx) => [String(idx + 1), ...cols.map((c) => cellText(it, c))]),
  }
}

function cellText(it: FileItem, c: ExportColumn): string {
  if (c === 'name') return it.name
  if (c === 'newName') return it.newName
  // ★ 状态走 labels.ts 的同一份词，**不在这里另抄一遍中文**（设计 §7.4 第 6 项）。
  //   产品负责人 2026-09-21 裁决：清单与界面用同一套词（将变化 / 无变化 / 重名 /
  //   非法 / 待处理），所以直接引用常量，比再加一层薄封装更不容易漂移。
  if (c === 'status') return ITEM_STATUS_LABEL[it.status] ?? ''
  return it.dirPath
}

/**
 * 建议文件名：`文件名清单-2026-09-21.xlsx`。
 *
 * 只给**名字**、不带目录 —— 「另存为」的落点由用户亲手选（§1.3 第 1 条：
 * 程序绝不自己猜路径）。
 */
export function suggestExportName(format: ExportFormat, today: string = todayYmd()): string {
  return `文件名清单-${today}${EXPORT_EXT[format]}`
}
