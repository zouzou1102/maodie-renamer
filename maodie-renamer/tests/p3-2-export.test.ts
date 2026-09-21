/**
 * P3-2（提取文件名 → 导出清单）—— 单测。
 *
 * 运行：`npm run test:core`（**必须显式传本文件**，见 package.json 的 test:core；
 * 漏登记 = 写了却永远不会跑，P2-C 的 `p2c-guide.test.ts` 踩过这处）。
 *
 * 这个文件盯九件事（对应设计 §10 的测试要求）：
 *  1. **CRC32 向量**（`''` / `'a'` / `'123456789'` 三条已知值）—— ZIP 最容易写错的字段。
 *  2. **ZIP 三处签名 + EOCD 条目数 + 中央目录的 localOff**：靠自带的最小读取器
 *     `readZipEntries()` 反读一遍（写错偏移就会读不出来）。
 *  3. XML 转义五字符 + **替换顺序**（`&` 必须先换，否则 `&lt;` 会被二次转义）。
 *  4. **xlsx**：`inlineStr` / `xml:space="preserve"` / emoji 单元格不炸 / 列名进位。
 *  5. ★ **docx 的 `[Content_Types].xml` Override 与 zip 里实际部件双向比对** ——
 *     这是本批唯一「我们的单测全绿、而用户那边 Word 报文件已损坏」的风险点（§7.5 第 7 行）。
 *  6. docx：`w:tbl` / `w:tr` / `w:tc` 标签配平、表头 `<w:tblHeader/>` 存在、含首尾空格的文本带 preserve。
 *  7. **CSV / TXT**：逗号包引号、`"` 双写、**开头 3 字节 = EF BB BF**、列数恒定。
 *  8. **`exportRows`**：范围「全部 / 仅选中」、列的取舍、状态走 `labels.ts` 的同一份词。
 *  9. ★ **TC-52 预览 ≡ 导出**：导出内容里的新名列与 `items[].newName` **逐字节相等**。
 *
 * 规矩同前：只用 `node:test` + `node:assert`，不引入任何第三方框架。
 * 红线：**绝不为让测试变绿而放宽 / 跳过 / 删断言。**
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { crc32, zipStore } from '../src/shared/zip-write'
import { columnName, xlsxWrite } from '../src/shared/xlsx-write'
import { docxWrite } from '../src/shared/docx-write'
import { EXPORT_EXT, buildExportContent, csvCell } from '../src/shared/export-format'
import { buildExportTable, suggestExportName, type ExportColumn } from '../src/shared/export-rows'
import { sanitizeExport } from '../src/shared/sanitize-export'
import { xmlEscape } from '../src/shared/xml-escape'
import { ITEM_STATUS_LABEL } from '../src/shared/labels'
import type { FileItem, ItemStatus } from '../src/shared/types'

const ROOT = process.cwd()
assert.ok(
  fs.existsSync(path.join(ROOT, 'package.json')),
  `单测必须在工程根目录下运行（当前 cwd = ${ROOT}）—— 用 npm run test:core`,
)

const dec = new TextDecoder()

/* ══ 测试辅助 ══════════════════════════════════════════════════════════ */

/** 构造一个列表项（只填测试关心的字段，其余给安全的默认值）*/
function mkItem(p: Partial<FileItem> & { name: string; newName: string }): FileItem {
  const stem = p.name.replace(/\.[^.]+$/, '')
  const ext = p.name.slice(stem.length)
  return {
    id: p.id ?? p.name,
    fullPath: p.fullPath ?? `C:\\素材\\${p.name}`,
    dirPath: p.dirPath ?? 'C:\\素材',
    name: p.name,
    stem: p.stem ?? stem,
    ext: p.ext ?? ext,
    isDir: p.isDir ?? false,
    isSymlink: p.isSymlink ?? false,
    newStem: p.newStem ?? p.newName.replace(/\.[^.]+$/, ''),
    newName: p.newName,
    status: p.status ?? 'changed',
    ...(p.conflictKind === undefined ? {} : { conflictKind: p.conflictKind }),
    ...(p.reason === undefined ? {} : { reason: p.reason }),
    ...(p.reasonCode === undefined ? {} : { reasonCode: p.reasonCode }),
    ...(p.diffRange === undefined ? {} : { diffRange: p.diffRange }),
    ...(p.resolvedName === undefined ? {} : { resolvedName: p.resolvedName }),
  }
}

