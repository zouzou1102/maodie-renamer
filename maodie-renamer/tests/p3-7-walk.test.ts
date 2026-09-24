/**
 * P3-7（文件夹合并 · 第 7 批）· `walkSources` 递归摊平 walker 单测。
 *
 * 运行：`npm run test:core`（必须显式传本文件，见 package.json 的 test:core）。
 *
 * 盯这些事（对应设计 §10 测试要求 + 护栏 DEC-01 / DEC-25）：
 *  1. ★ 普通递归：recurse=true 把多层子目录里的文件全部摊平成「文件」清单（文件夹本身不进清单）。
 *  2. 不递归：recurse=false 把选中的文件夹当成一个整体 item（不展开内部）。
 *  3. ★ junction 不递归：符号链接 / 目录连接自身作为 item，其内部**绝不**展开（防死循环 / 防整盘复制）。
 *  4. ★ 深度上限（DEC-25）：嵌套超过 FLATTEN_MAX_DEPTH(20) 后停止递归，封顶那层文件夹作为 item（截断不是拒绝）。
 *  5. ★ 文件数上限（EX-19）：单文件夹文件超过 FLATTEN_MAX_FILES(10000) → 整体拒绝 E_FLATTEN_OVERFLOW，返回空清单。
 *  6. 空文件夹（recurse=true）：0 个文件、无错误（后续由 computeMergePlan 判 E_LIST_EMPTY）。
 *  7. 直接选文件：源是单个文件 → 它自己作为一条 item（含正确 ext）。
 *
 * 规矩同前：只用 `node:test` + `node:assert`，不引入任何第三方框架。
 * 红线：**绝不为让测试变绿而放宽 / 跳过 / 删断言。**
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { walkSources } from '../src/main/services/fs-walk'
import { MD_ERROR } from '../src/shared/errors'

const ROOT = process.cwd()
assert.ok(
  fs.existsSync(path.join(ROOT, 'package.json')),
  `单测必须在工程根目录下运行（当前 cwd = ${ROOT}）—— 用 npm run test:core`,
)

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'md-walk-'))
}
function write(p: string, content = 'x'): void {
  fs.writeFileSync(p, content)
}

/* ══ 1. 普通递归展开 ═════════════════════════════════════════════════ */

test('★ 普通递归：recurse=true 把多层子目录里的文件全部摊平成文件清单', async (t) => {
  const dir = tmpDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  write(path.join(dir, 'file1.txt'))
  const sub = path.join(dir, 'sub')
  fs.mkdirSync(sub)
  write(path.join(sub, 'file2.txt'))
  const sub2 = path.join(sub, 'sub2')
  fs.mkdirSync(sub2)
  write(path.join(sub2, 'file3.txt'))

  const r = await walkSources([dir], true)
  assert.equal(r.error, undefined, '不应有超限等结构化错误')
  const names = r.files.map((f) => f.name).sort()
  assert.deepEqual(names, ['file1.txt', 'file2.txt', 'file3.txt'], '三层里的三个文件都应摊平出来')
  // 文件夹本身不被当成 item（已全部展开）
  assert.ok(r.files.every((f) => f.isDir === false), '摊平结果里不应混进文件夹')
  // 落点是绝对路径（resolve 归一化）
  assert.ok(r.files.every((f) => path.isAbsolute(f.srcPath)), 'srcPath 必须是绝对路径')
})

/* ══ 2. 不递归（recurse=false）════════════════════════════════════════ */

test('不递归：recurse=false 把选中的文件夹当成一个整体 item（不展开内部）', async (t) => {
  const dir = tmpDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  write(path.join(dir, 'file1.txt'))
  const sub = path.join(dir, 'sub')
  fs.mkdirSync(sub)
  write(path.join(sub, 'file2.txt'))

  const r = await walkSources([dir], false)
  assert.equal(r.error, undefined)
  assert.equal(r.files.length, 1, '只有源文件夹自身一项')
  assert.equal(r.files[0].isDir, true)
  assert.equal(r.files[0].name, path.basename(dir))
})

