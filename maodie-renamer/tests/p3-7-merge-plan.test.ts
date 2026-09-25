/**
 * P3-7（文件夹合并 · 第 7 批）· `computeMergePlan` 纯函数单测。
 *
 * 运行：`npm run test:core`（必须显式传本文件，见 package.json 的 test:core）。
 *
 * 盯这些事（对应设计 §10 测试要求 + TC-80~87）：
 *  1. 四种合并方式落点精确：same / byExt / byCreated / byModified。
 *  2. ★ byExt：无扩展名 → 归入「无扩展名」子文件夹；`.gitignore`（点开头）同样。
 *  3. ③④ 日期为空 → 用可读占位（未知创建日期 / 未知修改日期），不建空名文件夹。
 *  4. ★ 磁盘冲突（目标已存在）→ skip + E_CONFLICT_DISK（绝不覆盖）。
 *  5. ★ 批量冲突（两个源算出同一落点）→ 后者 skip + E_CONFLICT_BATCH。
 *  6. ★ 结构性拒绝：目标落在源内部 → rejected(E_TARGET_INSIDE_SOURCE)，禁用执行；
 *     边界：目标==源根 也算内部；源在目标内部 / 不同盘 不误拒。
 *  7. ★ 结构性拒绝：空源 → rejected(E_LIST_EMPTY)。
 *  8. 空名文件 → error(E_EMPTY_NAME)，不阻塞其它项。
 *  9. 汇总计数正确（ready/skip/error/fileCount 各自对得上）。
 *
 * 规矩同前：只用 `node:test` + `node:assert`，不引入任何第三方框架。
 * 红线：**绝不为让测试变绿而放宽 / 跳过 / 删断言。**
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { computeMergePlan, type MergeSourceItem } from '../src/shared/merge-plan'
import { MD_ERROR } from '../src/shared/errors'

const ROOT = process.cwd()
assert.ok(
  fs.existsSync(path.join(ROOT, 'package.json')),
  `单测必须在工程根目录下运行（当前 cwd = ${ROOT}）—— 用 npm run test:core`,
)

/* ══ 夹具 ═════════════════════════════════════════════════════════════ */

const T = 'D:\\合并目标'

function item(over: Partial<MergeSourceItem> = {}): MergeSourceItem {
  const name = over.name ?? '文件'
  return {
    srcPath: over.srcPath ?? `D:\\源\\${name}`,
    name,
    ext: over.ext ?? '',
    created: over.created ?? '2026-09-23',
    modified: over.modified ?? '2026-09-23',
    isDir: over.isDir ?? false,
    ...over,
  }
}

/** 一条最小可用 plan 输入；逐字段覆盖 */
function plan(
  items: MergeSourceItem[],
  mode: MergeSourceItem['name'] extends never ? never : 'same' | 'byExt' | 'byCreated' | 'byModified',
  destExists: (p: string) => boolean = () => false,
) {
  return computeMergePlan({
    target: T,
    mode,
    operation: 'copy',
    sourceRoots: ['D:\\源'],
    items,
    destExists,
  })
}

/* ══ 1. 四种方式落点精确 ══════════════════════════════════════════════ */

test('① same：落点 = 目标\\原名', () => {
  const r = plan([item({ name: '照片.jpg', ext: '.jpg', srcPath: 'D:\\源\\照片.jpg' })], 'same')
  assert.equal(r.entries[0].destPath, 'D:\\合并目标\\照片.jpg')
  assert.equal(r.entries[0].outcome, 'ready')
  assert.equal(r.entries[0].code, undefined, 'ready 项不带错误码')
})

test('② byExt：落点 = 目标\\扩展名(去点)\\原名', () => {
  const r = plan([item({ name: '照片.jpg', ext: '.jpg', srcPath: 'D:\\源\\照片.jpg' })], 'byExt')
  assert.equal(r.entries[0].destPath, 'D:\\合并目标\\jpg\\照片.jpg')
})

test('② byExt：无扩展名 → 归入「无扩展名」子文件夹', () => {
  const r = plan([item({ name: 'README', ext: '', srcPath: 'D:\\源\\README' })], 'byExt')
  assert.equal(r.entries[0].destPath, 'D:\\合并目标\\无扩展名\\README')
})