/**
 * 一个**只够用**的 ZIP 读取器（store 方式）。
 *
 * 为什么测试里要它：设计 §10 要求把 `.docx` 的 `[Content_Types].xml` 里的
 * Override 列表与 zip 里**实际存在的部件逐个比对**。不能只断言「打包函数没抛错」——
 * 那样漏写 Override 时测试照样全绿，而用户那边 Word 会报「文件已损坏」。
 *
 * 顺带它还验证了中央目录里 `localOff` 字段写得对不对：写错了这里会读不出来。
 */
function readZipEntries(buf: Uint8Array): Array<{ name: string; data: string; crc: number }> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

  // ① EOCD 在文件尾部（无注释时正好是最末 22 字节），从后往前扫签名
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  assert.ok(eocd >= 0, 'EOCD（PK\\x05\\x06）未找到')

  const count = dv.getUint16(eocd + 10, true)
  const cdStart = dv.getUint32(eocd + 16, true)

  const out: Array<{ name: string; data: string; crc: number }> = []
  let off = cdStart
  for (let i = 0; i < count; i++) {
    assert.equal(dv.getUint32(off, true), 0x02014b50, `第 ${i} 条中央目录头签名不对`)
    const nameLen = dv.getUint16(off + 28, true)
    const extraLen = dv.getUint16(off + 30, true)
    const commentLen = dv.getUint16(off + 32, true)
    const crc = dv.getUint32(off + 16, true)
    const localOff = dv.getUint32(off + 42, true)
    const name = dec.decode(buf.subarray(off + 46, off + 46 + nameLen))

    assert.equal(dv.getUint32(localOff, true), 0x04034b50, `${name} 的本地头签名不对`)
    const lNameLen = dv.getUint16(localOff + 26, true)
    const lExtraLen = dv.getUint16(localOff + 28, true)
    const size = dv.getUint32(localOff + 18, true) // 压缩后大小（store 时 = 原始大小）
    const dataStart = localOff + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(dataStart, dataStart + size)

    // 校验 CRC 与大小 —— 写错 CRC 只有解压时才会报错，必须在这里钉死
    assert.equal(crc32(raw), crc, `${name} 的 CRC32 与实际数据不符`)

    out.push({ name, data: dec.decode(raw), crc })
    off += 46 + nameLen + extraLen + commentLen
  }
  return out
}

function partOf(bytes: Uint8Array, name: string): string {
  const e = readZipEntries(bytes).find((x) => x.name === name)
  assert.ok(e, `zip 里没有部件 ${name}`)
  return e!.data
}

/* ══ 1. CRC32 向量 ════════════════════════════════════════════════════ */

test('CRC32：三条公开已知向量', () => {
  const enc = new TextEncoder()
  assert.equal(crc32(enc.encode('')), 0x00000000)
  assert.equal(crc32(enc.encode('a')), 0xe8b7be43)
  // 这一条是 CRC32 的经典测试向量（RFC 1952 / 各实现都用它）
  assert.equal(crc32(enc.encode('123456789')), 0xcbf43926)
})

test('CRC32：返回无符号整数（> 0x7fffffff 时不能变负数）', () => {
  const enc = new TextEncoder()
  const v = crc32(enc.encode('123456789'))
  assert.ok(v >= 0, `CRC 不应为负：${v}`)
  assert.equal(v, 0xcbf43926)
})

/* ══ 2. ZIP 结构 ══════════════════════════════════════════════════════ */

test('ZIP：三处签名都在，EOCD 条目数正确，帧内数据可按中央目录读回', () => {
  const entries = [
    { path: '[Content_Types].xml', content: '<Types/>' },
    { path: 'a/b.xml', content: '你好 hello' },
  ]
  const bytes = zipStore(entries)

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  assert.equal(dv.getUint32(0, true), 0x04034b50, '文件开头必须是本地头签名 PK\\x03\\x04')

  const back = readZipEntries(bytes) // 内部会断言中央目录头与本地头签名
  assert.equal(back.length, 2)
  assert.deepEqual(
    back.map((x) => x.name),
    ['[Content_Types].xml', 'a/b.xml'],
  )
  assert.equal(back[1].data, '你好 hello', 'UTF-8 内容必须原样往返')

  // EOCD 末尾的「总条目数」
  const eocd = bytes.length - 22
  assert.equal(dv.getUint32(eocd, true), 0x06054b50, '文件末尾必须是 EOCD 签名 PK\\x05\\x06')
  assert.equal(dv.getUint16(eocd + 8, true), 2, '本磁盘条目数')
  assert.equal(dv.getUint16(eocd + 10, true), 2, '总条目数')
})

