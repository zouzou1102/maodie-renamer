/**
 * P3-4（导入表格 / 按表格改名）—— 单测。
 *
 * 运行：`npm run test:core`（**必须显式传本文件**，见 package.json 的 test:core）。
 *
 * 这个文件盯七件事（对应设计 §10 的测试要求）：
 *  1. `zip-read`：读回**我们自己写的** store 包（与 `zip-write` 对拍）；
 *     ★ 读一个 **deflate 压的**包（**这条必须有** —— 别人的 xlsx 都是 deflate）；
 *     损坏的包不抛未捕获异常。
 *  2. `xlsx-read`：★ **空格子不能让后面的列挤位**（Excel 不写空的 `<c>`，对应 TC-62）；
 *     ★ `sharedStrings` 的索引映射（对应 TC-63）；`t` 的几种取值；行号跳号；
 *     工作表路径从 `workbook.xml.rels` 解出（**不硬编码 sheet1.xml**）；emoji。
 *  3. `csv / txt`：带引号的逗号、`""` 双写、带 BOM 与不带 BOM、GBK 回退、Tab 分隔。
 *  4. `detectColumns`：识别词、三条决策树分支、前 5 行内找表头、
 *     ★「文件名」这种**不在词表里**的词**不能**被误认成原名列。
 *  5. `buildMapping`：按名匹配的四种失败 / 四种结果分类 / 扩展名的四种情形 / 没指定原名列的整体拒绝。
 *     ★ 「按行顺序」整档已去掉（2026-09-22）—— 拖进来的文件不一定按表里原文件名的顺序排列。
 *  6. ★★ **预览 ≡ 执行**（TC-64）：`PreviewItemInput` 那条路上 `override` **不是 undefined**，
 *     且与执行器算出的新名**逐字节相等**。**这是唯一能抓「Pick 白名单漏字段」的用例**
 *     —— `Pick` 是合法子集，漏了 `typecheck` 不报错。
 *  7. `rule-summary`：含表格导入时的措辞，且**不改既有摘要的输出**。
 *
 * 规矩同前：只用 `node:test` + `node:assert`，不引入任何第三方框架。
 * 红线：**绝不为让测试变绿而放宽 / 跳过 / 删断言。**
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { MD_ERROR, isMdError } from '../src/shared/errors'
import { buildPreview, toPreviewItemInputs } from '../src/shared/preview'
import { buildRenamePlan } from '../src/shared/rename-plan'
import { buildRuleSummary } from '../src/shared/rule-summary'
import { crc32, zipStore } from '../src/shared/zip-write'
import { zipRead, zipText } from '../src/shared/zip-read'
import { readXlsx } from '../src/shared/xlsx-read'
import {
  buildMapping,
  decodeTableText,
  detectColumns,
  NAME_COL_WORDS,
  NEW_COL_WORDS,
  readDelimitedTable,
  type ColumnChoice,
  type MappingFile,
  type MappingResult,
} from '../src/shared/table-map'
import {
  DEFAULT_RULE,
  type ItemAttrs,
  type PreviewItemInput,
  type RuleConfig,
  type TableRow,
} from '../src/shared/types'

/* ══ 夹具 ═════════════════════════════════════════════════════════════ */

const enc = new TextEncoder()

/** 造一张「像 Excel 那样稀疏」的表：`null` = 这一格**根本不存在**（Excel 不写空的 `<c>`）*/
function sparseTable(rows: Array<Array<string | null>>): TableRow[] {
  return rows.map((cells, i) => ({
    rowNumber: i + 1,
    cells: cells.flatMap((text, c) => (text === null ? [] : [{ col: c + 1, text }])),
  }))
}

/**
 * 造一个 **deflate 压缩**的 ZIP。
 *
 * ★ 为什么测试里要自己写这一小段：我们**写** xlsx 时只用 store（P3-2），
 *   但**别人生成**的 xlsx 一定是 deflate —— 而 deflate 那条路是本批最需要
 *   证明「真的能读」的一条。仓库里没有任何 deflate 包，所以在这里造一个。
 */
