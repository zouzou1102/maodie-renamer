/**
 * 导入表格的**核心纯逻辑**：表头识别 + 行/文件配对 + 纯文本表格解析。
 * P3-4 / 第 4 批。
 *
 * 本文件里没有一个 `await`、没有一次 IO、不碰 store、不碰 DOM：
 * 吃「表」+「文件清单」，吐「哪一行配哪个文件、改成什么、哪些配不上」。
 * 所以单测能把所有边界（空单元格、重名、顺序不吻合…）都覆盖到。
 *
 * ── 关于 csv / txt 的解析为什么也在这里 ────────────────────────────────
 * 设计 §7.3 只点了三个文件（`zip-read` / `xlsx-read` / `table-map`），
 * 而 `csv` / `txt` 的解析不属于 ZIP、也不属于 xlsx —— 它和 `detectColumns` /
 * `buildMapping` 一样是「TableRow 层面的纯逻辑」，所以放在这里，不另开第四个文件。
 *
 * ── 三种「读法」的关系 ───────────────────────────────────────────────
 * `.xlsx`  → `xlsx-read` → `ImportedTable`
 * `.csv`   → 本文件 `readDelimitedTable(bytes, ',')`   ┐两者形状完全一样，
 * `.txt`   → 本文件 `readDelimitedTable(bytes, '\t')`  ┘后面走同一条配对逻辑
 */

import { MAX_ITEMS_PER_BATCH } from './constants'
import { splitName } from './name-split'
import type { ImportedTable, TableCell, TableRow } from './types'

/* ══ 1. 表头识别 ══════════════════════════════════════════════════════ */

/** 在前几行里找表头（容忍表格前面有标题行 / 空行） */
export const HEADER_SCAN_ROWS = 5

/** 认「原文件名」列的**全部**词（完全相等才认 —— 不做包含匹配，设计 §3.2） */
export const NAME_COL_WORDS = [
  '原文件名', '原名称', '原文件', '原名', '旧文件名', '旧名称', '旧名',
  'oldname', 'old', 'before', 'from',
] as const

/** 认「新文件名」列的全部词 */
export const NEW_COL_WORDS = [
  '新文件名', '新名称', '新文件', '新名', '改名后', '改名',
  'newname', 'new', 'after', 'to', 'target',
] as const

/**
 * 表头归一化：去首尾空白（含全角空格）→ 转小写 → 去掉括号内容。
 *
 * ⚠️ 刻意**不**去掉词内部的空格：`old name` 不认成 `oldname` ——
 * 「认错列」的代价是**改错文件**，所以标准写严一点，认不出就让用户在弹窗里改
 * （设计 §3.2 的「不做包含匹配」是同一条理由）。
 */