test('ZIP：记录的时间戳是固定值（同一输入产出同一字节，产物可复现）', () => {
  const a = zipStore([{ path: 'x.xml', content: 'v' }])
  const b = zipStore([{ path: 'x.xml', content: 'v' }])
  assert.deepEqual(Array.from(a), Array.from(b))
  const dv = new DataView(a.buffer, a.byteOffset, a.byteLength)
  assert.equal(dv.getUint16(10, true), 0, '时间字段恒为 0')
  assert.equal(dv.getUint16(12, true), 0x0021, '日期字段恒为 1980-01-01')
})

/* ══ 3. XML 转义 ══════════════════════════════════════════════════════ */

test('XML 转义：五个预定义实体都换掉', () => {
  assert.equal(xmlEscape('&'), '&amp;')
  assert.equal(xmlEscape('<'), '&lt;')
  assert.equal(xmlEscape('>'), '&gt;')
  assert.equal(xmlEscape('"'), '&quot;')
  assert.equal(xmlEscape("'"), '&apos;')
})

test('XML 转义：& 必须先换（否则 &lt; 会被二次转义成 &amp;lt;）', () => {
  // 这一条只在「列表里真有 < 或 &」时才可能出问题，平时测不出来
  assert.equal(xmlEscape('a<b'), 'a&lt;b')
  assert.equal(xmlEscape('a&b'), 'a&amp;b')
  assert.equal(xmlEscape('<&>'), '&lt;&amp;&gt;')
  assert.equal(xmlEscape('&lt;'), '&amp;lt;') // 字面量 &lt; 要变成 &amp;lt;
})

test('XML 转义：emoji 与中文原样保留（增补平面字符 XML 1.0 允许）', () => {
  assert.equal(xmlEscape('🎉报告'), '🎉报告')
  assert.equal(xmlEscape('中文'), '中文')
})

/* ══ 4. xlsx ══════════════════════════════════════════════════════════ */

test('xlsx：列名进位（1→A、26→Z、27→AA、702→ZZ、703→AAA）', () => {
  assert.equal(columnName(1), 'A')
  assert.equal(columnName(26), 'Z')
  assert.equal(columnName(27), 'AA')
  assert.equal(columnName(52), 'AZ')
  assert.equal(columnName(702), 'ZZ')
  assert.equal(columnName(703), 'AAA')
})

test('xlsx：五个部件齐全，工作表用 inlineStr 且带 xml:space="preserve"', () => {
  const bytes = xlsxWrite([
    ['序号', '原名'],
    ['1', 'report .txt'],
  ])
  const names = readZipEntries(bytes).map((e) => e.name)
  assert.deepEqual(names.sort(), [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/_rels/workbook.xml.rels',
    'xl/workbook.xml',
    'xl/worksheets/sheet1.xml',
  ].sort())

  const sheet = partOf(bytes, 'xl/worksheets/sheet1.xml')
  assert.ok(sheet.includes('t="inlineStr"'), '必须用内联字符串（少一个部件、少一处出错）')
  // ★ 不加 preserve，单元格文本的首尾空格会被折叠 → 清单上的名字与屏幕上的不等
  assert.ok(sheet.includes('<t xml:space="preserve">'), '<t> 必须带 xml:space="preserve"')
  assert.ok(sheet.includes('report .txt'), '带空格的文件名要原样落进去')
  assert.ok(sheet.includes('<dimension ref="A1:B2"/>'))
})

test('xlsx：emoji / 生僻字单元格不炸，且能被读回', () => {
  const bytes = xlsxWrite([['🎉报告.txt', '𝕏𝕐']])
  const sheet = partOf(bytes, 'xl/worksheets/sheet1.xml')
  assert.ok(sheet.includes('🎉报告.txt'))
  assert.ok(sheet.includes('𝕏𝕐'))
})