test('② byExt：点开头的「伪扩展名」(.gitignore) 也归「无扩展名」', () => {
  const r = plan([item({ name: '.gitignore', ext: '', srcPath: 'D:\\源\\.gitignore' })], 'byExt')
  assert.equal(r.entries[0].destPath, 'D:\\合并目标\\无扩展名\\.gitignore')
})

test('③ byCreated：落点 = 目标\\创建日\\原名（用 created 字段，不看 modified）', () => {
  const r = plan(
    [item({ name: 'a.jpg', ext: '.jpg', created: '2026-01-15', modified: '2026-09-01' })],
    'byCreated',
  )
  assert.equal(r.entries[0].destPath, 'D:\\合并目标\\2026-01-15\\a.jpg')
})

test('④ byModified：落点 = 目标\\修改日\\原名（用 modified 字段，不看 created）', () => {
  const r = plan(
    [item({ name: 'a.jpg', ext: '.jpg', created: '2026-01-15', modified: '2026-09-01' })],
    'byModified',
  )
  assert.equal(r.entries[0].destPath, 'D:\\合并目标\\2026-09-01\\a.jpg')
})

test('③④ 日期为空 → 用可读占位（未知创建日期 / 未知修改日期），不建空名文件夹', () => {
  const c = plan([item({ name: 'a.jpg', ext: '.jpg', created: '', modified: '' })], 'byCreated')
  assert.equal(c.entries[0].destPath, 'D:\\合并目标\\未知创建日期\\a.jpg')
  const m = plan([item({ name: 'a.jpg', ext: '.jpg', created: '', modified: '' })], 'byModified')
  assert.equal(m.entries[0].destPath, 'D:\\合并目标\\未知修改日期\\a.jpg')
})

/* ══ 4/5. 冲突绝不覆盖 ═════════════════════════════════════════════════ */

test('★ 磁盘冲突：目标已存在同名 → skip + E_CONFLICT_DISK（绝不覆盖，禁用该条执行）', () => {
  const r = plan([item({ name: '照片.jpg', ext: '.jpg' })], 'same', (p) => p === 'D:\\合并目标\\照片.jpg')
  assert.equal(r.entries[0].outcome, 'skip')
  assert.equal(r.entries[0].code, MD_ERROR.E_CONFLICT_DISK)
  assert.equal(r.summary.ready, 0)
  assert.equal(r.summary.skip, 1)
})

test('★ 批量冲突：两个源文件算出同一落点 → 后者 skip + E_CONFLICT_BATCH', () => {
  const r = plan(
    [
      item({ name: '照片.jpg', ext: '.jpg', srcPath: 'D:\\源\\A\\照片.jpg' }),
      item({ name: '照片.jpg', ext: '.jpg', srcPath: 'D:\\源\\B\\照片.jpg' }),
    ],
    'same',
  )
  assert.equal(r.entries[0].outcome, 'ready', '先到先得')
  assert.equal(r.entries[1].outcome, 'skip', '后到撞名 → 跳过')
  assert.equal(r.entries[1].code, MD_ERROR.E_CONFLICT_BATCH)
  assert.equal(r.summary.ready, 1)
  assert.equal(r.summary.skip, 1)
})

/* ══ 6. 结构性拒绝：目标在源内部 ═══════════════════════════════════════ */

test('★ 结构性拒绝：目标落在源内部 → rejected(E_TARGET_INSIDE_SOURCE)，整批禁用执行', () => {
  const r = computeMergePlan({
    target: 'D:\\源\\子',
    mode: 'same',
    operation: 'copy',
    sourceRoots: ['D:\\源'],
    items: [item({ name: '照片.jpg', ext: '.jpg' })],
    destExists: () => false,
  })
  assert.ok(r.rejected, '应有 rejected')
  assert.equal(r.rejected!.code, MD_ERROR.E_TARGET_INSIDE_SOURCE)
})

test('★ 边界：目标 == 源根 也算内部（不漏判）', () => {
  const r = computeMergePlan({
    target: 'D:\\源',
    mode: 'same',
    operation: 'copy',
    sourceRoots: ['D:\\源'],
    items: [item({ name: '照片.jpg', ext: '.jpg' })],
    destExists: () => false,
  })
  assert.equal(r.rejected!.code, MD_ERROR.E_TARGET_INSIDE_SOURCE)
})

