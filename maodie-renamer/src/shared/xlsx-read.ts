/**
 * 最小 xlsx 读取器 —— 只做「单工作表、按行列取文本」。P3-4 / 第 4 批。
 *
 * ── 能力边界（**必须让用户知道**，设计 §10 末段）──────────────────────
 * 只读**第一张工作表**；**不处理**合并单元格、公式的计算结果、日期格式
 * （xlsx 里日期就是一个数字序列号，本批不猜）。界面上会写这一句 ——
 * 不写的话，用户会拿一张带合并单元格的表来，然后困惑「为什么读出来是空的」。
 *
 * ── ★★ 本文件里最要紧的两条（都是「看起来对、其实全错」）───────────────
 * 1. **单元格必须按 `<c r="C5">` 的 `r` 属性定位列，不能按出现顺序数格子。**
 *    Excel **不写空的 `<c>`**：第 2 列留空时，第 3 列的内容会被数成第 2 列 ——
 *    整张表从那一行起错位，而界面上的对照表「看着挺整齐」，只是名字全错位。
 * 2. **必须支持 `xl/sharedStrings.xml`。**
 *    我们自己写 xlsx 用的是 `inlineStr`（P3-2），但**别人生成的 xlsx 几乎一定
 *    用共享字符串表** —— 不支持的话，`t="s"` 的格子读出来是 `0 / 1 / 2` 这种
 *    索引数字，**看着像文件名却全是错的**。
 *
 * 解析器是**线性扫描**（`indexOf` + 切片），不是递归下降，也不是大正则：
 * 24MB 的表也不会递归爆栈，而且没有灾难性回溯的风险（设计 §4 第 4 行）。
 */

import { MAX_ITEMS_PER_BATCH, TABLE_MAX_XML_CHARS } from './constants'
import { MD_ERROR, MdError } from './errors'
import type { ImportedTable, TableCell, TableRow } from './types'
import { zipRead, zipText, type ZipReadOptions } from './zip-read'

function unreadable(detail: string): MdError {
  return new MdError(MD_ERROR.E_TABLE_UNREADABLE, detail)
}

function tooBig(detail: string): MdError {
  return new MdError(MD_ERROR.E_TABLE_TOO_BIG, detail)
}

/* ── XML 小工具（只处理我们会遇到的那几种形态，不追求通用）────────────── */

/**
 * 反转义 XML 实体。
 *
 * ★ emoji 会以 `&#x1F600;` 这种**代理对**形式出现，所以用 `fromCodePoint`
 *   而不是 `String.fromCharCode` —— 后者会把星形字符切成两个乱码（设计 §4 第 6 行）。
 */
export function unescapeXml(s: string): string {
  if (s.indexOf('&') < 0) return s
  return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (whole, body: string) => {
    switch (body) {
      case 'amp':
        return '&'
      case 'lt':
        return '<'
      case 'gt':
        return '>'
      case 'quot':
        return '"'
      case 'apos':
        return "'"
      default: {
        const n = body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10)
        return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole
      }
    }
  })
}

/**
 * 取一个开标签里的属性值。
 *
 * 只找 `name="…"`，且要求前面是空白或标签开头 —— 否则 `t="s"` 会命中 `st="s"`
 * 这类别的属性，把类型判断整个带偏。
 */
function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag)
  return m === null ? undefined : m[1]
}

/** 判断 `<x` 后面那个字符是否说明这是个真标签（防 `<row` 命中 `<rows>`、`<t` 命中 `<tbl>`） */
function isTagStart(s: string, at: number, nameLen: number): boolean {
  const ch = s[at + nameLen]
  return ch === ' ' || ch === '>' || ch === '/' || ch === '\t' || ch === '\n' || ch === '\r'
}

/** 取形如 `<v>…</v>` 的文本内容（自闭合返回空串） */
function tagText(xml: string, tag: string): string {
  const s = xml.indexOf('<' + tag)
  if (s < 0 || !isTagStart(xml, s, tag.length + 1)) return ''
  const gt = xml.indexOf('>', s)
  if (gt < 0) return ''
  if (xml[gt - 1] === '/') return ''
  const close = xml.indexOf('</' + tag + '>', gt)
  return close < 0 ? '' : xml.slice(gt + 1, close)
}

/**
 * 把一段 XML 里**所有** `<t>…</t>` 拼起来（已反转义）。
 *
 * 为什么要「所有」：`<is>` 里的富文本会写成 `<r><t>上</t></r><r><t>下</t></r>`，
 * 只取第一个 `<t>` 就会得到一个残缺的名字 —— 而这种残缺**看着很像真的名字**。
 */
function collectT(xml: string): string {
  let out = ''
  let i = 0
  for (;;) {
    const s = xml.indexOf('<t', i)
    if (s < 0) break
    if (!isTagStart(xml, s, 2)) {
      i = s + 2
      continue
    }
    const gt = xml.indexOf('>', s)
    if (gt < 0) break
    if (xml[gt - 1] === '/') {
      i = gt + 1
      continue
    }
    const close = xml.indexOf('</t>', gt)
    if (close < 0) break
    out += xml.slice(gt + 1, close)
    i = close + 4
  }
  return unescapeXml(out)
}

