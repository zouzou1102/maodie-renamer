/**
 * P3-8（文件提取 · 第 8 批）· `extract-filter` 纯函数单测。
 *
 * 运行：`npm run test:core`（必须显式传本文件，见 package.json 的 test:core）。
 *
 * 盯这些事（对应设计 §10 测试要求 + TC-88~95）：
 *  1. 扩展名→类别映射（categoryOf）：各已知扩展名归对类；无扩展名/未知扩展名→other。
 *  2. 按类型：勾选类别只命中该类；「其他」只命中无扩展名/未知扩展名。
 *  3. 按名称包含：文件名主体含关键词即命中（不区分大小写）。
 *  4. 按名称正则：合法正则命中；**非法正则抛 EX-22**（E_REGEX_INVALID）。
 *  5. 按 Excel：名单里的名字命中；名单里列表没有的 → unmatched（EX-21 逐条标，不阻塞）。
 *  6. 多条件叠加（AND）：三类同时满足才命中（TC-92）。
 *  7. 三条件都没启用 → 命中集为空（设计 §4 边界 2）。
 *  8. excelFilenamesOf 复用 P3-4 解析器：认出「原文件名」列取名字；
 *     认不出 → 返回 ok:false（EX-21 解析失败）。
 *
 * 规矩同前：只用 `node:test` + `node:assert`，不引入任何第三方框架。
 * 红线：**绝不为让测试变绿而放宽 / 跳过 / 删断言。**
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { categoryOf, CATEGORY_EXTENSIONS, excelFilenamesOf, filterList } from '../src/shared/extract-filter'
import { MD_ERROR } from '../src/shared/errors'
import type { ExtractSourceFile } from '../src/shared/types'

function src(fullPath: string, name: string, ext: string, isDir = false): ExtractSourceFile {
  return { fullPath, name, ext, isDir }
}

/* ══ 1. 扩展名 → 类别映射 ═══════════════════════════════════════════ */

test('categoryOf：已知扩展名归对类，无扩展名/未知扩展名归 other', () => {
  assert.equal(categoryOf('.jpg'), 'image')
  assert.equal(categoryOf('.JPG'), 'image') // 大小写不敏感
  assert.equal(categoryOf('.png'), 'image')
  assert.equal(categoryOf('.docx'), 'doc')
  assert.equal(categoryOf('.pdf'), 'doc')
  assert.equal(categoryOf('.mp4'), 'video')
  assert.equal(categoryOf('.mp3'), 'audio')
  assert.equal(categoryOf('.zip'), 'archive')
  assert.equal(categoryOf('.7z'), 'archive')
  assert.equal(categoryOf(''), 'other') // 无扩展名
  assert.equal(categoryOf('.xyz'), 'other') // 未知扩展名
})

test('CATEGORY_EXTENSIONS：五类都有内容，other 故意为空', () => {
  assert.ok(CATEGORY_EXTENSIONS.image.length > 0)
  assert.ok(CATEGORY_EXTENSIONS.doc.length > 0)
  assert.ok(CATEGORY_EXTENSIONS.video.length > 0)
  assert.ok(CATEGORY_EXTENSIONS.audio.length > 0)
  assert.ok(CATEGORY_EXTENSIONS.archive.length > 0)
  assert.deepEqual(CATEGORY_EXTENSIONS.other, [])
})

/* ══ 2. 按类型 ═════════════════════════════════════════════════════ */

test('按类型：勾图片只命中图片；点开头隐藏文件按实际扩展名归类', () => {
  const list = [
    src('D:\\1.jpg', '1.jpg', '.jpg'),
    src('D:\\2.png', '2.png', '.png'),
    src('D:\\3.docx', '3.docx', '.docx'),
    src('D:\\README', 'README', ''),
    src('D:\\.gitignore', '.gitignore', ''),
  ]
  const r = filterList(list, { categories: ['image'] })
  assert.deepEqual(r.hits.map((f) => f.name), ['1.jpg', '2.png'])
  assert.deepEqual(r.unmatched, [])
})

test('按类型：勾「其他」只命中无扩展名/未知扩展名', () => {
  const list = [
    src('D:\\1.jpg', '1.jpg', '.jpg'),
    src('D:\\README', 'README', ''),
    src('D:\\weird.xyz', 'weird.xyz', '.xyz'),
  ]
  const r = filterList(list, { categories: ['other'] })
  assert.deepEqual(r.hits.map((f) => f.name), ['README', 'weird.xyz'])
})

/* ══ 3. 按名称（包含）═══════════════════════════════════════════════ */

test('按名称包含：主体含关键词即命中（不区分大小写，扩展名不参与）', () => {
  const list = [
    src('D:\\旅游trip1.jpg', '旅游trip1.jpg', '.jpg'),
    src('D:\\会议trip2.png', '会议trip2.png', '.png'),
    src('D:\\旅游trip3.png', '旅游trip3.png', '.png'),
  ]
  // 中文关键词：主体含「旅游」即命中（扩展名 .jpg/.png 不参与比较）
  const r = filterList(list, { name: { keyword: '旅游', useRegex: false } })
  assert.deepEqual(r.hits.map((f) => f.name), ['旅游trip1.jpg', '旅游trip3.png'])

  // 大小写不敏感：latin 部分 TRIP / trip 都应命中全部三项
  const r2 = filterList(list, { name: { keyword: 'TRIP', useRegex: false } })
  assert.deepEqual(r2.hits.map((f) => f.name), ['旅游trip1.jpg', '会议trip2.png', '旅游trip3.png'])
})

