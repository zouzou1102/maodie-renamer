/**
 * 导出请求的逐字段白名单（与 `sanitize-rule.ts` 同一形态）。P3-2 / 第 2 批。
 *
 * ── 为什么必须逐字段收口 ─────────────────────────────────────────────
 * 这是「主进程不信任渲染层」的落点。漏收一个字段的症状是
 * 「用户选了 CSV、拿到的还是 xlsx」这类**界面一点异常都没有**的静默错误
 * （设计 §7.5 第 1 行）—— 与第 1 批 `sanitizeRule` 漏字段是同一类问题。
 *
 * ── 为什么放 `shared/` 而不是 `fs.ipc.ts` 里 ─────────────────────────
 * 它要有单测（设计 §10 列了「单测 · `sanitizeExport()`」）。放主进程目录
 * 就会 import 到 electron，`node --test` 起不来 —— 第 1 批的 `sanitizeRule`
 * 已经因为完全相同的理由，从 `main/ipc/rename.ipc.ts` 挪到了
 * `shared/sanitize-rule.ts`。
 */

import { EXPORT_EXT } from './export-format'
import type { ExportFormat, ExportListRequest } from './types'

const FORMATS: readonly ExportFormat[] = ['xlsx', 'txt', 'csv', 'docx']

/**
 * 只保留文件名成分。
 *
 * 为什么不用正则：`no-control-regex` 是 eslint recommended 里的 error，
 * 而按代码点过滤既避开这条规则，又比正则更直白。
 */
function bareFileName(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) continue // 控制字符
    if ('\\/:*?"<>|'.includes(ch)) continue // Windows 文件名非法字符
    out += ch
  }
  return out.trim()
}

/**
 * 收口。所有字段都从 `unknown` 重新构造一遍，**不直接透传** ——
 * 透传就等于把渲染层的数据原样交给写盘逻辑。
 */
export function sanitizeExport(req: unknown): ExportListRequest {
  const src = (typeof req === 'object' && req !== null ? req : {}) as Record<string, unknown>

  // 非法 / 缺失的格式一律落到默认值 'xlsx'（与界面的默认选项一致）
  const format: ExportFormat = FORMATS.includes(src.format as ExportFormat)
    ? (src.format as ExportFormat)
    : 'xlsx'

  const header = Array.isArray(src.header)
    ? src.header.filter((x): x is string => typeof x === 'string')
    : []
  const width = header.length

  // ★ 列数对齐：每行都必须与表头等长。
  //   不齐的后果分两种：CSV 会**列错位**（且错在导出文件里，界面上看不出来）；
  //   xlsx / docx 虽然会补空，但表格形状就取决于各工具自己的理解 —— 不如钉死。
  const rows: string[][] = Array.isArray(src.rows)
    ? src.rows
        .filter((r): r is unknown[] => Array.isArray(r))
        .map((r) => {
          const cells = r.filter((x): x is string => typeof x === 'string')
          return Array.from({ length: width }, (_, i) => cells[i] ?? '')
        })
    : []

  const suggested = typeof src.suggestedName === 'string' ? bareFileName(src.suggestedName) : ''

  return {
    format,
    header,
    rows,
    suggestedName: suggested === '' ? `文件名清单${EXPORT_EXT[format]}` : suggested,
  }
}