/* ══ 3. junction 不递归 ═══════════════════════════════════════════════ */

test('★ junction 不递归：链接自身作为 item，其内部不展开（防死循环 / 防整盘复制）', async (t) => {
  const dir = tmpDir()
  // "外面"的目录放在 dir 同级（不是 dir 内部），junction 指向它。
  // 这样若代码错误地跟随了 junction，deep.txt 就会出现 → 测试失败。
  const outside = path.join(path.dirname(dir), `md-walk-out-${path.basename(dir)}`)
  fs.mkdirSync(outside)
  write(path.join(outside, 'deep.txt'))
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  })
  write(path.join(dir, 'file1.txt'))
  const link = path.join(dir, 'link')
  fs.symlinkSync(outside, link, 'junction')

  const r = await walkSources([dir], true)
  assert.equal(r.error, undefined)
  const names = r.files.map((f) => f.name).sort()
  assert.deepEqual(names, ['file1.txt', 'link'], 'junction 内部 (deep.txt) 绝不能出现')
  // junction 自身作为 item，且 lstat 报告 isSymbolicLink=true → isDir=false
  const linkItem = r.files.find((f) => f.name === 'link')!
  assert.equal(linkItem.isDir, false)
})

/* ══ 4. 深度上限（DEC-25）════════════════════════════════════════════ */

test('★ 深度上限（DEC-25）：嵌套超过 FLATTEN_MAX_DEPTH 后停止递归，封顶层作为 item', async (t) => {
  const dir = tmpDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  // 造一条 24 层深的链：dir/d1/d2/.../d24（全空文件夹，无文件）
  let cur = dir
  for (let i = 1; i <= 24; i++) {
    cur = path.join(cur, `d${i}`)
    fs.mkdirSync(cur)
  }

  const r = await walkSources([dir], true)
  assert.equal(r.error, undefined, '深度超限是"截断"不是"拒绝"')
  assert.equal(r.files.length, 1, '只有撞到深度上限的那一层被当 item')
  assert.equal(r.files[0].isDir, true)
  // dir=depth0, d1=depth1 ... d20=depth20 触发封顶（depth<20 才继续）；d21..d24 不会被访问
  assert.equal(r.files[0].name, 'd20')
})

/* ══ 5. 文件数上限（EX-19）════════════════════════════════════════════ */

test('★ 文件数上限（EX-19）：单文件夹文件超过 FLATTEN_MAX_FILES 整体拒绝 E_FLATTEN_OVERFLOW', async (t) => {
  const dir = tmpDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  // 造 10001 个文件（> 10000 上限）
  for (let i = 0; i < 10001; i++) {
    write(path.join(dir, `f${i}.txt`))
  }

  const r = await walkSources([dir], true)
  assert.ok(r.error, '应触发超限拒绝')
  assert.equal(r.error!.code, MD_ERROR.E_FLATTEN_OVERFLOW, 'EX-19')
  assert.equal(r.files.length, 0, '超限时返回空清单（不部分执行，避免复制一半）')
})

/* ══ 6. 空文件夹 ═══════════════════════════════════════════════════════ */

test('空文件夹（recurse=true）：内容为空 → 0 个文件、无错误', async (t) => {
  const dir = tmpDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const r = await walkSources([dir], true)
  assert.equal(r.error, undefined)
  assert.equal(r.files.length, 0, '随后由 computeMergePlan 判 E_LIST_EMPTY')
})

/* ══ 7. 直接选文件（非文件夹）═════════════════════════════════════════ */

test('直接选文件：源是单个文件 → 它自己作为一条 item', async (t) => {
  const dir = tmpDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const f = path.join(dir, '单文件.jpg')
  write(f)

  const r = await walkSources([f], true)
  assert.equal(r.error, undefined)
  assert.equal(r.files.length, 1)
  assert.equal(r.files[0].name, '单文件.jpg')
  assert.equal(r.files[0].isDir, false)
  assert.equal(r.files[0].ext, '.jpg', '扩展名由 splitName 正确取出')
})