function zipDeflate(entries: Array<{ path: string; content: string }>): Uint8Array {
  const parts = entries.map((e) => {
    const name = enc.encode(e.path)
    const raw = enc.encode(e.content)
    const comp = new Uint8Array(deflateRawSync(raw))
    return { name, crc: crc32(raw), comp, rawSize: raw.length }
  })

  let localTotal = 0
  let centralTotal = 0
  for (const p of parts) {
    localTotal += 30 + p.name.length + p.comp.length
    centralTotal += 46 + p.name.length
  }

  const out = new Uint8Array(localTotal + centralTotal + 22)
  const dv = new DataView(out.buffer)
  const offsets: number[] = []
  let off = 0

  for (const p of parts) {
    offsets.push(off)
    dv.setUint32(off, 0x04034b50, true)
    off += 4
    dv.setUint16(off, 20, true)
    off += 2
    dv.setUint16(off, 0, true)
    off += 2
    dv.setUint16(off, 8, true) // ★ method 8 = deflate
    off += 2
    dv.setUint16(off, 0, true)
    off += 2
    dv.setUint16(off, 0x0021, true)
    off += 2
    dv.setUint32(off, p.crc, true)
    off += 4
    dv.setUint32(off, p.comp.length, true)
    off += 4
    dv.setUint32(off, p.rawSize, true)
    off += 4
    dv.setUint16(off, p.name.length, true)
    off += 2
    dv.setUint16(off, 0, true)
    off += 2
    out.set(p.name, off)
    off += p.name.length
    out.set(p.comp, off)
    off += p.comp.length
  }

  const centralStart = off
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    dv.setUint32(off, 0x02014b50, true)
    off += 4
    dv.setUint16(off, 20, true)
    off += 2
    dv.setUint16(off, 20, true)
    off += 2
    dv.setUint16(off, 0, true)
    off += 2
    dv.setUint16(off, 8, true)
    off += 2
    dv.setUint16(off, 0, true)
    off += 2
    dv.setUint16(off, 0x0021, true)
    off += 2
    dv.setUint32(off, p.crc, true)
    off += 4
    dv.setUint32(off, p.comp.length, true)
    off += 4
    dv.setUint32(off, p.rawSize, true)
    off += 4
    dv.setUint16(off, p.name.length, true)
    off += 2
    dv.setUint16(off, 0, true)
    off += 2
    dv.setUint16(off, 0, true)
    off += 2
    dv.setUint16(off, 0, true)
    off += 2
    dv.setUint16(off, 0, true)
    off += 2
    dv.setUint32(off, 0, true)
    off += 4
    dv.setUint32(off, offsets[i], true)
    off += 4
    out.set(p.name, off)
    off += p.name.length
  }
  const centralSize = off - centralStart

  dv.setUint32(off, 0x06054b50, true)
  off += 4
  dv.setUint16(off, 0, true)
  off += 2
  dv.setUint16(off, 0, true)
  off += 2
  dv.setUint16(off, parts.length, true)
  off += 2
  dv.setUint16(off, parts.length, true)
  off += 2
  dv.setUint32(off, centralSize, true)
  off += 4
  dv.setUint32(off, centralStart, true)
  off += 4
  dv.setUint16(off, 0, true)
  off += 2

  return out
}

interface XlsxOptions {
  /** `<sheetData>` 里的行 XML（**不含** sheetData 本身）*/
  sheet: string
  /** 共享字符串表（有就写 `xl/sharedStrings.xml`）*/
  shared?: string[]
  /** 工作表在包里的路径，默认 `worksheets/sheet1.xml`（⭐ 用来验「不硬编码」）*/
  sheetTarget?: string
  /** workbook 里 `<sheet>` 的关系 id */
  rid?: string
}

/** 造一个 xlsx。`zip` 可换成 `zipDeflate` —— 用来证明「别人的表也能读」 */
function xlsxBytes(opts: XlsxOptions, zip: typeof zipStore = zipStore): Uint8Array {
  const target = opts.sheetTarget ?? 'worksheets/sheet1.xml'
  const rid = opts.rid ?? 'rId1'
  const parts: Array<{ path: string; content: string }> = [
    {
      path: 'xl/workbook.xml',
      content:
        '<?xml version="1.0" encoding="UTF-8"?><workbook><sheets>' +
        `<sheet name="订单" sheetId="1" r:id="${rid}"/>` +
        '</sheets></workbook>',
    },
    {
      path: 'xl/_rels/workbook.xml.rels',
      content:
        '<?xml version="1.0" encoding="UTF-8"?><Relationships>' +
        `<Relationship Id="${rid}" Target="${target}"/>` +
        '</Relationships>',
    },
    {
      path: `xl/${target}`,
      content:
        '<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>' +
        opts.sheet +
        // ★ 真实文件里 sheetData 后面还有 rowBreaks 之类的兄弟节点 —— 一起放进来，
        //   验「只扫 sheetData 那一段」真的生效（否则 `<rowBreaks>` 会被当成一行）
        '</sheetData><rowBreaks count="1" manualBreakCount="1"><brk id="1"/></rowBreaks></worksheet>',
    },
  ]
  if (opts.shared !== undefined) {
    parts.push({
      path: 'xl/sharedStrings.xml',
      content:
        `<?xml version="1.0" encoding="UTF-8"?><sst count="${opts.shared.length}">` +
        opts.shared.map((t) => `<si><t>${t}</t></si>`).join('') +
        '</sst>',
    })
  }
  return zip(parts)
}

/** 断言「抛的是我们那一个错误码」（不是未捕获的 TypeError）*/
function throwsCode(fn: () => unknown, code: string): void {
  assert.throws(
    fn,
    (e: unknown) => isMdError(e) && e.code === code,
    `应当抛出 ${code}`,
  )
}

function ruleWith(patch: Partial<RuleConfig['rule']> = {}): RuleConfig {
  // ★ 必须显式置 `mode: 'rule'`：`DEFAULT_RULE.mode` 是 `'delete'`（见 P3-3 的踩坑记录）
  return { ...DEFAULT_RULE, mode: 'rule', rule: { ...DEFAULT_RULE.rule, ...patch } }
}