export function normalizeHeader(raw: string): string {
  return raw
    .replace(/[\u3000]/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .trim()
}

export interface ColumnInfo {
  /** 列号（1 起） */
  col: number
  /** 该列的表头文字（没有就空串）；下拉里显示成「第 N 列：xxx」 */
  label: string
}

/** 用户可在弹窗里改的三个值（＝三个下拉的值） */
export interface ColumnChoice {
  /** 原文件名列；**0 = 没有** */
  nameCol: number
  /** 新文件名列（1 起） */
  newCol: number
  /** 表头行在 `rows` 里的**下标**；-1 = 没有表头（每一行都是数据） */
  headerRow: number
}

export interface ColumnGuess extends ColumnChoice {
  /** 是否认出了**新文件名列**（只是个信号，不代表能导） */
  headerFound: boolean
  /** 参与下拉的列（含每列表头文字） */
  columns: ColumnInfo[]
  /** 一句话说明「我这样读的」—— 弹窗里原样显示，让用户能一眼判断认没认错 */
  why: string
}

/** 在一行的单元格里找「属于某个词表」的列号（找不到返回 0） */
function findWordCol(cells: TableCell[], words: readonly string[]): number {
  for (const c of cells) {
    if (words.includes(normalizeHeader(c.text))) return c.col
  }
  return 0
}

function cellAt(row: TableRow, col: number): string {
  if (col <= 0) return ''
  const hit = row.cells.find((c) => c.col === col)
  return hit === undefined ? '' : hit.text
}

/** 参与下拉的列 = 前 5 行里出现过的所有列号（升序）；标签取该列第一段非空文字 */
function collectColumns(rows: TableRow[], headerRow: number): ColumnInfo[] {
  const limit = Math.min(rows.length, HEADER_SCAN_ROWS)
  const cols = new Set<number>()
  for (let i = 0; i < limit; i++) {
    for (const c of rows[i].cells) cols.add(c.col)
  }
  return [...cols]
    .sort((a, b) => a - b)
    .map((col) => {
      let label = headerRow >= 0 ? cellAt(rows[headerRow], col).trim() : ''
      if (label === '') {
        for (let i = 0; i < limit; i++) {
          const t = cellAt(rows[i], col).trim()
          if (t !== '') {
            label = t
            break
          }
        }
      }
      return { col, label }
    })
}

function labelOf(columns: ColumnInfo[], col: number): string {
  const hit = columns.find((c) => c.col === col)
  const label = hit === undefined ? '' : hit.label
  return label === '' ? `第 ${col} 列` : `第 ${col} 列：${label}`
}

/**
 * 识别表头（设计 §3.2 的决策树）。
 *
 * 结果**只是预填**：三个下拉始终可改，改完立刻重算 —— 因为自动识别会认错，
 * 而认错的代价是**改错文件**（设计 §5 ①）。
 */
export function detectColumns(rows: TableRow[]): ColumnGuess {
  const limit = Math.min(rows.length, HEADER_SCAN_ROWS)
  let nameCol = 0
  let newCol = 0
  let headerRow = -1
  let partial: { nameCol: number; newCol: number; row: number } | null = null

  for (let i = 0; i < limit; i++) {
    const cells = rows[i].cells
    const n = findWordCol(cells, NAME_COL_WORDS)
    const w = findWordCol(cells, NEW_COL_WORDS)
    // 同一行里两列都认出来 —— 这就是表头行，最强信号，直接停
    if (n > 0 && w > 0 && n !== w) {
      nameCol = n
      newCol = w
      headerRow = i
      partial = null
      break
    }
    if (partial === null && (n > 0 || w > 0)) partial = { nameCol: n, newCol: w, row: i }
  }

  if (headerRow < 0 && partial !== null) {
    nameCol = partial.nameCol
    newCol = partial.newCol
    headerRow = partial.row
  }

  const columns = collectColumns(rows, headerRow)
  const headerFound = newCol > 0

  if (headerFound && nameCol > 0) {
    return {
      nameCol,
      newCol,
      headerRow,
      headerFound,
      columns,
      why: `认出「${labelOf(columns, nameCol)}」和「${labelOf(columns, newCol)}」两列 → 按文件名匹配`,
    }
  }

  // ★ 没找到「原文件名」列 → **整体拒绝，不导入**（设计 §16 第 1 项）。
  //   不猜的理由：猜错列 = 把文件改成别人的名字，而对照表看着挺整齐 —— 用户不会发现。
  //   不按行顺序的理由：拖进来的文件不一定按表里原文件名的顺序排列。
  return {
    nameCol,
    newCol,
    headerRow,
    headerFound,
    columns,
    why:
      nameCol > 0
        ? `我只认出了「${labelOf(columns, nameCol)}」，没找到原文件名列 —— 请在上面指定它是哪一列`
        : '我没认出表头 —— 需要你在下面指定哪一列是原文件名、哪一列是新文件名',
  }
}

/* ══ 2. 行 ↔ 文件 配对 ════════════════════════════════════════════════ */

/** 配对用的文件清单 */
export interface MappingFile {
  id: string
  name: string
  isDir: boolean
}

export type MappingVerdict = 'ok' | 'unmatched' | 'problem' | 'same'

export interface MappingRow {
  /** 表里的行号（1 起，可能跳号） */
  rowNumber: number
  /** 表里「原文件名」列的值（已去首尾空白） */
  rawName: string
  /** 表里「新文件名」列的值（已去首尾空白） */
  rawNew: string
  /** 配上的文件 id；没配上为空串 */
  fileId: string
  /** 配上的文件名；没配上为空串 */
  fileName: string
  /** 配上的项最终要用的**新名主体**；没配上为空串 */
  newStem: string
  verdict: MappingVerdict
  /** 给用户看的一句说明（`unmatched` / `problem` 时一定有） */
  reason: string
}

export interface MappingResult {
  rows: MappingRow[]
  counts: Record<MappingVerdict, number>
  /** 列表里被表「点名」的文件个数（改 + 没变化 + 有问题里配上的那些） */
  matchedFiles: number
  /** 列表里**有**、表里没有的文件个数 —— 它们**继续按规则算**（§3.5 的「表外」） */
  outsideFiles: number
  /** 非空 = **整体拒绝（不导入）** —— 原因：没指定「原文件名」列；此时 `rows` 为空 */
  rejected: string
  /** 表里一行数据都没有（只有表头） */
  empty: boolean
  /** 列表里一个文件都没有（允许导入，但全部进「对不上」，主按钮置灰） */
  listEmpty: boolean
}

/** Windows 文件名不区分大小写 —— 两边都用这个函数归一化后再比 */
function normName(s: string): string {
  return s.trim().toLowerCase()
}

/** 表里那一格写的新名 → 主体（跑设计 §3.4 的五道） */
function stemFromCell(rawNew: string, file: MappingFile): { stem: string; problem: string } {
  // 文件夹没有「扩展名」这个概念，整段都是主体
  if (file.isDir) return { stem: rawNew, problem: '' }

  const { stem, ext } = splitName(rawNew, false)
  if (stem === '') return { stem: '', problem: '表格里这一行没有名字' }

  // ★ 「只写了扩展名」必须单独挡（设计 §3.4 第 5 行）。
  //   ⚠️ 不能指望 `splitName` —— 它的约定是「点在开头（如 `.gitignore`）→ 整名都是主体」，
  //   所以 `.jpg` 会得到 `stem = '.jpg'`，直接放行就会产出一个 `.jpg.docx`：
  //   在列表里看着像个正常名字，实际上是「把名字改成了扩展名」。
  //   代价：表里写 `.gitignore` 这类「点开头」的名字也会被挡 —— 但按设计，
  //   「挡住 + 说清原因」比「悄悄生成一个怪名字」安全，用户改一格就能继续。
  if (rawNew.startsWith('.') && !rawNew.slice(1).includes('.')) {
    return { stem: '', problem: '表格里这一行没有名字（只写了扩展名）' }
  }

  // ★ 扩展名不一致 = 用户想改扩展名 → **跳过 + 标红**，绝不静默按「主体」处理。
  //   静默的话会出来一个「以为改了扩展名、其实没改」的文件，而界面上毫无异常（设计 §5 ②）
  const origExt = splitName(file.name, false).ext
  if (ext !== '' && normName(ext) !== normName(origExt)) {
    return { stem: '', problem: `表格里想改扩展名（${ext}），本批不支持（归第 5 批）` }
  }

  return { stem, problem: '' }
}

export function buildMapping(
  rows: TableRow[],
  choice: ColumnChoice,
  files: MappingFile[],
): MappingResult {
  const counts: Record<MappingVerdict, number> = { ok: 0, unmatched: 0, problem: 0, same: 0 }

  // 表头行不算数据；整行都空的行也不算（容忍表中间的空白行）
  const dataRows = rows.filter((_r, i) => i !== choice.headerRow)
  const items: { row: TableRow; rawName: string; rawNew: string }[] = []
  for (const r of dataRows) {
    const rawName = cellAt(r, choice.nameCol).trim()
    const rawNew = cellAt(r, choice.newCol).trim()
    if (rawName === '' && rawNew === '') continue
    items.push({ row: r, rawName, rawNew })
  }

  const base = {
    rows: [] as MappingRow[],
    counts,
    matchedFiles: 0,
    outsideFiles: files.length,
    rejected: '',
    empty: items.length === 0,
    listEmpty: files.length === 0,
  }
  if (items.length === 0) return base

  // ★ 没指定「原文件名」列 → **整体拒绝（不导入）**（设计 §16 第 1 项）。
  //   没有它就没法知道每一行该配给哪个文件 —— **不猜**：
  //   猜错列 = 把文件改成别人的名字，而对照表看着挺整齐，用户不会发现。
  if (choice.nameCol <= 0) {
    return {
      ...base,
      empty: false,
      rejected:
        '表里没指定「原文件名」列 —— 没有它没法知道每一行该配给哪个文件。' +
        '请把原文件名也放进表里，或在上面手动指定哪一列是原文件名。',
    }
  }

  /* ── ① 配对 ─────────────────────────────────────────────────────── */

  const pairs: (MappingRow & { file: MappingFile })[] = []

  /* 按文件名匹配：列定位 → 按「原文件名」找同名文件（忽略大小写）→ 取**同一行**的新名。
     ⚠️ **不靠顺序** —— 拖进来的文件不一定按表里原文件名的顺序排列（设计 §16）。 */
  const byName = new Map<string, MappingFile[]>()
  for (const f of files) {
    const k = normName(f.name)
    const list = byName.get(k)
    if (list === undefined) byName.set(k, [f])
    else list.push(f)
  }

  const tableHits = new Map<string, number>()
  for (const x of items) {
    if (x.rawName === '') continue
    const k = normName(x.rawName)
    tableHits.set(k, (tableHits.get(k) ?? 0) + 1)
  }

  for (const x of items) {
    const put = (verdict: MappingVerdict, reason: string, file?: MappingFile): void => {
      pairs.push({
        rowNumber: x.row.rowNumber,
        rawName: x.rawName,
        rawNew: x.rawNew,
        fileId: file === undefined ? '' : file.id,
        fileName: file === undefined ? '' : file.name,
        newStem: '',
        verdict,
        reason,
        file: file ?? { id: '', name: '', isDir: false },
      })
    }

    if (x.rawNew === '') {
      put('problem', '表格里这一行没有名字')
      continue
    }
    if (x.rawName === '') {
      put('unmatched', '表里这一行没写原文件名，按文件名匹配时不知道配给谁')
      continue
    }
    const k = normName(x.rawName)
    if ((tableHits.get(k) ?? 0) > 1) {
      put('unmatched', `表里有 ${tableHits.get(k)} 行都写着「${x.rawName}」，不猜谁是谁`)
      continue
    }
    const hit = byName.get(k)
    if (hit === undefined) {
      put('unmatched', `列表里没有「${x.rawName}」`)
      continue
    }
    if (hit.length > 1) {
      put('unmatched', `列表里有 ${hit.length} 个同名文件，请先删掉多余的`)
      continue
    }
    put('ok', '', hit[0])
  }

  /* ── ② 定名字（配上的才定）─────────────────────────────────────── */

  const out: MappingRow[] = []
  let matched = 0
  for (const p of pairs) {
    const row: MappingRow = {
      rowNumber: p.rowNumber,
      rawName: p.rawName,
      rawNew: p.rawNew,
      fileId: p.fileId,
      fileName: p.fileName,
      newStem: '',
      verdict: p.verdict,
      reason: p.reason,
    }

    if (p.fileId !== '' && row.verdict === 'ok') {
      matched++
      const { stem, problem } = stemFromCell(p.rawNew, p.file)
      if (problem !== '') {
        row.verdict = 'problem'
        row.reason = problem
      } else {
        const origStem = p.file.isDir ? p.file.name : splitName(p.file.name, false).stem
        if (stem === origStem) {
          row.verdict = 'same'
          row.newStem = stem
        } else {
          row.newStem = stem
        }
      }
    }

    counts[row.verdict]++
    out.push(row)
  }

  return {
    rows: out,
    counts,
    matchedFiles: matched,
    outsideFiles: Math.max(0, files.length - matched),
    rejected: '',
    empty: false,
    listEmpty: files.length === 0,
  }
}

/** 只取「真的会改」的那些（＝弹窗底部那个按钮要交给列表的东西） */
export function assignmentsOf(result: MappingResult): { id: string; stem: string }[] {
  return result.rows
    .filter((r) => r.verdict === 'ok' && r.fileId !== '')
    .map((r) => ({ id: r.fileId, stem: r.newStem }))
}

/* ══ 3. 纯文本表格（.csv / .txt）→ TableRow[] ═════════════════════════ */

/**
 * 定编码读文本：先按 **UTF-8 严格模式**读（我们自己导出的就带 BOM 的 UTF-8），
 * 读不出来再按 **GBK** 读一次 —— Windows 上被 Excel 打开另存过的 csv
 * 很可能是 GBK（设计 §3.1）。
 */
export function decodeTableText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    try {
      return new TextDecoder('gbk').decode(bytes)
    } catch {
      // 连 GBK 都解不了（环境没带全 ICU 时可能出现）→ 退回宽松 UTF-8，让乱码可见
      return new TextDecoder('utf-8').decode(bytes)
    }
  }
}

