/**
 * 文件提取的「筛选」纯函数（P3-8 / 第 8 批 · 设计 §5⑥）。
 *
 * 为什么是纯函数、放在 shared：
 *   · 干跑报告与真执行**共用同一份命中集** → 「预览 ≡ 执行」才有落点
 *     （设计 §7.3 第 1 / 3 行）：报告说提取 21 个、执行就绝不变成 23 个。
 *   · **不 import `node:fs`** → 可被 `node --test` 直接单测（与 `merge-plan` 同族）。
 *     真正的搬文件由 P3-7 的 `merge-service` 负责，这里只决定「哪些文件该搬」。
 *
 * 三种条件各自独立启用，最后取**交集（AND）**（拍板第 3 条）：
 *   ① 按类型  —— 扩展名归入用户勾选的类别（共用 P3-7②的扩展名→类别映射表）。
 *   ② 按名称  —— 默认「文件名主体含关键词」；开正则则按正则匹配（复用 F10）。
 *   ③ 按 Excel —— 复用 P3-4 解析器读出的「文件名」名单，列表里出现即命中。
 */

import { MD_ERROR, MdError } from './errors'
import { splitName } from './name-split'
import { detectColumns } from './table-map'
import type { ExtractFilter, ExtractSourceFile, FileCategory, ImportedTable } from './types'

/* ══ 1. 扩展名 → 类别映射（与 P3-7②「按扩展名建文件夹」共用同一张表）═══════ */

/**
 * ★ 类别映射的**唯一真源**（设计 §3.2 第 5 行 / §5⑤）。
 *
 * 放在 shared 让「合并时按扩展名分目录」与「提取时按类型筛」口径一致，
 * 不会各说各话。扩展名一律小写、不含点。
 */
export const CATEGORY_EXTENSIONS: Record<FileCategory, string[]> = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'tif', 'heic', 'svg', 'ico'],
  doc: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'txt', 'md', 'rtf', 'odt', 'ods', 'odp', 'csv', 'htm', 'html', 'wps'],
  video: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'],
  // other 故意留空：任何不在上面五类里的（含无扩展名）都归 other
  other: [],
}

/** 扩展名（含点，如 `.jpg`，或空串）→ 类别 */
export function categoryOf(ext: string): FileCategory {
  const e = ext.replace(/^\./, '').toLowerCase()
  if (e === '') return 'other'
  for (const cat of ['image', 'doc', 'video', 'audio', 'archive'] as FileCategory[]) {
    if (CATEGORY_EXTENSIONS[cat].includes(e)) return cat
  }
  return 'other'
}

/* ══ 2. 三种筛选 → 命中集（AND 叠加）═════════════════════════════════ */

export interface FilterResult {
  /** 命中的源文件（三类条件的交集）*/
  hits: ExtractSourceFile[]
  /** Excel 名单里、列表里没有的文件名（EX-21 逐条标，不阻塞整批）*/
  unmatched: string[]
}

/** 取路径 / 文件名里的 basename（兼容「Excel 列里带了路径」的情况）*/
function basenameOf(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return i >= 0 ? p.slice(i + 1) : p
}

/**
 * 按筛选条件从当前列表算命中集。
 *
 * 不抛异常的边界：
 *   · 三个条件都没启用 → 命中集为空（设计 §4 边界 2：「没筛出任何文件」）。
 *   · Excel 名单里某文件对不上 → 进 `unmatched`，不抛、不阻塞（EX-21）。
 * ★ 唯一会抛的是「按名称开了正则但语法非法」（EX-22）—— 必须在计划阶段拦截，
 *   不能让非法正则混进 plan、执行时才炸（设计 §4 边界 4 / §7.3 第 6 行）。
 */