test('xlsx：[Content_Types].xml 的 Override 与真实部件一致', () => {
  const bytes = xlsxWrite([['a']])
  const parts = readZipEntries(bytes).map((e) => e.name)
  const ct = partOf(bytes, '[Content_Types].xml')
  const overrides: string[] = Array.from(ct.matchAll(/<Override PartName="\/([^"]+)"/g)).map(
    (m) => m[1],
  )

  for (const o of overrides) {
    assert.ok(parts.includes(o), `Override 指向的部件 ${o} 在 zip 里不存在`)
  }
  for (const p of parts) {
    if (p === '[Content_Types].xml' || p.endsWith('.rels')) continue
    assert.ok(overrides.includes(p), `部件 ${p} 没有 Override 声明`)
  }
})

/* ══ 5. docx（本批风险最高的一档）═════════════════════════════════════ */

test('docx：五个部件齐全', () => {
  const bytes = docxWrite([['序号', '原名'], ['1', 'a.txt']])
  const names = readZipEntries(bytes).map((e) => e.name)
  assert.deepEqual(names.sort(), [
    '[Content_Types].xml',
    '_rels/.rels',
    'word/_rels/document.xml.rels',
    'word/document.xml',
    'word/styles.xml',
  ].sort())
})

test('docx：★ [Content_Types].xml 的 Override 与 zip 里实际部件**双向**比对', () => {
  // ★★ 设计 §7.5 第 7 行点名的风险：漏写 word/document.xml 的 Override，
  //    **Word 会直接报「文件已损坏，无法打开」**，而只看 ZIP 结构与 XML 合法性的
  //    单测**全绿**。所以这里必须双向比：Override → 部件、部件 → Override。
  const bytes = docxWrite([['序号'], ['1']])
  const parts = readZipEntries(bytes).map((e) => e.name)
  const ct = partOf(bytes, '[Content_Types].xml')
  const overrides: string[] = Array.from(ct.matchAll(/<Override PartName="\/([^"]+)"/g)).map(
    (m) => m[1],
  )

  assert.ok(
    overrides.includes('word/document.xml'),
    'word/document.xml 必须有 Override —— 漏了 Word 会报「文件已损坏」',
  )
  assert.ok(overrides.includes('word/styles.xml'), 'word/styles.xml 必须有 Override')

  for (const o of overrides) {
    assert.ok(parts.includes(o), `Override 指向的部件 ${o} 在 zip 里不存在`)
  }
  for (const p of parts) {
    if (p === '[Content_Types].xml' || p.endsWith('.rels')) continue
    assert.ok(overrides.includes(p), `部件 ${p} 没有 Override 声明`)
  }
})

test('docx：w:tbl / w:tr / w:tc 开闭标签数配平', () => {
  const rows = [
    ['序号', '原名', '新名'],
    ['1', 'a.txt', '1-a.txt'],
    ['2', 'b.txt', '2-b.txt'],
  ]
  const xml = partOf(docxWrite(rows), 'word/document.xml')

  const count = (re: RegExp): number => (xml.match(re) ?? []).length
  assert.equal(count(/<w:tbl>/g), count(/<\/w:tbl>/g), 'w:tbl 开闭不配平')
  assert.equal(count(/<w:tr>/g), count(/<\/w:tr>/g), 'w:tr 开闭不配平')
  assert.equal(count(/<w:tc>/g), count(/<\/w:tc>/g), 'w:tc 开闭不配平')

  // 行数 × 列数：每行都必须有**同样多**的单元格，否则 Word 会按自己的理解去修，列就串了
  assert.equal(count(/<w:tr>/g), rows.length)
  assert.equal(count(/<w:tc>/g), rows.length * rows[0].length)
})

test('docx：表头行有 <w:tblHeader/>（跨页重复），数据行没有', () => {
  const xml = partOf(docxWrite([['序号', '原名'], ['1', 'a.txt']]), 'word/document.xml')
  assert.equal((xml.match(/<w:tblHeader\/>/g) ?? []).length, 1, '只该出现在表头行')
})

test('docx：表头加粗，且只有表头加粗', () => {
  const xml = partOf(docxWrite([['序号'], ['1']]), 'word/document.xml')
  assert.ok(xml.includes('<w:b/>'), '表头必须加粗')
  // 只有一个 <w:b/> —— 数据行不该加粗
  assert.equal((xml.match(/<w:b\/>/g) ?? []).length, 1)
})