/**
 * 按 RFC-4180 切记录：支持引号包裹、`""` 双写转义、字段里含分隔符或换行、
 * `\n` / `\r\n` / 单个 `\r` 三种换行。
 */
function splitRecords(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let cells: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }

    if (ch === '"' && field === '') {
      inQuotes = true
    } else if (ch === delimiter) {
      cells.push(field)
      field = ''
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i++
      cells.push(field)
      field = ''
      rows.push(cells)
      cells = []
    } else if (ch === '\n') {
      cells.push(field)
      field = ''
      rows.push(cells)
      cells = []
    } else {
      field += ch
    }
  }

  if (field !== '' || cells.length > 0) {
    cells.push(field)
    rows.push(cells)
  }

  return rows
}

/**
 * 读 `.csv`（`,`）或 `.txt`（`\t`）。
 *
 * 位置化的表：**每一列都记一条 cell（哪怕是空的）** —— 纯文本没有「单元格
 * 缺席」这回事，列的位置由分隔符个数确定，不存在 xlsx 那种错位风险。
 */
export function readDelimitedTable(bytes: Uint8Array, delimiter: ',' | '\t'): ImportedTable {
  const text = decodeTableText(bytes).replace(/^\uFEFF/, '')
  const raw = splitRecords(text, delimiter)

  const rows: TableRow[] = []
  for (let i = 0; i < raw.length; i++) {
    if (rows.length >= MAX_ITEMS_PER_BATCH) break
    rows.push({
      rowNumber: i + 1,
      cells: raw[i].map((t, c) => ({ col: c + 1, text: t })),
    })
  }

  return {
    sheetName: '',
    rows,
    totalRows: raw.length,
    truncated: raw.length > rows.length,
  }
}
