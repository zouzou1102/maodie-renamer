/**
 * 最小 docx 生成器。P3-2 / 第 2 批。
 *
 * ── 只支持什么 ───────────────────────────────────────────────────────
 * 单表格、纯文本单元格、**表格边框（单线 0.5pt）+ 表头加粗 + 表头跨页重复**。
 * 无页眉页脚、无图片、无目录、无页码。
 *
 * ── ★ 为什么这一档必须用「真表格 + 边框」，而 xlsx 那档可以零样式 ────
 * 三条理由（设计 §3.3 末尾）：
 * 1. 用段落排，各列**对不齐**，打印出来是一团；
 * 2. **Word 里的无边框表格，打印出来一根线都没有**，收表的人分不清哪列是哪列。
 *    ——注意这与 Excel 不同：**Excel 默认显示浅色网格线**，所以 `.xlsx`
 *    那档坚持「零样式」是安全的，这里不行；
 * 3. 这是本批唯一一处主动破「零样式」的地方，破得有理由：**不加就不可读**。
 *    样式只用两个属性（边框、加粗），不碰字体与颜色。
 *
 * ── ★ `<w:tblHeader/>` 与 `<w:t xml:space="preserve">` ───────────────
 * · 前者加在表头行上 → 超过一页时**表头在每页重复**（清单常常不止一页）；
 * · 后者不加 → **文件名首尾的空格会被 Word 吃掉**（`report .txt` 里的空格
 *   就没了）。这种差异只有把两份清单**并排看**才发现，必须靠单测钉死。
 *
 * ── ★★ 本文件最容易致命的一处 ────────────────────────────────────────
 * `[Content_Types].xml` 里漏写 `word/document.xml` 的 `Override`，
 * **Word 会直接报「文件已损坏，无法打开」**；而我们的单测（只校验 ZIP 结构与
 * XML 合法性）**全绿**。所以单测里有一条专门的断言：把 Override 列表与
 * zip 里**实际存在的部件逐个比对**。见设计 §7.5 第 7 行 / TC-55。
 *
 * ── 列宽为什么用百分比 ───────────────────────────────────────────────
 * `w:type="pct"`（单位是 1/50 百分比，5000 = 100%）+ 表格宽度 100%
 * → **不需要知道页面尺寸**，也就不必处理 A4 / Letter / 用户自定义页边距的差异。
 * 规则：序号列固定 8%，其余列等分剩下的 92%。
 * （`<w:tblGrid>` 里的 `w:gridCol` 仍按 A4 正文宽 ~9000 twips 给一个近似值，
 *   只是给不支持百分比宽度的老工具兜底。）
 *
 * ⚠️ 不 import electron / fs / path —— 纯函数，可直接 `node --test`。
 */

import { xmlEscape } from './xml-escape'
import { zipStore } from './zip-write'

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

const NS_CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const NS_DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** 100% —— `w:type="pct"` 的单位是 1/50 百分比 */
const PCT_TOTAL = 5000
/** 序号列固定 8%（8 × 50）*/
const PCT_FIRST = 400
/** A4 正文净宽（twips）的近似值，仅用于 `w:gridCol` 兜底 */
const GRID_TOTAL = 9000

/** 单线 0.5pt —— `w:sz` 的单位是 1/8 pt，4 / 8 = 0.5pt */
const BORDER_SZ = 4

function contentTypesXml(): string {
  return (
    XML_DECL +
    `<Types xmlns="${NS_CT}">` +
    // `.rels` 与 `.xml` 由 Default 兜住；**正文与样式表必须显式 Override**
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    `</Types>`
  )
}

function rootRelsXml(): string {
  return (
    XML_DECL +
    `<Relationships xmlns="${NS_PKG_REL}">` +
    `<Relationship Id="rId1" Type="${NS_DOC_REL}/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`
  )
}

function documentRelsXml(): string {
  return (
    XML_DECL +
    `<Relationships xmlns="${NS_PKG_REL}">` +
    `<Relationship Id="rId1" Type="${NS_DOC_REL}/styles" Target="styles.xml"/>` +
    `</Relationships>`
  )
}

/**
 * 最小样式表。
 * Word **缺了 `styles.xml` 会挑毛病**，所以必须有这个部件；
 * 但内容可以只是一个空的 `docDefaults`（`<w:b/>` 是 run 级直接格式，不依赖样式）。
 */