const NO_ATTRS: ItemAttrs = { created: '', modified: '', sizeBytes: 0 }

function file(id: string, name: string, isDir = false): MappingFile {
  return { id, name, isDir }
}

function choice(patch: Partial<ColumnChoice> = {}): ColumnChoice {
  return { nameCol: 1, newCol: 2, headerRow: 0, ...patch }
}

function okIds(r: MappingResult): string[] {
  return r.rows.filter((x) => x.verdict === 'ok').map((x) => x.fileId)
}

/* ══ 1. zip-read ══════════════════════════════════════════════════════ */

test('zip-read：读回我们自己写的 store 包（与 zip-write 对拍）', () => {
  const bytes = zipStore([
    { path: 'xl/workbook.xml', content: '<workbook>中文</workbook>' },
    { path: 'xl/worksheets/sheet1.xml', content: '<sheetData/>' },
  ])
  const entries = zipRead(bytes)
  assert.equal(entries.size, 2)
  assert.equal(zipText(entries, 'xl/workbook.xml'), '<workbook>中文</workbook>')
  assert.equal(zipText(entries, 'xl/worksheets/sheet1.xml'), '<sheetData/>')
  assert.equal(zipText(entries, 'xl/nope.xml'), null, '不存在的条目返回 null，不抛错')
})

test('zip-read：★ 读 deflate 压的包（别人的 xlsx 都是这种）', () => {
  const text = '<workbook>别人拿 Excel 另存的表</workbook>'
  const bytes = zipDeflate([{ path: 'xl/workbook.xml', content: text }])

  // 不给解压函数 → 必须**明确报错**，绝不静默返回空
  throwsCode(() => zipRead(bytes), MD_ERROR.E_TABLE_UNREADABLE)

  // 给了（主进程就是这样注入的）→ 读出来一模一样
  const entries = zipRead(bytes, { inflate: inflateRawSync })
  assert.equal(zipText(entries, 'xl/workbook.xml'), text)
})

test('zip-read：不是 ZIP 的字节 → 抛 MdError（不是未捕获的 TypeError）', () => {
  throwsCode(() => zipRead(enc.encode('这根本不是压缩包')), MD_ERROR.E_TABLE_UNREADABLE)
  throwsCode(() => zipRead(new Uint8Array(3)), MD_ERROR.E_TABLE_UNREADABLE)
})

test('zip-read：数据被改坏 → CRC 校验拦住（不静默读出错误内容）', () => {
  const name = 'a.txt'
  const bytes = zipStore([{ path: name, content: 'hello world hello world' }])
  // 改掉**数据区第一个字节**（不动 CRC）—— 模拟「文件在保存 / 传输过程中坏了」。
  // ⚠️ 偏移要算准：本地头 30 字节 + 文件名长度（store 没有扩展字段）。
  const copy = new Uint8Array(bytes)
  copy[30 + name.length] = 0x48
  throwsCode(() => zipRead(copy), MD_ERROR.E_TABLE_UNREADABLE)
})

/* ══ 2. xlsx-read ═════════════════════════════════════════════════════ */

test('xlsx-read：★ 空格子不能让后面的列挤位（TC-62）', () => {
  // A1 有值、B1 **根本没有这个格子**、C1 有值 —— 按「出现顺序数格子」的实现会
  // 把 C1 的数成第 2 列，于是整张表从这一行起错位，而界面上「看着挺整齐」
  const bytes = xlsxBytes({
    sheet:
      '<row r="1">' +
      '<c r="A1" t="inlineStr"><is><t>原名</t></is></c>' +
      '<c r="C1" t="inlineStr"><is><t>新名</t></is></c>' +
      '</row>',
  })
  const t = readXlsx(bytes)
  const cells = t.rows[0].cells
  assert.deepEqual(
    cells.map((c) => [c.col, c.text]),
    [
      [1, '原名'],
      [3, '新名'],
    ],
    'B1 缺席 → 第 3 列必须仍然是第 3 列',
  )
})

test('xlsx-read：★ sharedStrings 按索引取文字（不支持的实现会读出 0/1/2）', () => {
  const bytes = xlsxBytes({
    sheet:
      '<row r="1">' +
      '<c r="A1" t="s"><v>0</v></c>' +
      '<c r="B1" t="s"><v>1</v></c>' +
      '</row>',
    shared: ['照片A.jpg', '封面.jpg'],
  })
  const t = readXlsx(bytes)
  assert.deepEqual(
    t.rows[0].cells.map((c) => c.text),
    ['照片A.jpg', '封面.jpg'],
  )
})