test('docx：★ 含首尾空格的文本带 xml:space="preserve"（否则 Word 会吃掉空格）', () => {
  const xml = partOf(docxWrite([['序号', '原名'], ['1', ' report .txt ']]), 'word/document.xml')
  assert.ok(xml.includes('<w:t xml:space="preserve"> report .txt </w:t>'))
})

test('docx：六条边框都在（无边框表格打印出来一根线都没有）', () => {
  const xml = partOf(docxWrite([['a']]), 'word/document.xml')
  for (const t of ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']) {
    assert.ok(xml.includes(`<w:${t} w:val="single"`), `缺边框 ${t}`)
  }
  assert.ok(xml.includes('w:sz="4"'), '边框粗细应是 4（= 0.5pt）')
})

test('docx：表格宽度用百分比（不依赖页面尺寸）', () => {
  const xml = partOf(docxWrite([['a', 'b']]), 'word/document.xml')
  assert.ok(xml.includes('<w:tblW w:w="5000" w:type="pct"/>'), '表格宽 100%')
  assert.ok(xml.includes('<w:tcW w:w="400" w:type="pct"/>'), '序号列 8%')
})

test('docx：XML 转义（文件名里的 < & 不会被当成标签）', () => {
  const xml = partOf(docxWrite([['a<b&c.txt']]), 'word/document.xml')
  assert.ok(xml.includes('a&lt;b&amp;c.txt'))
  assert.ok(!xml.includes('<w:t xml:space="preserve">a<b'))
})

/* ══ 6. CSV / TXT ═════════════════════════════════════════════════════ */

test('CSV：含逗号 / 引号的单元格按 RFC 4180 转义', () => {
  assert.equal(csvCell('a,b.txt'), '"a,b.txt"')
  assert.equal(csvCell('say "hi".txt'), '"say ""hi"".txt"')
  assert.equal(csvCell('a;b.txt'), '"a;b.txt"')
  assert.equal(csvCell('普通.txt'), '普通.txt')
})

test('CSV：开头 3 字节是 UTF-8 BOM（EF BB BF）', () => {
  // ★ 硬要求：没有 BOM，中文 Windows 上的 Excel 会按本地 ANSI 猜 → 整张表乱码。
  //   而这一条**只在用户那边看得出来**，开发机上用 VS Code 打开是好的。
  const bytes = buildExportContent('csv', [['序号', '原名'], ['1', '报告.txt']])
  assert.deepEqual(Array.from(bytes.subarray(0, 3)), [0xef, 0xbb, 0xbf])
})

test('TXT：开头 3 字节是 BOM，且用 Tab 分隔、CRLF 换行', () => {
  const bytes = buildExportContent('txt', [
    ['序号', '原名'],
    ['1', 'a.txt'],
  ])
  assert.deepEqual(Array.from(bytes.subarray(0, 3)), [0xef, 0xbb, 0xbf])
  const text = dec.decode(bytes.subarray(3))
  assert.equal(text, '序号\t原名\r\n1\ta.txt')
})

test('CSV：行数 = 项数 + 1（表头），且每行列数恒定', () => {
  const table = [
    ['序号', '原名', '新名'],
    ['1', 'a,b.txt', '1-a,b.txt'],
    ['2', 'c.txt', '2-c.txt'],
  ]
  const text = dec.decode(buildExportContent('csv', table).subarray(3))
  const lines = text.split('\r\n')
  assert.equal(lines.length, 3, '2 项 + 1 行表头')
  // 逐行按 CSV 规则数「顶层逗号」是另一套解析，这里直接断言转义后的原文
  assert.equal(lines[0], '序号,原名,新名')
  assert.equal(lines[1], '1,"a,b.txt","1-a,b.txt"')
})

test('四种格式都能产出非空字节，且扩展名齐全', () => {
  const table = [
    ['序号', '原名'],
    ['1', 'a.txt'],
  ]
  for (const f of ['xlsx', 'txt', 'csv', 'docx'] as const) {
    const bytes = buildExportContent(f, table)
    // 只要求「非空」—— txt 只有几十字节是正常的，别用随手写的魔数阈值
    assert.ok(bytes.length > 0, `${f} 产出了 0 字节`)
  }
  assert.deepEqual(EXPORT_EXT, { xlsx: '.xlsx', txt: '.txt', csv: '.csv', docx: '.docx' })
})