export function filterList(list: ExtractSourceFile[], filter: ExtractFilter): FilterResult {
  const useType = Array.isArray(filter.categories) && filter.categories.length > 0
  const useName = !!filter.name && filter.name.keyword.trim() !== ''
  const useExcel = Array.isArray(filter.excelNames) && filter.excelNames.length > 0

  // 一个条件都没启用 → 命中集为空（提取「全部」是危险默认，宁可按「没筛出」提示）
  if (!useType && !useName && !useExcel) {
    return { hits: [], unmatched: [] }
  }

  // 按名称：开正则则先编译一次，语法非法立即抛 EX-22（拒绝干跑）
  let nameRe: RegExp | null = null
  if (useName && filter.name!.useRegex) {
    try {
      // 默认忽略大小写，与「包含」口径一致（设计 §3.2 按名称）
      nameRe = new RegExp(filter.name!.keyword, 'i')
    } catch {
      throw new MdError(MD_ERROR.E_REGEX_INVALID, `正则语法非法：${filter.name!.keyword}`)
    }
  }

  // 按 Excel：建立 basename 反查集（大小写不敏感），用于「未匹配」判定
  const excelSet = useExcel
    ? new Set((filter.excelNames as string[]).map((n) => basenameOf(n).toLowerCase()))
    : null
  const excelHit = new Set<string>()

  const hits: ExtractSourceFile[] = []
  for (const f of list) {
    // ① 按类型
    if (useType && !(filter.categories as FileCategory[]).includes(categoryOf(f.ext))) continue

    // ② 按名称：比「主体」（不含扩展名），与 EX-07 扩展名保护口径一致
    if (useName) {
      const stem = splitName(f.name, f.isDir).stem
      const kw = filter.name!.keyword.trim().toLowerCase()
      const ok = nameRe ? nameRe.test(stem) : stem.toLowerCase().includes(kw)
      if (!ok) continue
    }

    // ③ 按 Excel：列表文件名（basename，忽略大小写）需在名单里
    if (useExcel) {
      const key = f.name.toLowerCase()
      if (!excelSet!.has(key)) continue
      excelHit.add(key)
    }

    hits.push(f)
  }

  // 未匹配 = Excel 名单里、列表里没有的名字（逐条标，不阻塞）
  const unmatched = useExcel
    ? (filter.excelNames as string[]).filter((n) => !excelHit.has(basenameOf(n).toLowerCase()))
    : []

  return { hits, unmatched }
}

/* ══ 3. 复用 P3-4 解析器：从 ImportedTable 取「原文件名」列（EX-21 解析失败）═══ */

/** 取一格里的值（按列号，与 P3-4 的 `cellAt` 同语义）*/
function cellText(row: ImportedTable['rows'][number], col: number): string {
  if (col <= 0) return ''
  const hit = row.cells.find((c) => c.col === col)
  return hit === undefined ? '' : hit.text.trim()
}

/**
 * 从导入的表里提取「原文件名」列的全部文件名（复用 P3-4 的 `detectColumns`）。
 *
 * 返回：
 *   · `{ ok: true, names }` —— 成功，names 是该列所有非空文件名。
 *   · `{ ok: false, code }` —— 没认出「原文件名」列（EX-21 解析失败）：
 *     渲染层应**直接报错、不进入干跑**，而不是猜列（猜错列 = 提错文件）。
 *
 * ★ 这里只取名字，不读新文件名列：提取只看「列表里有没有这名字」，
 *   不关心表里给的新名（提取不改名，与 P3-4 的「导入改名」是两回事）。
 */
export function excelFilenamesOf(
  table: ImportedTable,
): { ok: true; names: string[] } | { ok: false; code: typeof MD_ERROR.E_EXCEL_UNMATCHED } {
  const guess = detectColumns(table.rows)
  if (guess.nameCol <= 0) {
    return { ok: false, code: MD_ERROR.E_EXCEL_UNMATCHED }
  }
  const names: string[] = []
  for (let i = 0; i < table.rows.length; i++) {
    if (i === guess.headerRow) continue // 表头行不算数据
    const t = cellText(table.rows[i], guess.nameCol)
    if (t !== '') names.push(t)
  }
  return { ok: true, names }
}