test('xlsx-read：t 的四种取值 + 没有 t（数字）', () => {
  const bytes = xlsxBytes({
    sheet:
      '<row r="1">' +
      '<c r="A1" t="s"><v>0</v></c>' +
      '<c r="B1" t="inlineStr"><is><t>内联</t></is></c>' +
      '<c r="C1" t="str"><v>公式结果</v></c>' +
      '<c r="D1" t="b"><v>1</v></c>' +
      '<c r="E1"><v>2026</v></c>' +
      '<c r="F1" t="b"><v>0</v></c>' +
      '</row>',
    shared: ['共享串'],
  })
  const t = readXlsx(bytes)
  assert.deepEqual(
    t.rows[0].cells.map((c) => c.text),
    ['共享串', '内联', '公式结果', 'TRUE', '2026', 'FALSE'],
  )
})

test('xlsx-read：行号跳号（<row r="1"> 之后直接 <row r="5">）', () => {
  const bytes = xlsxBytes({
    sheet:
      '<row r="1"><c r="A1" t="inlineStr"><is><t>表头</t></is></c></row>' +
      '<row r="5"><c r="A5" t="inlineStr"><is><t>第五行</t></is></c></row>',
  })
  const t = readXlsx(bytes)
  assert.deepEqual(t.rows.map((r) => r.rowNumber), [1, 5])
  // 行号必须是**原样**的（对不上时用户要能拿它回 Excel 里找那一行）
  assert.equal(t.totalRows, 2)
})

test('xlsx-read：工作表路径从 workbook.xml.rels 解出（不硬编码 sheet1.xml）', () => {
  const bytes = xlsxBytes({
    sheet: '<row r="1"><c r="A1" t="inlineStr"><is><t>别表</t></is></c></row>',
    sheetTarget: 'worksheets/sheet3.xml',
    rid: 'rId7',
  })
  const t = readXlsx(bytes)
  assert.equal(t.sheetName, '订单')
  assert.equal(t.rows[0].cells[0].text, '别表')
})

test('xlsx-read：emoji 与 XML 转义（&#x1F600; 是代理对，不能切成两个乱码）', () => {
  const bytes = xlsxBytes({
    sheet: '<row r="1"><c r="A1" t="inlineStr"><is><t>a&amp;b&lt;c&gt;d&#x1F600;&#29579;</t></is></c></row>',
  })
  const t = readXlsx(bytes)
  assert.equal(t.rows[0].cells[0].text, 'a&b<c>d😀王')
})

test('xlsx-read：富文本 <r><t> 要拼起来（只取第一个 <t> 会得到「看着像真名字」的残名）', () => {
  const raw = xlsxBytes({
    sheet: '<row r="1"><c r="A1" t="inlineStr"><is><r><t>封面</t></r><r><t>A.jpg</t></r></is></c></row>',
  })
  assert.equal(readXlsx(raw).rows[0].cells[0].text, '封面A.jpg')
})

test('xlsx-read：<rowBreaks> 不会被当成一行', () => {
  const bytes = xlsxBytes({
    sheet: '<row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row>',
  })
  assert.equal(readXlsx(bytes).totalRows, 1)
})

test('xlsx-read：超过 1 万行 → 截断，但 totalRows 仍是真实值', () => {
  const rows: string[] = []
  for (let i = 1; i <= 10_001; i++) {
    rows.push(`<row r="${i}"><c r="A${i}" t="inlineStr"><is><t>n${i}</t></is></c></row>`)
  }
  const t = readXlsx(xlsxBytes({ sheet: rows.join('') }))
  assert.equal(t.rows.length, 10_000)
  assert.equal(t.totalRows, 10_001)
  assert.equal(t.truncated, true)
  assert.equal(t.rows[9_999].cells[0].text, 'n10000')
})

test('xlsx-read：不是 xlsx（缺 xl/workbook.xml）→ 明确报错', () => {
  throwsCode(
    () => readXlsx(zipStore([{ path: 'word/document.xml', content: '<w/>' }])),
    MD_ERROR.E_TABLE_UNREADABLE,
  )
})

test('xlsx-read：表太大 → E_TABLE_TOO_BIG（不是卡死、也不是乱码）', () => {
  const huge = 'x'.repeat(24 * 1024 * 1024 + 32)
  throwsCode(() => readXlsx(xlsxBytes({ sheet: huge })), MD_ERROR.E_TABLE_TOO_BIG)
})

test('xlsx-read：端到端 —— 用 deflate 压的 xlsx（模拟「别人用 Excel 另存出来的表」）', () => {
  const bytes = xlsxBytes(
    {
      sheet:
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>',
      shared: ['原文件名', '新文件名', '照片A.jpg', '封面.jpg'],
    },
    zipDeflate,
  )
  const t = readXlsx(bytes, { inflate: inflateRawSync })
  const g = detectColumns(t.rows)
  assert.equal(g.nameCol, 1)
  assert.equal(g.newCol, 2)
  assert.equal(t.rows[1].cells[1].text, '封面.jpg')
})

/* ══ 3. csv / txt ═════════════════════════════════════════════════════ */

test('csv：带引号的逗号 + "" 双写转义', () => {
  const text = '原名,新名\n"a,1.txt","b"",2.txt"\n'
  const t = readDelimitedTable(enc.encode(text), ',')
  assert.equal(t.rows[0].cells[0].text, '原名')
  assert.equal(t.rows[1].cells[0].text, 'a,1.txt')
  assert.equal(t.rows[1].cells[1].text, 'b",2.txt')
})