/* ══ 7. exportRows：范围与列的取舍 ════════════════════════════════════ */

const SAMPLE: FileItem[] = [
  mkItem({ id: 'a', name: '报告.txt', newName: '1-报告.txt', status: 'changed' }),
  mkItem({ id: 'b', name: '照片.jpg', newName: '照片.jpg', status: 'unchanged' }),
  mkItem({ id: 'c', name: '冲突.txt', newName: '报告.txt', status: 'conflict' }),
]

test('exportRows：范围「全部」= 所有项，序号从 1 连续到 N', () => {
  const t = buildExportTable(SAMPLE, new Set(), { scope: 'all', columns: ['name', 'newName'] })
  assert.deepEqual(t.header, ['序号', '原名', '新名'])
  assert.equal(t.rows.length, 3)
  assert.deepEqual(t.rows.map((r) => r[0]), ['1', '2', '3'])
})

test('exportRows：范围「仅选中项」只含选中项，且序号重新从 1 开始', () => {
  const t = buildExportTable(SAMPLE, new Set(['c']), { scope: 'selected', columns: ['name'] })
  assert.equal(t.rows.length, 1)
  assert.deepEqual(t.rows[0], ['1', '冲突.txt'])
})

test('exportRows：不勾「所在文件夹」时该列**整列不出现**（不是空列）', () => {
  const t = buildExportTable(SAMPLE, new Set(), { scope: 'all', columns: ['name'] })
  assert.ok(!t.header.includes('所在文件夹'))
  assert.ok(t.rows.every((r) => r.length === t.header.length))
})

test('exportRows：勾上「所在文件夹」时列出现且有值', () => {
  const t = buildExportTable(SAMPLE, new Set(), {
    scope: 'all',
    columns: ['name', 'dirPath'],
  })
  assert.deepEqual(t.header, ['序号', '原名', '所在文件夹'])
  assert.equal(t.rows[0][2], 'C:\\素材')
})

test('exportRows：列的先后顺序恒按固定顺序，与勾选顺序无关', () => {
  const a = buildExportTable(SAMPLE, new Set(), {
    scope: 'all',
    columns: ['dirPath', 'status', 'name'] as ExportColumn[],
  })
  const b = buildExportTable(SAMPLE, new Set(), {
    scope: 'all',
    columns: ['name', 'status', 'dirPath'] as ExportColumn[],
  })
  assert.deepEqual(a.header, b.header)
  assert.deepEqual(a.header, ['序号', '原名', '状态', '所在文件夹'])
})

test('exportRows：状态列走 labels.ts 的同一份词（不另抄一份中文）', () => {
  const t = buildExportTable(SAMPLE, new Set(), { scope: 'all', columns: ['status'] })
  assert.deepEqual(
    t.rows.map((r) => r[1]),
    SAMPLE.map((i) => ITEM_STATUS_LABEL[i.status]),
  )
  // 界面上状态是这五个词，清单里必须是同一批
  const all: ItemStatus[] = ['pending', 'unchanged', 'changed', 'conflict', 'invalid']
  for (const s of all) assert.ok(ITEM_STATUS_LABEL[s].length > 0)
})

test('exportRows：列表为空 / 一项都没选中 → rows 为空（由主进程拒绝落盘）', () => {
  assert.deepEqual(buildExportTable([], new Set(), { scope: 'all', columns: ['name'] }).rows, [])
  assert.deepEqual(
    buildExportTable(SAMPLE, new Set(), { scope: 'selected', columns: ['name'] }).rows,
    [],
  )
})

test('exportRows：建议文件名带日期与对应扩展名', () => {
  assert.equal(suggestExportName('xlsx', '2026-09-21'), '文件名清单-2026-09-21.xlsx')
  assert.equal(suggestExportName('docx', '2026-09-21'), '文件名清单-2026-09-21.docx')
})

/* ══ 8. sanitizeExport：逐字段白名单 ══════════════════════════════════ */