test('★ 反向不成立：源在目标内部是允许的（不误拒）', () => {
  const r = computeMergePlan({
    target: 'D:\\外部',
    mode: 'same',
    operation: 'copy',
    sourceRoots: ['D:\\外部\\源'],
    items: [item({ name: '照片.jpg', ext: '.jpg' })],
    destExists: () => false,
  })
  assert.equal(r.rejected, undefined, '源在目标内部是合法场景')
  assert.equal(r.entries[0].outcome, 'ready')
})

test('★ 不同盘不误拒（大小写无关）', () => {
  const r = computeMergePlan({
    target: 'e:\\合并目标',
    mode: 'same',
    operation: 'copy',
    sourceRoots: ['D:\\源'],
    items: [item({ name: '照片.jpg', ext: '.jpg' })],
    destExists: () => false,
  })
  assert.equal(r.rejected, undefined)
})

/* ══ 7. 结构性拒绝：空源 ═══════════════════════════════════════════════ */

test('★ 结构性拒绝：空源 → rejected(E_LIST_EMPTY)', () => {
  const r = computeMergePlan({
    target: T,
    mode: 'same',
    operation: 'copy',
    sourceRoots: ['D:\\源'],
    items: [],
    destExists: () => false,
  })
  assert.ok(r.rejected)
  assert.equal(r.rejected!.code, MD_ERROR.E_LIST_EMPTY)
})

/* ══ 8. 空名文件兜底 ═══════════════════════════════════════════════════ */

test('★ 空名文件 → error(E_EMPTY_NAME)，不阻塞其它项', () => {
  const r = plan([item({ name: '照片.jpg', ext: '.jpg' }), item({ name: '', ext: '' })], 'same')
  assert.equal(r.entries[0].outcome, 'ready')
  assert.equal(r.entries[1].outcome, 'error')
  assert.equal(r.entries[1].code, MD_ERROR.E_EMPTY_NAME)
  assert.equal(r.summary.ready, 1)
  assert.equal(r.summary.error, 1)
})

/* ══ 9. 汇总计数 ═══════════════════════════════════════════════════════ */

test('★ 汇总计数正确（ready/skip/error/fileCount 各自对得上）', () => {
  const r = plan(
    [
      item({ name: 'a.jpg', ext: '.jpg' }),
      item({ name: 'b.jpg', ext: '.jpg', srcPath: 'D:\\源\\b2\\b.jpg' }),
      item({ name: 'b.jpg', ext: '.jpg', srcPath: 'D:\\源\\b3\\b.jpg' }),
    ],
    'same',
    (p) => p === 'D:\\合并目标\\a.jpg',
  )
  assert.equal(r.fileCount, 3)
  assert.equal(r.summary.ready, 1, 'a.jpg：磁盘无冲突')
  assert.equal(r.summary.skip, 2, '两个 b.jpg：1 磁盘冲突 + 1 批量冲突')
  assert.equal(r.summary.error, 0)
})

/* ══ 10. 混合源（文件 + 文件夹）干跑的落点（bug 报障 ② 回归守护）══════ */

test('★ 混合源：单独文件 + 文件夹内文件 → 各自落点、互不冲突、全部 ready', () => {
  const r = plan(
    [
      // 拖入的「单独文件」
      item({ name: '单独.txt', ext: '.txt', srcPath: 'D:\\源\\单独.txt' }),
      // 来自某个文件夹、递归摊平后的子文件
      item({ name: 'a.png', ext: '.png', srcPath: 'D:\\源\\资料\\a.png' }),
      item({ name: 'b.png', ext: '.png', srcPath: 'D:\\源\\资料\\子\\b.png' }),
    ],
    'same',
  )
  assert.equal(r.rejected, undefined, '混合源不应被结构性拒绝')
  assert.equal(r.fileCount, 3)
  assert.equal(r.entries.length, 3)
  assert.deepEqual(r.entries.map((e) => e.outcome), ['ready', 'ready', 'ready'], '三者落点不同、均 ready')
  assert.equal(r.summary.ready, 3)
  assert.equal(r.summary.skip, 0)
  assert.equal(r.summary.error, 0)
})