test('csv：带 BOM 与不带 BOM 都能读（我们自己导出的就带 BOM）', () => {
  const withBom = readDelimitedTable(enc.encode('\uFEFF原名,新名\na,b\n'), ',')
  const noBom = readDelimitedTable(enc.encode('原名,新名\na,b\n'), ',')
  assert.equal(withBom.rows[0].cells[0].text, '原名', 'BOM 必须被吃掉，不能粘在表头前面')
  assert.equal(noBom.rows[0].cells[0].text, '原名')
  assert.equal(withBom.rows[1].cells[1].text, 'b')
})

test('csv：GBK 回退（Windows 上被 Excel 另存过的 csv 很可能是 GBK）', () => {
  // 「原名,新名\n照片,封面\n」的 GBK 字节
  const gbk = new Uint8Array([
    0xd4, 0xad, 0xc3, 0xfb, 0x2c, 0xd0, 0xc2, 0xc3, 0xfb, 0x0a,
    0xd5, 0xd5, 0xc6, 0xac, 0x2c, 0xb7, 0xe2, 0xc3, 0xe6, 0x0a,
  ])
  assert.equal(decodeTableText(gbk), '原名,新名\n照片,封面\n')
  const t = readDelimitedTable(gbk, ',')
  assert.equal(t.rows[1].cells[0].text, '照片')
  assert.equal(t.rows[1].cells[1].text, '封面')
})

test('txt：Tab 分隔，且支持字段里的换行与 \\r\\n', () => {
  const text = '原名\t新名\r\n"a\tb.txt"\t新名1\r\n'
  const t = readDelimitedTable(enc.encode(text), '\t')
  assert.equal(t.rows[0].cells[1].text, '新名')
  assert.equal(t.rows[1].cells[0].text, 'a\tb.txt')
  assert.equal(t.rows[1].cells[1].text, '新名1')

  const multi = readDelimitedTable(enc.encode('a,"第一行\n第二行"\n'), ',')
  assert.equal(multi.rows[0].cells[1].text, '第一行\n第二行')
})

/* ══ 4. detectColumns ═════════════════════════════════════════════════ */

test('detectColumns：两列都认出 → 走按文件名匹配', () => {
  const rows = sparseTable([
    ['原文件名', '新文件名'],
    ['a.txt', 'b.txt'],
  ])
  const g = detectColumns(rows)
  assert.equal(g.nameCol, 1)
  assert.equal(g.newCol, 2)
  assert.equal(g.headerRow, 0)
  assert.equal(g.headerFound, true)
  assert.ok(g.why.includes('按文件名匹配'))
})

test('detectColumns：★ 检测不到「原文件名」列 → **不猜**（nameCol 保持 0）', () => {
  // 只有新名列 → 以前会退化成「按行顺序」，现在**不猜**（设计 §16）：
  //   猜错列 = 把文件改成别人的名字，而对照表看着挺整齐 —— 用户不会发现。
  const onlyNew = detectColumns(sparseTable([['序号', '新名'], ['1', 'b.txt']]))
  assert.equal(onlyNew.nameCol, 0, '认不出原名列就保持 0 —— 绝不退化成「第一列 = 新名」')
  assert.equal(onlyNew.newCol, 2, '新名列还是认出来了（给用户做预填）')
  assert.equal(onlyNew.headerFound, true)

  // 一个字都认不出 → 同样不猜
  const none = detectColumns(sparseTable([['甲', '乙'], ['a.txt', 'b.txt']]))
  assert.equal(none.nameCol, 0)
  assert.equal(none.headerFound, false)
  assert.equal(none.headerRow, -1, '没认出表头 → 每一行都是数据，不跳过任何行')
  assert.ok(none.why.includes('没认出表头'), none.why)
})

test('detectColumns：识别词一个个都认（含括号、全角空格、大小写）', () => {
  for (const w of NAME_COL_WORDS) {
    assert.equal(detectColumns(sparseTable([[w, '新文件名']])).nameCol, 1, `认不出原名列：「${w}」`)
  }
  for (const w of NEW_COL_WORDS) {
    assert.equal(detectColumns(sparseTable([['原文件名', w]])).newCol, 2, `认不出新名列：「${w}」`)
  }
  // 括号内容要被去掉；全角空格与大小写都无所谓。
  // ⚠️ 刻意**不**把词内部的空格当同一回事：`NEW NAME` 认成 `newname` 是「猜」，
  //    而猜错的代价是改错文件 —— 认不出就**不导入**，让用户在弹窗里指定列
  assert.equal(detectColumns(sparseTable([['原文件名（必填）', '新文件名（必填）']])).nameCol, 1)
  assert.equal(detectColumns(sparseTable([['　原文件名　', '  NeWnAmE  ']])).nameCol, 1)
  assert.equal(
    detectColumns(sparseTable([['原文件名', 'NEW NAME']])).headerFound,
    false,
    '词内部有空格 → 不认（不猜）',
  )
})

