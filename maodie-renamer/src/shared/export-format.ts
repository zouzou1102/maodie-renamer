/**
 * 导出内容生成 —— 四种格式的统一入口。P3-2 / 第 2 批。
 *
 * ── 职责边界 ─────────────────────────────────────────────────────────
 * 输入是**已经组装好的二维表格**（第 0 行是表头），输出是文件字节。
 * 本文件与两个格式写入器一样，**不做任何业务判断** —— 表头文案、列的取舍、
 * 行序全部由渲染层决定（见 `export-rows.ts`）。这样「表头文案」这类东西
 * 只有一处真源，不存在「两边改了一处、另一处忘了」的可能。
 *
 * ── 为什么 txt/csv 也返回字节 ────────────────────────────────────────
 * 主进程只留**一条**写盘路径（字节 → 临时文件 → 原子改名），
 * 不必为「文本」和「二进制」各写一遍 —— 少一条路径 = 少一处只在用户那里
 * 才暴露的差异。
 */

import { docxWrite } from './docx-write'
import { xlsxWrite } from './xlsx-write'
import type { ExportFormat } from './types'

const enc = new TextEncoder()

/** UTF-8 BOM 的三个字节 */
const BOM = new Uint8Array([0xef, 0xbb, 0xbf])

export const EXPORT_EXT: Record<ExportFormat, string> = {
  xlsx: '.xlsx',
  txt: '.txt',
  csv: '.csv',
  docx: '.docx',
}

/**
 * CSV 单元格转义（RFC 4180）。
 *
 * ★ 为什么 `;` 也要触发引号包装：CSV 的「分隔符」在部分地区是分号
 *   （Excel 的本地化版本会按系统区域设置去猜）。包一层永远是对的；
 *   不包则可能在别人的机器上列错位 —— 而错位发生在**导出的文件里**，
 *   我们的界面上没有导出文件的预览，**看不出来**。
 */
export function csvCell(s: string): string {
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Tab 分隔的单元格（`.txt`）。
 *
 * ★ 明确**不做**引号包装：Windows 文件名不可能含 Tab 或换行
 *   （`E_INVALID_CHAR` 已挡），所以这个分支根本走不到 ——
 *   与设计 §5.⑤「不做不可能发生的场景的处理」一致。
 */
export function tsvCell(s: string): string {
  return s
}

function withBom(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(BOM.length + bytes.length)
  out.set(BOM, 0)
  out.set(bytes, BOM.length)
  return out
}

/**
 * 生成导出文件的字节。
 *
 * @param table 第 0 行是表头，其余是数据行；各行列数一致
 *              （由 `sanitizeExport` 保证）。
 */
export function buildExportContent(format: ExportFormat, table: string[][]): Uint8Array {
  if (format === 'xlsx') return xlsxWrite(table)
  if (format === 'docx') return docxWrite(table)

  const isCsv = format === 'csv'
  const sep = isCsv ? ',' : '\t'
  const cell = isCsv ? csvCell : tsvCell
  // 行分隔符一律 CRLF：CSV 是 RFC 4180 的规定；txt 则在 Windows 记事本里最稳。
  // ★ 末尾**不加**尾换行 —— 这样「行数 = 列表项数 + 1（表头）」在
  //   `text.split('\r\n').length` 上严格成立，验收时一眼能数（TC-51）。
  const text = table.map((r) => r.map(cell).join(sep)).join('\r\n')

  // ★ BOM 只在这一处加 —— txt 与 csv 两条路径共用，不会出现
  //   「以后新加第三种文本格式、忘了带 BOM」而用户那边整张表乱码。
  return withBom(enc.encode(text))
}