/* ══ 4. 按名称（正则）═══════════════════════════════════════════════ */

test('按名称正则：合法正则只命中形如 IMG_数字 的', () => {
  const list = [
    src('D:\\IMG_001.jpg', 'IMG_001.jpg', '.jpg'),
    src('D:\\pic002.png', 'pic002.png', '.png'),
  ]
  const r = filterList(list, { name: { keyword: '^IMG_\\d+', useRegex: true } })
  assert.deepEqual(r.hits.map((f) => f.name), ['IMG_001.jpg'])
})

test('按名称正则非法：抛 EX-22（E_REGEX_INVALID，计划阶段拦截）', () => {
  const list = [src('D:\\a.jpg', 'a.jpg', '.jpg')]
  assert.throws(
    () => filterList(list, { name: { keyword: '[', useRegex: true } }),
    (e: Error) => (e as { code?: string }).code === MD_ERROR.E_REGEX_INVALID,
  )
})

/* ══ 5. 按 Excel ════════════════════════════════════════════════════ */

test('按 Excel：名单里的名字命中；列表里没有的进 unmatched（EX-21）', () => {
  const list = [
    src('D:\\1.jpg', '1.jpg', '.jpg'),
    src('D:\\2.png', '2.png', '.png'),
    src('D:\\3.docx', '3.docx', '.docx'),
  ]
  // 全部对上
  const ok = filterList(list, { excelNames: ['1.jpg', '3.docx'] })
  assert.deepEqual(ok.hits.map((f) => f.name), ['1.jpg', '3.docx'])
  assert.deepEqual(ok.unmatched, [])

  // 有一个对不上 → 进 unmatched，不阻塞
  const partial = filterList(list, { excelNames: ['1.jpg', '9.zip'] })
  assert.deepEqual(partial.hits.map((f) => f.name), ['1.jpg'])
  assert.deepEqual(partial.unmatched, ['9.zip'])
})

test('按 Excel：名单带路径也能按 basename 比对', () => {
  const list = [src('D:\\子目录\\1.jpg', '1.jpg', '.jpg')]
  const r = filterList(list, { excelNames: ['C:\\别处\\1.jpg'] })
  assert.deepEqual(r.hits.map((f) => f.name), ['1.jpg'])
})

/* ══ 6. 多条件叠加（AND）════════════════════════════════════════════ */

test('三类条件 AND：只有同时满足「图片 + 含旅游 + 在Excel名单」才命中（TC-92）', () => {
  const list = [
    src('D:\\旅游1.jpg', '旅游1.jpg', '.jpg'), // 图 / 含旅游 / 在名单 → 命中
    src('D:\\风景2.png', '风景2.png', '.png'), // 图 / 不含旅游 → 不命中
    src('D:\\旅游3.docx', '旅游3.docx', '.docx'), // 含旅游 / 但非图 → 不命中
    src('D:\\旅游4.jpg', '旅游4.jpg', '.jpg'), // 图 / 含旅游 / 不在名单 → 不命中
  ]
  const r = filterList(list, {
    categories: ['image'],
    name: { keyword: '旅游', useRegex: false },
    excelNames: ['旅游1.jpg'],
  })
  assert.deepEqual(r.hits.map((f) => f.name), ['旅游1.jpg'])
})

/* ══ 7. 三条件都没启用 → 命中集为空 ═════════════════════════════════ */

test('没有任何筛选条件：命中集为空（提示「没有符合条件的文件」）', () => {
  const list = [src('D:\\1.jpg', '1.jpg', '.jpg')]
  const r = filterList(list, {})
  assert.deepEqual(r.hits, [])
  assert.deepEqual(r.unmatched, [])
})

/* ══ 8. excelFilenamesOf 复用 P3-4 解析器 ═══════════════════════════ */

test('excelFilenamesOf：认出「原文件名」列，取该列全部非空文件名', () => {
  const table = {
    sheetName: '',
    rows: [
      { rowNumber: 1, cells: [{ col: 1, text: '原文件名' }, { col: 2, text: '新文件名' }] },
      { rowNumber: 2, cells: [{ col: 1, text: '1.jpg' }, { col: 2, text: 'a.jpg' }] },
      { rowNumber: 3, cells: [{ col: 1, text: '3.docx' }, { col: 2, text: 'b.docx' }] },
    ],
    totalRows: 3,
    truncated: false,
  }
  const r = excelFilenamesOf(table)
  assert.equal(r.ok, true)
  if (r.ok) assert.deepEqual(r.names, ['1.jpg', '3.docx'])
})

test('excelFilenamesOf：认不出「原文件名」列 → ok:false（EX-21 解析失败）', () => {
  const table = {
    sheetName: '',
    rows: [
      { rowNumber: 1, cells: [{ col: 1, text: '序号' }, { col: 2, text: '备注' }] },
      { rowNumber: 2, cells: [{ col: 1, text: '1.jpg' }, { col: 2, text: 'x' }] },
    ],
    totalRows: 2,
    truncated: false,
  }
  const r = excelFilenamesOf(table)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, MD_ERROR.E_EXCEL_UNMATCHED)
})