test('detectColumns：表头在前 5 行内（前面允许有标题行）', () => {
  const g = detectColumns(
    sparseTable([['2026 年 9 月订单表', null], [null, null], ['原文件名', '新文件名'], ['a', 'b']]),
  )
  assert.equal(g.headerRow, 2)
  // 表头在第 6 行 → 超出扫描范围，认不出
  const far = detectColumns(
    sparseTable([[null, null], [null, null], [null, null], [null, null], [null, null], ['原文件名', '新文件名']]),
  )
  assert.equal(far.headerFound, false)
})

test('detectColumns：★「文件名」这种不在词表里的词不能被误认成原名列', () => {
  const g = detectColumns(sparseTable([['文件名', '新文件名'], ['a.txt', 'b.txt']]))
  assert.equal(g.nameCol, 0, '「文件名」不能当原名列（词表里只有「原文件名」这类写法）')
  assert.equal(g.newCol, 2)
  // ★ 认不出原名列 → 整体拒绝（不猜）
  assert.equal(g.headerFound, true)
})

test('detectColumns：下拉用的列清单带上表头文字', () => {
  const g = detectColumns(sparseTable([['原文件名', '新文件名'], ['a', 'b']]))
  assert.deepEqual(
    g.columns.map((c) => c.col),
    [1, 2],
  )
  assert.equal(g.columns[0].label, '原文件名')
})

/* ══ 5. buildMapping ══════════════════════════════════════════════════ */

test('buildMapping：按文件名匹配 —— 正常 / 忽略大小写 / 表里重名 / 列表里两个同名', () => {
  const files = [file('f1', '照片A.jpg'), file('f2', '照片B.jpg')]

  // 正常 + 大小写不匹配（Windows 文件名不区分大小写）
  const good = buildMapping(
    sparseTable([['原文件名', '新文件名'], ['照片a.JPG', '封面.jpg']]),
    choice(),
    files,
  )
  assert.deepEqual(okIds(good), ['f1'])
  assert.equal(good.counts.ok, 1)

  // 表里两行同名 → 两条都不配（不猜谁是谁）
  const dupInTable = buildMapping(
    sparseTable([
      ['原文件名', '新文件名'],
      ['照片A.jpg', '封面.jpg'],
      ['照片A.jpg', '内页.jpg'],
    ]),
    choice(),
    files,
  )
  assert.deepEqual(okIds(dupInTable), [])
  assert.equal(dupInTable.counts.unmatched, 2)
  assert.ok(dupInTable.rows[0].reason.includes('表里有 2 行都写着'))

  // 列表里两个同名文件 → 不配，并说清怎么办
  const dupInList = buildMapping(
    sparseTable([['原文件名', '新文件名'], ['照片A.jpg', '封面.jpg']]),
    choice(),
    [file('f1', '照片A.jpg'), file('f9', '照片a.jpg')],
  )
  assert.deepEqual(okIds(dupInList), [])
  assert.ok(dupInList.rows[0].reason.includes('列表里有 2 个同名文件'))

  // 列表里没有 → 对不上
  const missing = buildMapping(
    sparseTable([['原文件名', '新文件名'], ['不存在.jpg', '封面.jpg']]),
    choice(),
    files,
  )
  assert.equal(missing.counts.unmatched, 1)
  assert.ok(missing.rows[0].reason.includes('列表里没有'))
})

test('buildMapping：★ 没指定「原文件名」列 → 整体拒绝，并告诉用户怎么办', () => {
  const r = buildMapping(
    sparseTable([['新文件名'], ['a.jpg'], ['b.jpg']]),
    choice({ nameCol: 0, newCol: 1, headerRow: 0 }),
    [file('f1', 'x.jpg')],
  )
  assert.ok(r.rejected.includes('原文件名'), `实际：${r.rejected}`)
  // ★ 必须告诉用户**怎么办**（设计 §16 第 5 项）—— 不能只说「不行」
  assert.ok(
    r.rejected.includes('放进表里') || r.rejected.includes('指定'),
    `拒绝时必须告诉用户怎么办，实际：${r.rejected}`,
  )
  assert.equal(r.rows.length, 0, '被拒绝时不产出对照表，避免用户以为「可以导」')
  assert.equal(r.counts.ok, 0)
})