test('sanitizeExport：format 喂非法值 → 落到 xlsx；缺失也是', () => {
  assert.equal(sanitizeExport({ format: 'pdf' }).format, 'xlsx')
  assert.equal(sanitizeExport({}).format, 'xlsx')
  assert.equal(sanitizeExport(null).format, 'xlsx')
  assert.equal(sanitizeExport({ format: 'csv' }).format, 'csv')
})

test('sanitizeExport：header / rows 非数组 → 空；非字符串元素被剔除', () => {
  assert.deepEqual(sanitizeExport({ header: 'x' }).header, [])
  assert.deepEqual(sanitizeExport({ rows: 42 }).rows, [])
  assert.deepEqual(sanitizeExport({ header: ['a', 1, null, 'b'] }).header, ['a', 'b'])
})

test('sanitizeExport：每行补齐到表头宽度（列数恒定，防 CSV 列错位）', () => {
  const r = sanitizeExport({ header: ['序号', '原名'], rows: [['1'], ['1', 'a', '多余']] })
  assert.deepEqual(r.rows, [['1', ''], ['1', 'a']])
})

test('sanitizeExport：rows 里的非数组行被丢弃', () => {
  const r = sanitizeExport({ header: ['a'], rows: [['1'], 'nope', null, ['2']] })
  assert.deepEqual(r.rows, [['1'], ['2']])
})

test('sanitizeExport：suggestedName 剥掉路径与非法字符（只剩文件名成分）', () => {
  assert.equal(sanitizeExport({ suggestedName: '..\\..\\x.xlsx' }).suggestedName, '....x.xlsx')
  assert.equal(sanitizeExport({ suggestedName: 'C:\\win\\a.csv' }).suggestedName, 'Cwina.csv')
  assert.equal(sanitizeExport({ suggestedName: '' }).suggestedName, '文件名清单.xlsx')
})

test('sanitizeExport：suggestedName 缺失时按格式给默认名', () => {
  assert.equal(sanitizeExport({ format: 'docx' }).suggestedName, '文件名清单.docx')
})

/* ══ 9. ★ 预览 ≡ 导出（TC-52）══════════════════════════════════════════ */

test('★ TC-52：导出内容里的新名列与 items[].newName 逐条逐字节相等', () => {
  const items: FileItem[] = [
    mkItem({ id: '1', name: '报告 final.txt', newName: '1-报告 final.txt', status: 'changed' }),
    mkItem({ id: '2', name: 'a,b"c.txt', newName: '2-a,b"c.txt', status: 'changed' }),
    mkItem({ id: '3', name: '🎉庆祝.png', newName: '3-🎉庆祝.png', status: 'changed' }),
    mkItem({ id: '4', name: 'nochange.txt', newName: 'nochange.txt', status: 'unchanged' }),
  ]
  const t = buildExportTable(items, new Set(), { scope: 'all', columns: ['name', 'newName'] })

  // ★ 新名是第 3 列（**下标 2**）：第 0 列是序号、第 1 列是原名
  assert.deepEqual(
    t.rows.map((r) => r[2]),
    items.map((i) => i.newName),
  )

  // 而且必须**真的落进文件里**（以 CSV 为例，转义后仍能找回原值）
  const csv = dec.decode(buildExportContent('csv', [t.header, ...t.rows]).subarray(3))
  for (const it of items) {
    assert.ok(csv.includes(csvCell(it.newName)), `CSV 里找不到新名：${it.newName}`)
  }
})

test('★ TC-52 续：含逗号与引号的文件名走过 CSV 后仍能还原成原值', () => {
  const items = [mkItem({ name: 'a,b"c.txt', newName: '1-a,b"c.txt' })]
  const t = buildExportTable(items, new Set(), { scope: 'all', columns: ['newName'] })
  const csv = dec.decode(buildExportContent('csv', [t.header, ...t.rows]).subarray(3))
  const line = csv.split('\r\n')[1]
  // ★ 不能按逗号 split —— 这一行的逗号有的在引号里、有的是分隔符。
  //   序号列本身不含逗号，所以从**第一个逗号**切开，右边就是完整的新名单元格。
  const cell = line.slice(line.indexOf(',') + 1)
  // 用与 csvCell 同源的规则反解：剥掉外层引号、把 "" 还原成 "
  const unescaped = cell.replace(/^"|"$/g, '').replace(/""/g, '"')
  assert.equal(unescaped, '1-a,b"c.txt')
})