/** `C5` / `AA12` → 列号（1 起）。取不到返回 null */
function colFromRef(ref: string | undefined): number | null {
  if (ref === undefined || ref === '') return null
  let n = 0
  let seen = false
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i)
    if (c >= 65 && c <= 90) {
      n = n * 26 + (c - 64)
      seen = true
    } else if (c >= 97 && c <= 122) {
      n = n * 26 + (c - 96)
      seen = true
    } else {
      break
    }
  }
  return seen ? n : null
}

function guardXml(xml: string, what: string): string {
  if (xml.length > TABLE_MAX_XML_CHARS) {
    throw tooBig(`${what}太大（${Math.round(xml.length / 1024 / 1024)}MB），读不动`)
  }
  return xml
}

/* ── 单元格 ─────────────────────────────────────────────────────────── */

/**
 * 一行 XML 里的全部单元格。
 *
 * 取值顺序照设计 §7.3 的表：`t="s"` 查共享字符串表 → `t="inlineStr"` 取 `<is><t>`
 * → `t="str"` 取 `<v>`（公式的字符串结果）→ `t="b"` 布尔 → **没有 `t`** 时 `<v>`
 * 原样当文本（数字）。
 */
function parseCells(rowXml: string, shared: string[] | null): TableCell[] {
  const cells: TableCell[] = []
  let i = 0
  let seqCol = 0

  for (;;) {
    const s = rowXml.indexOf('<c', i)
    if (s < 0) break
    if (!isTagStart(rowXml, s, 2)) {
      i = s + 2
      continue
    }
    const gt = rowXml.indexOf('>', s)
    if (gt < 0) break

    const tag = rowXml.slice(s + 2, gt)
    const selfClosing = tag.trimEnd().endsWith('/')

    let inner = ''
    let next = gt + 1
    if (!selfClosing) {
      const close = rowXml.indexOf('</c>', gt)
      if (close < 0) break
      inner = rowXml.slice(gt + 1, close)
      next = close + 4
    }

    // ★ 列号优先取 `r` 属性；取不到才退回「上一个 +1」（那种表本来就不稀疏）
    const col = colFromRef(attr(tag, 'r')) ?? seqCol + 1
    seqCol = col

    const t = attr(tag, 't')
    let text = ''
    if (t === 'inlineStr') {
      text = collectT(inner)
    } else {
      const v = tagText(inner, 'v')
      if (t === 's') {
        // ★ 共享字符串表不存在时**留空**，绝不退化成把 `3` 当文本用 ——
        //   那样读出来的是「看着像文件名」的索引数字（设计 §7.5 第 6 行）
        const idx = Number(v)
        text = Number.isInteger(idx) && idx >= 0 ? (shared?.[idx] ?? '') : ''
      } else if (t === 'b') {
        text = v === '1' || v.toLowerCase() === 'true' ? 'TRUE' : 'FALSE'
      } else {
        // `t="str"`、`t="e"`、没有 `t`（数字）—— 一律原样当文本
        text = unescapeXml(v)
      }
    }

    cells.push({ col, text })
    i = next
  }

  return cells
}

/* ── 工作表 ─────────────────────────────────────────────────────────── */

interface SheetParse {
  rows: TableRow[]
  totalRows: number
  truncated: boolean
}

function parseSheet(xml: string, shared: string[] | null): SheetParse {
  guardXml(xml, '工作表')

  const sdStart = xml.indexOf('<sheetData')
  if (sdStart < 0) return { rows: [], totalRows: 0, truncated: false }

  const sdGt = xml.indexOf('>', sdStart)
  if (sdGt < 0) return { rows: [], totalRows: 0, truncated: false }
  const sdEnd = xml.indexOf('</sheetData>', sdGt)
  // 只在这段里扫，`<rowBreaks>` 之类的兄弟节点天然被排除
  const body = sdEnd < 0 ? xml.slice(sdGt + 1) : xml.slice(sdGt + 1, sdEnd)

  const rows: TableRow[] = []
  let totalRows = 0
  let truncated = false
  let seqRow = 0
  let i = 0

  for (;;) {
    const s = body.indexOf('<row', i)
    if (s < 0) break
    if (!isTagStart(body, s, 4)) {
      i = s + 4
      continue
    }
    const gt = body.indexOf('>', s)
    if (gt < 0) break

    const tag = body.slice(s + 4, gt)
    const selfClosing = tag.trimEnd().endsWith('/')
    // 行号取 `r`；**跳号是正常的**（中间那些空行 Excel 根本不写）
    const rowNumber = Number(attr(tag, 'r')) || seqRow + 1
    seqRow = rowNumber

    let inner = ''
    let next = gt + 1
    if (!selfClosing) {
      const close = body.indexOf('</row>', gt)
      if (close < 0) break
      inner = body.slice(gt + 1, close)
      next = close + 6
    }

    totalRows++
    if (rows.length < MAX_ITEMS_PER_BATCH) {
      rows.push({ rowNumber, cells: parseCells(inner, shared) })
    } else {
      truncated = true
    }
    i = next
  }

  return { rows, totalRows, truncated }
}

