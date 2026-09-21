/**
 * 最小 xlsx 生成器。P3-2 / 第 2 批。
 *
 * ── 只支持什么（刻意的最小集）────────────────────────────────────────
 * · 单工作表；· 纯文本单元格；· **内联字符串**（`inlineStr`）；
 * · 无样式、无公式、无合并单元格、无冻结、无列宽。
 *
 * ── 为什么用 inlineStr 而不是 sharedStrings ──────────────────────────
 * sharedStrings 要多一个部件（`xl/sharedStrings.xml`）+ 一张索引表
 * + 一处 `[Content_Types].xml` 的 Override。少一个部件 = 少一处
 * 「Word/Excel 报文件损坏、而我们的单测全绿」的可能。清单只有几 KB，
 * 省下的那点体积换不来任何东西。
 *
 * ── 为什么零样式是**安全**的 ─────────────────────────────────────────
 * Excel **默认显示浅色网格线**，所以不做边框也分得清行列。
 * （Word 那档就不行 —— 见 `docx-write.ts` 里的对照说明。）
 *
 * ★ `<t xml:space="preserve">` 不能省：清单里的文件名可能有首尾空格
 *   （`report .txt`）。OOXML 的 `<t>` 默认会**折叠首尾空白**，
 *   不加这个属性，导出清单上的名字就和屏幕上看到的不是逐字节相等，
 *   而 TC-52 要的就是逐字节相等。
 *
 * ⚠️ 不 import electron / fs / path —— 纯函数，可直接 `node --test`。
 */

import { xmlEscape } from './xml-escape'
import { zipStore } from './zip-write'

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

const NS_CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** 工作表名。不含 `: \ / ? * [ ]` 且 ≤ 31 字符，合法 */
const SHEET_NAME = '清单'

/**
 * 列序号 → 列名：1 → `A`、26 → `Z`、27 → `AA`、702 → `ZZ`、703 → `AAA`。
 *
 * ★ 与 P3-1「字母编号」用的是**同一套进位规则**（Excel 列标），
 *   所以这里顺手也把边界都覆盖在单测里。
 */
export function columnName(n: number): string {
  let s = ''
  let v = n
  while (v > 0) {
    const r = (v - 1) % 26
    s = String.fromCharCode(65 + r) + s
    v = Math.floor((v - 1) / 26)
  }
  return s
}

function contentTypesXml(): string {
  return (
    XML_DECL +
    `<Types xmlns="${NS_CT}">` +
    // rels / xml 两个默认扩展名覆盖所有部件，其余需要 Override 点名
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `</Types>`
  )
}

function rootRelsXml(): string {
  return (
    XML_DECL +
    `<Relationships xmlns="${NS_PKG_REL}">` +
    `<Relationship Id="rId1" Type="${NS_DOC_REL}/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`
  )
}

function workbookXml(): string {
  return (
    XML_DECL +
    `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_DOC_REL}">` +
    `<sheets><sheet name="${xmlEscape(SHEET_NAME)}" sheetId="1" r:id="rId1"/></sheets>` +
    `</workbook>`
  )
}

function workbookRelsXml(): string {
  return (
    XML_DECL +
    `<Relationships xmlns="${NS_PKG_REL}">` +
    `<Relationship Id="rId1" Type="${NS_DOC_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
    `</Relationships>`
  )
}

function sheetXml(rows: string[][]): string {
  const body = rows
    .map((cells, r) => {
      const rowNo = r + 1
      const cs = cells
        .map((v, c) => {
          const ref = `${columnName(c + 1)}${rowNo}`
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`
        })
        .join('')
      return `<row r="${rowNo}">${cs}</row>`
    })
    .join('')

  const maxCols = Math.max(1, ...rows.map((r) => r.length))
  const maxRows = Math.max(1, rows.length)
  const dimension = `A1:${columnName(maxCols)}${maxRows}`

  return (
    XML_DECL +
    `<worksheet xmlns="${NS_MAIN}">` +
    `<dimension ref="${dimension}"/>` +
    `<sheetData>${body}</sheetData>` +
    `</worksheet>`
  )
}

/**
 * 把二维字符串数组写成 xlsx 字节。
 *
 * `rows[0]` 就是表头行（调用方负责给，本函数不区分表头与数据 —— 零样式，
 * 所以也没有「表头加粗」这回事）。
 */
export function xlsxWrite(rows: string[][]): Uint8Array {
  return zipStore([
    { path: '[Content_Types].xml', content: contentTypesXml() },
    { path: '_rels/.rels', content: rootRelsXml() },
    { path: 'xl/workbook.xml', content: workbookXml() },
    { path: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml() },
    { path: 'xl/worksheets/sheet1.xml', content: sheetXml(rows) },
  ])
}