function stylesXml(): string {
  return (
    XML_DECL +
    `<w:styles xmlns:w="${NS_W}">` +
    `<w:docDefaults><w:rPrDefault><w:rPr/></w:rPrDefault><w:pPrDefault><w:pPr/></w:pPrDefault></w:docDefaults>` +
    `</w:styles>`
  )
}

/** 六条边框：四条外框 + 两条内线，缺一条就会出现「某处没线」*/
function bordersXml(): string {
  const one = (tag: string) =>
    `<w:${tag} w:val="single" w:sz="${BORDER_SZ}" w:space="0" w:color="auto"/>`
  return (
    `<w:tblBorders>` +
    one('top') +
    one('left') +
    one('bottom') +
    one('right') +
    one('insideH') +
    one('insideV') +
    `</w:tblBorders>`
  )
}

/** 每列的宽度（`w:tcW` 的 pct 值）与 `w:gridCol` 的 twips 值 */
function columnWidths(colCount: number): { pct: number[]; grid: number[] } {
  if (colCount <= 0) return { pct: [], grid: [] }
  if (colCount === 1) return { pct: [PCT_TOTAL], grid: [GRID_TOTAL] }

  const restCount = colCount - 1
  const restPct = Math.floor((PCT_TOTAL - PCT_FIRST) / restCount)
  const restGrid = Math.floor((GRID_TOTAL - Math.round((GRID_TOTAL * PCT_FIRST) / PCT_TOTAL)) / restCount)
  const firstGrid = Math.round((GRID_TOTAL * PCT_FIRST) / PCT_TOTAL)

  return {
    pct: [PCT_FIRST, ...Array(restCount).fill(restPct)],
    grid: [firstGrid, ...Array(restCount).fill(restGrid)],
  }
}

function cellXml(text: string, widthPct: number, bold: boolean): string {
  // 空文本给一个空段落，避免出现「空的 <w:t>」（某些校验器会抱怨）
  const para =
    text === ''
      ? `<w:p/>`
      : `<w:p><w:r>${bold ? `<w:rPr><w:b/></w:rPr>` : ''}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`
  return `<w:tc><w:tcPr><w:tcW w:w="${widthPct}" w:type="pct"/></w:tcPr>${para}</w:tc>`
}

function tableXml(rows: string[][]): string {
  const colCount = Math.max(1, ...rows.map((r) => r.length))
  const { pct, grid } = columnWidths(colCount)

  const gridXml = `<w:tblGrid>${grid.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`

  const trXml = rows
    .map((cells, r) => {
      const isHeader = r === 0
      // ★ 表头行跨页重复；数据行不加（加了会变成每页重复所有行）
      const trPr = isHeader ? `<w:trPr><w:tblHeader/></w:trPr>` : ''
      const tcs = Array.from({ length: colCount }, (_, c) =>
        cellXml(cells[c] ?? '', pct[c] ?? pct[0], isHeader),
      ).join('')
      return `<w:tr>${trPr}${tcs}</w:tr>`
    })
    .join('')

  return (
    `<w:tbl>` +
    `<w:tblPr><w:tblW w:w="${PCT_TOTAL}" w:type="pct"/>${bordersXml()}</w:tblPr>` +
    gridXml +
    trXml +
    `</w:tbl>`
  )
}

function documentXml(rows: string[][]): string {
  return (
    XML_DECL +
    `<w:document xmlns:w="${NS_W}">` +
    `<w:body>` +
    tableXml(rows) +
    // 表格后面留一个空段落：Word 里「表格紧贴文档末尾」时不好继续输入，
    // 且部分版本对这种情况会做多余的规范化处理。
    `<w:p/>` +
    `</w:body>` +
    `</w:document>`
  )
}

/**
 * 把二维字符串数组写成 docx 字节。
 *
 * `rows[0]` 是**表头行**：会被加粗并设为跨页重复；其余行按普通单元格输出。
 * 每行不足列数时补空单元格（保证 `w:tblGrid` 与每行 `w:tc` 数一致 ——
 * 不一致的表格 Word 会按自己理解去修，列就串了）。
 */
export function docxWrite(rows: string[][]): Uint8Array {
  return zipStore([
    { path: '[Content_Types].xml', content: contentTypesXml() },
    { path: '_rels/.rels', content: rootRelsXml() },
    { path: 'word/document.xml', content: documentXml(rows) },
    { path: 'word/_rels/document.xml.rels', content: documentRelsXml() },
    { path: 'word/styles.xml', content: stylesXml() },
  ])
}