test('buildMapping：扩展名四种情形（保护原扩展名 / 不一致要挡住）', () => {
  const files = [file('f1', '照片D.docx')]
  const rows = (newName: string): TableRow[] =>
    sparseTable([['原文件名', '新文件名'], ['照片D.docx', newName]])

  // ① 表里不带扩展名 → 用原扩展名（扩展名保护「自动成立」的来源）
  const bare = buildMapping(rows('附录'), choice(), files)
  assert.deepEqual(okIds(bare), ['f1'])
  assert.equal(bare.rows[0].newStem, '附录')

  // ② 表里扩展名与原文件相同（忽略大小写）→ 也用原扩展名
  const same = buildMapping(rows('附录.DOCX'), choice(), files)
  assert.deepEqual(okIds(same), ['f1'])
  assert.equal(same.rows[0].newStem, '附录')

  // ③ 表里想改成别的扩展名 → **跳过 + 标红**，绝不静默按主体处理
  const diff = buildMapping(rows('附录.jpg'), choice(), files)
  assert.deepEqual(okIds(diff), [])
  assert.equal(diff.counts.problem, 1)
  assert.ok(diff.rows[0].reason.includes('想改扩展名'))

  // ④ 只有扩展名（`.jpg`）→ 跳过。⚠️ 这一条不能靠 `splitName`：
  //    它把「点开头」的名字当整名（`.gitignore` 的约定），直接放行会产出 `.jpg.docx`
  const onlyExt = buildMapping(rows('.jpg'), choice(), files)
  assert.deepEqual(okIds(onlyExt), [])
  assert.equal(onlyExt.counts.problem, 1)
  assert.ok(onlyExt.rows[0].reason.includes('只写了扩展名'), onlyExt.rows[0].reason)
})

test('buildMapping：文件夹不受扩展名那一套约束（它没有扩展名概念）', () => {
  const r = buildMapping(
    sparseTable([['原文件名', '新文件名'], ['素材', '封面.jpg']]),
    choice(),
    [file('d1', '素材', true)],
  )
  assert.deepEqual(okIds(r), ['d1'], '文件夹：整段都算主体')
  assert.equal(r.rows[0].newStem, '封面.jpg')
})

test('buildMapping：四种结果分类各一条，「表外」的文件继续按规则算', () => {
  const files = [file('f1', 'a.txt'), file('f2', 'b.txt'), file('f3', 'c.txt'), file('f4', 'd.txt')]
  const r = buildMapping(
    sparseTable([
      ['原文件名', '新文件名'],
      ['a.txt', 'a1.txt'], // ✓ 能改
      ['b.txt', 'b'], // ○ 没变化（新名主体与原名相同）
      ['c.txt', 'c1.jpg'], // ⚠ 有问题（想改扩展名）
      ['zz.txt', 'z1.txt'], // ✕ 对不上
    ]),
    choice(),
    files,
  )
  assert.equal(r.counts.ok, 1)
  assert.equal(r.counts.same, 1)
  assert.equal(r.counts.problem, 1)
  assert.equal(r.counts.unmatched, 1)
  assert.equal(r.matchedFiles, 3)
  assert.equal(r.outsideFiles, 1, 'd.txt 不在表里 —— 它继续按规则算，不是被漏掉')
  assert.equal(r.rejected, '')
})

test('buildMapping：列表为空 → 全部「对不上」+ 标记 listEmpty（不是整体拒绝）', () => {
  const rows = sparseTable([['原文件名', '新文件名'], ['a.txt', 'b.txt']])
  const r = buildMapping(rows, choice(), [])
  assert.equal(r.listEmpty, true)
  assert.equal(r.rejected, '', '列表为空不该走「整体拒绝」那条路（设计 §4 第 1 行）')
  assert.equal(r.counts.unmatched, 1)
  assert.equal(r.rows[0].reason.includes('列表里没有'), true, r.rows[0].reason)
})

test('buildMapping：表里只有表头 → empty', () => {
  const r = buildMapping(sparseTable([['原文件名', '新文件名']]), choice(), [file('f1', 'a.txt')])
  assert.equal(r.empty, true)
  assert.equal(r.rows.length, 0)
})

test('buildMapping：空白行被跳过，不算数据行（表中间常有空行）', () => {
  const r = buildMapping(
    sparseTable([
      ['原文件名', '新文件名'],
      [null, null],
      ['a.txt', 'a1.txt'],
    ]),
    choice(),
    [file('f1', 'a.txt')],
  )
  assert.equal(r.rows.length, 1)
  assert.deepEqual(okIds(r), ['f1'])
})

test('buildMapping：行号用的仍是表里的原始行号（对不上时用户要能回 Excel 找）', () => {
  const r = buildMapping(
    [
      { rowNumber: 1, cells: [{ col: 1, text: '原文件名' }, { col: 2, text: '新文件名' }] },
      { rowNumber: 7, cells: [{ col: 1, text: '没有这个.txt' }, { col: 2, text: 'x.txt' }] },
    ],
    choice(),
    [file('f1', 'a.txt')],
  )
  assert.equal(r.rows[0].rowNumber, 7)
})

/* ══ 6. ★★ 预览 ≡ 执行（TC-64）════════════════════════════════════════ */