/* ── 共享字符串表 ───────────────────────────────────────────────────── */

function parseSharedStrings(xml: string): string[] {
  const out: string[] = []
  const body = guardXml(xml, '共享字符串表')
  let i = 0

  for (;;) {
    const s = body.indexOf('<si', i)
    if (s < 0) break
    if (!isTagStart(body, s, 3)) {
      i = s + 3
      continue
    }
    const gt = body.indexOf('>', s)
    if (gt < 0) break
    if (body[gt - 1] === '/') {
      out.push('')
      i = gt + 1
      continue
    }
    const close = body.indexOf('</si>', gt)
    if (close < 0) break
    out.push(collectT(body.slice(gt + 1, close)))
    i = close + 5
  }

  return out
}

/* ── 工作簿 → 工作表路径 ────────────────────────────────────────────── */

interface SheetRef {
  name: string
  rid: string
}

function firstSheet(workbookXml: string): SheetRef {
  // `<sheets>` 里的**第一个** `<sheet>` 就是第一张表（顺序即显示顺序）
  const m = /<sheet\b[^>]*>/.exec(workbookXml)
  if (m === null) throw unreadable('这个工作簿里没有工作表')
  return { name: unescapeXml(attr(m[0], 'name') ?? ''), rid: attr(m[0], 'r:id') ?? '' }
}

function parseRels(xml: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /<Relationship\b[^>]*>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const id = attr(m[0], 'Id')
    const target = attr(m[0], 'Target')
    if (id !== undefined && target !== undefined) out.set(id, target)
  }
  return out
}

/**
 * 解出工作表在包里的真实路径。
 *
 * ★ 绝不能硬编码 `xl/worksheets/sheet1.xml`：另存过的表里第一张工作表可能叫
 *   `sheet3.xml`（设计 §7.5 第 7 行）。这一条错了至少是**显式失败**（读不到数据），
 *   比错位好，但仍然要修对。
 */
function resolveSheetPath(
  ref: SheetRef,
  relsXml: string | null,
  entries: Map<string, Uint8Array>,
): string {
  if (ref.rid !== '' && relsXml !== null) {
    const target = parseRels(relsXml).get(ref.rid)
    if (target !== undefined) {
      let t = target.replace(/\\/g, '/')
      if (t.startsWith('/')) t = t.slice(1)
      if (!t.startsWith('xl/')) t = `xl/${t}`
      if (entries.has(t)) return t
    }
  }

  // 回退：包里第一张 `xl/worksheets/*.xml`（按路径排序，sheet1 < sheet2 < …）
  const candidates = [...entries.keys()]
    .filter((k) => /^xl\/worksheets\/[^/]+\.xml$/.test(k))
    .sort()
  if (candidates.length > 0) return candidates[0]

  throw unreadable('这个包里找不到工作表（可能不是 xlsx）')
}

/* ── 对外入口 ───────────────────────────────────────────────────────── */

/** xlsx 读取的选项与 ZIP 读取完全一致（目前只有注入解压函数这一项） */
export type XlsxReadOptions = ZipReadOptions

/**
 * 读一个 `.xlsx`（字节）→ 一张表。
 *
 * 出错一律抛 `MdError`：`E_TABLE_UNREADABLE`（加密 / 损坏 / 不是 xlsx）
 * 或 `E_TABLE_TOO_BIG`（超过上限）。**绝不让未捕获异常冒到 IPC 之外。**
 */
export function readXlsx(bytes: Uint8Array, options: XlsxReadOptions = {}): ImportedTable {
  const entries = zipRead(bytes, options)

  const workbookXml = zipText(entries, 'xl/workbook.xml')
  if (workbookXml === null) {
    throw unreadable('这不是 Excel 工作簿（包里没有 xl/workbook.xml）')
  }

  const ref = firstSheet(guardXml(workbookXml, '工作簿'))
  const sheetPath = resolveSheetPath(ref, zipText(entries, 'xl/_rels/workbook.xml.rels'), entries)

  const sheetXml = zipText(entries, sheetPath)
  if (sheetXml === null) throw unreadable(`包里缺少工作表文件（${sheetPath}）`)

  const sharedXml = zipText(entries, 'xl/sharedStrings.xml')
  const shared = sharedXml === null ? null : parseSharedStrings(sharedXml)

  const parsed = parseSheet(sheetXml, shared)

  return {
    sheetName: ref.name,
    rows: parsed.rows,
    totalRows: parsed.totalRows,
    truncated: parsed.truncated,
  }
}