test('★★ 预览 ≡ 执行：override 在 PreviewItemInput 那条路上不是 undefined', () => {
  const rule = ruleWith({ prefix: 'ZZZ_' })
  const override = { stem: '表里给的名字', sourceTable: '对照.xlsx' }

  // ★ 这一行的类型本身就是一条断言：`PreviewItemInput` 是 `Pick<FileItem, ...>`
  //   的**显式字段白名单**，漏了 `override` 这个字面量会多出一个属性 → 编译不过。
  //   而漏了它的话，Worker 那条路会按规则算名字、执行那条路用表里的名字
  //   → **预览 ≠ 执行**（方向还反了：执行对、预览错）。
  const previewInput: PreviewItemInput = {
    id: 'f1',
    dirPath: 'D:\\p34',
    stem: '素材',
    ext: '.docx',
    isDir: false,
    attrs: NO_ATTRS,
    override,
  }

  const preview = buildPreview([previewInput], rule, '2026-09-22', {}, false)
  const plan = buildRenamePlan(
    [{ id: 'f1', dirPath: 'D:\\p34', fromName: '素材.docx', isDir: false, attrs: NO_ATTRS, override }],
    rule,
    '2026-09-22',
    {},
    false,
  )
  const executed = [...plan.ready, ...plan.skipped, ...plan.invalid][0]

  assert.equal(preview.items[0].newName, '表里给的名字.docx', '预览侧必须拿到 override')
  assert.equal(executed.toName, '表里给的名字.docx', '执行侧必须拿到 override')
  assert.equal(preview.items[0].newName, executed.toName, '两条路必须逐字节相等')
  assert.ok(
    !preview.items[0].newName.includes('ZZZ'),
    '有表格给的名字时，规则必须被完全忽略（前后缀都不该出现）',
  )
})

test('override 为空串 → 退回按规则算（「没给名字」不能把名字清空）', () => {
  const rule = ruleWith({ prefix: 'A_' })
  const preview = buildPreview(
    [
      {
        id: 'f1',
        dirPath: 'D:\\p34',
        stem: '素材',
        ext: '.docx',
        isDir: false,
        attrs: NO_ATTRS,
        override: { stem: '', sourceTable: '对照.xlsx' },
      },
    ],
    rule,
    '2026-09-22',
    {},
    false,
  )
  assert.equal(preview.items[0].newName, 'A_素材.docx')
})

/* ══ 7. rule-summary ══════════════════════════════════════════════════ */

test('rule-summary：含表格导入的措辞，且不传第二参数时输出一个字都不变', () => {
  const r = ruleWith({ prefix: 'A_' })
  const plain = buildRuleSummary(r)

  assert.equal(buildRuleSummary(r, undefined), plain)
  assert.ok(!plain.includes('表格导入'), '没有导入时不该出现这句')

  const withImport = buildRuleSummary(r, { count: 3, source: '对照.xlsx' })
  assert.ok(withImport.startsWith(plain), '老部分原样保留，只在末尾追加')
  assert.ok(withImport.endsWith('含表格导入 3 项（对照.xlsx）'), withImport)

  assert.equal(buildRuleSummary(r, { count: 0, source: 'x.xlsx' }), plain, '0 项不该追加')
})

/* ══ 8. ★ 跨 Worker 边界只传纯数据（2026-09-22 真踩到）═══════════════════ */

test('★★ 预览请求的每一项必须是「普通对象」—— 传了 Vue 代理会让 Worker 静默退化', () => {
  // ★ 为什么这条断言有意义：`items` 是 Vue 的响应式数组，它里面的 `attrs` / `override`
  //   **也是 Vue 代理**（`reactive` 是深层的）。把代理直接塞进 `postMessage` 会抛
  //   `DataCloneError`，而 `preview-runner` 的兜底会「就地算完」—— 于是**功能看着完全正常**，
  //   实际上 Worker 从来没被用上、每次预览还刷一条警告。
  //   这里用**真 Proxy** 冒充 Vue 代理：忘了摊平 → `structuredClone` 立刻抛错 → 这条必红。
  const proxyAttrs = new Proxy({ created: '2026-09-18', modified: '2026-09-02', sizeBytes: 7 }, {})
  const proxyOverride = new Proxy({ stem: '表里给的名字', sourceTable: '对照.xlsx' }, {})

  const mapped = toPreviewItemInputs([
    {
      id: 'f1',
      dirPath: 'D:\\p34',
      stem: '素材',
      ext: '.docx',
      isDir: false,
      attrs: proxyAttrs,
      override: proxyOverride,
    },
  ])

  // ① 能通过结构化克隆（＝ `postMessage` 不会抛 DataCloneError）
  assert.doesNotThrow(
    () => structuredClone(mapped),
    '预览请求里不能出现响应式代理 —— 否则 Worker 每次都 DataCloneError、静默退化成主线程计算',
  )
  // ② 内容一个都没丢（摊平不等于丢字段）
  assert.deepEqual(mapped[0].attrs, { created: '2026-09-18', modified: '2026-09-02', sizeBytes: 7 })
  assert.deepEqual(mapped[0].override, { stem: '表里给的名字', sourceTable: '对照.xlsx' })
  // ③ 没有 override 的项仍然是 undefined（不能变成 `{}`）
  const plain = toPreviewItemInputs([
    { id: 'f2', dirPath: 'D:\\p34', stem: 'a', ext: '.txt', isDir: false, attrs: NO_ATTRS },
  ])
  assert.equal(plain[0].override, undefined)
  assert.doesNotThrow(() => structuredClone(plain))
})

