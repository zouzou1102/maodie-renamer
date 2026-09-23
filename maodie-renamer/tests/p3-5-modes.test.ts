/**
 * P3-5（三模式 → 五模式 + 扩展名更改 + 只用编号）—— 单测。
 *
 * 运行：`npm run test:core`（**必须显式传本文件**，见 package.json 的 test:core）。
 *
 * 这个文件盯八件事（对应设计 §10 的测试要求）：
 *  1. `applyInsert`：位置 0 / 中 / 越界 / 负数 / 空文字；**按码点切**（emoji 不被劈）；不认变量。
 *  2. `extText`：四档各自正确；**文件夹恒不生效**；点的规范化；空值组合。
 *  3. **五个模式各走各的引擎分支**（TC-68）—— ★ 唯一能抓「兜底式代码吞掉新模式」的一条。
 *  4. **冗余关系不变量** `newName === newStem + ext`（改扩展名后仍要成立）——抓 `stemOf` 没跟着改。
 *  5. `sanitizeRule` 认五个模式值，且 `insert` / `import` **不会被吞成 `delete`**（§7.5 第 1 行唯一防线）。
 *  6. `cli-args` 五模式两两互斥；`--insert` / `--table` 解析。
 *  7. `rule-summary` 五模式各自成文；**老模式（`rule`）逐字节不变**。
 *  8. ★ `override` **只在导入模式生效**（第 4 批的「叠加覆盖层」已收回）+ 老行为不变。
 *
 * 规矩同前：只用 `node:test` + `node:assert`，不引入任何第三方框架。
 * 红线：**绝不为让测试变绿而放宽 / 跳过 / 删断言。**
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { parseCliArgs } from '../src/shared/cli-args'
import { resolveItems } from '../src/shared/preview'
import { applyInsert, extText } from '../src/shared/rule-engine'
import { buildRuleSummary } from '../src/shared/rule-summary'
import { sanitizeRule } from '../src/shared/sanitize-rule'
import { cloneTemplateRule, RULE_TEMPLATES } from '../src/shared/templates'
import { DEFAULT_RULE, type ItemAttrs, type RuleConfig } from '../src/shared/types'

const ROOT = process.cwd()
assert.ok(
  fs.existsSync(path.join(ROOT, 'package.json')),
  `单测必须在工程根目录下运行（当前 cwd = ${ROOT}）—— 用 npm run test:core`,
)

/* ══ 夹具 ═════════════════════════════════════════════════════════════ */

const NO_ATTRS: ItemAttrs = { created: '', modified: '', sizeBytes: null }

/**
 * 造一份完整 RuleConfig：从 DEFAULT_RULE 起底，四个子对象**逐层深合并**。
 *
 * ⚠️ 四个子对象的类型必须是 `Partial<...>` —— 直接写 `Partial<RuleConfig>` 的话
 *   `rule` 会要求**完整**的字段，`cfg({ rule: { prefix: 'P_' } })` 编译不过。
 *   而 `npm run test:core` 走 tsx、**不做类型检查**，只有 `npm run build` 的 tsc 才会红。
 */
type CfgPatch = Partial<Omit<RuleConfig, 'delete' | 'replace' | 'rule' | 'insert'>> & {
  delete?: Partial<RuleConfig['delete']>
  replace?: Partial<RuleConfig['replace']>
  rule?: Partial<RuleConfig['rule']>
  insert?: Partial<RuleConfig['insert']>
}

function cfg(patch: CfgPatch = {}): RuleConfig {
  return {
    ...DEFAULT_RULE,
    ...patch,
    delete: { ...DEFAULT_RULE.delete, ...(patch.delete ?? {}) },
    replace: { ...DEFAULT_RULE.replace, ...(patch.replace ?? {}) },
    insert: { ...DEFAULT_RULE.insert, ...(patch.insert ?? {}) },
    rule: { ...DEFAULT_RULE.rule, ...(patch.rule ?? {}) },
  }
}

/** 算一项（走真正的 resolveItems —— 与预览 / 执行同一条路）*/
function one(
  fromName: string,
  rule: RuleConfig,
  override?: { stem: string; sourceTable: string },
): ReturnType<typeof resolveItems>[number] {
  const out = resolveItems(
    [{ id: 'f1', dirPath: 'C:\\tmp', fromName, isDir: false, attrs: NO_ATTRS, override }],
    rule,
    '2026-09-23',
    {},
    false,
  )
  return out[0]!
}

/* ══ 1. applyInsert ═══════════════════════════════════════════════════ */

test('applyInsert：位置 0 = 前缀、中间、越界落末尾、负数当 0、空文字不生效', () => {
  assert.equal(applyInsert('素材', 0, 'X_'), 'X_素材', '位置 0 等价于前缀')
  assert.equal(applyInsert('素材', 1, 'X'), '素X材', '中间插入')
  assert.equal(applyInsert('素材', 99, '_终'), '素材_终', '越界自动落到末尾，不报错')
  assert.equal(applyInsert('素材', -5, 'A'), 'A素材', '负数当 0')
  assert.equal(applyInsert('素材', 2, ''), '素材', '插入文字为空 = 规则不生效')
})

test('applyInsert：按码点切 —— emoji 绝不被劈成半个代理对（否则生成非法文件名）', () => {
  const stem = '😀😀'
  const out = applyInsert(stem, 1, '_')
  assert.equal(out, '😀_😀')
  assert.equal(Array.from(out).length, 3, '必须是 3 个码点')
  // 反向证据：按 UTF-16 单元切（`stem.charAt(0) + '_' + stem.slice(1)`）会插进两个代理对之间
  assert.notEqual(out, stem.charAt(0) + '_' + stem.slice(1), '不能是按 UTF-16 单元切的产物')
})

test('applyInsert：插入模式不认识变量 —— {n} / {d} 原样插进去', () => {
  assert.equal(applyInsert('A', 1, '{n}'), 'A{n}', '变量必须原样，不做替换（设计 §4 边界 5）')
})

/* ══ 2. extText ═══════════════════════════════════════════════════════ */

test('extText：四档各自正确；默认 keep = 原样', () => {
  assert.equal(extText('.docx', false, 'keep', ''), '.docx', '默认档：一个字不变')
  assert.equal(extText('.docx', false, 'set', 'pdf'), '.pdf')
  assert.equal(extText('.docx', false, 'set', '.pdf'), '.pdf', '打不打点都行')
  assert.equal(extText('.docx', false, 'remove', 'x'), '', '删掉扩展名')
  assert.equal(extText('.docx', false, 'append', 'bak'), '.docx.bak', '后面再加一个')
})

test('extText：文件夹一律不生效（任何档位都改不了文件夹）', () => {
  for (const m of ['keep', 'set', 'remove', 'append'] as const) {
    assert.equal(extText('', true, m, 'pdf'), '', `文件夹（ext 空）在 ${m} 档下不该变`)
    assert.equal(extText('.x', true, m, 'pdf'), '.x', `文件夹在 ${m} 档下应原样返回`)
  }
})

test('extText：点的规范化（pdf / .pdf / pdf. / .pdf. / ..pdf 等价；全是点退化成空）', () => {
  assert.equal(extText('', false, 'set', 'pdf'), '.pdf')
  assert.equal(extText('', false, 'set', '.pdf'), '.pdf')
  assert.equal(extText('', false, 'set', 'pdf.'), '.pdf')
  assert.equal(extText('', false, 'set', '.pdf.'), '.pdf')
  assert.equal(extText('', false, 'set', '..pdf'), '.pdf')
  assert.equal(extText('', false, 'set', '...'), '', '全是点 → 退化空串（等价删掉扩展名）')
  assert.equal(extText('', false, 'set', ''), '')
})

test('extText：本来没扩展名 / append 空值', () => {
  assert.equal(extText('', false, 'set', 'pdf'), '.pdf', 'README + 改成 pdf → README.pdf')
  assert.equal(extText('', false, 'append', 'bak'), '.bak')
  assert.equal(extText('.docx', false, 'append', ''), '.docx', 'append 空值 = 保持原样')
})

/* ══ 3. 五个模式各走各的分支（TC-68）══════════════════════════════════ */

test('★★ 五个模式各自真的走到各自的引擎分支（TC-68 —— 抓「兜底式代码」的唯一断言）', () => {
  assert.equal(one('abc.txt', cfg({ mode: 'delete', delete: { text: 'b' } })).toName, 'ac.txt')
  assert.equal(one('abc.txt', cfg({ mode: 'replace', replace: { find: 'b', to: 'X' } })).toName, 'aXc.txt')
  assert.equal(one('abc.txt', cfg({ mode: 'rule', rule: { prefix: 'P_' } })).toName, 'P_abc.txt')
  // ★ 这一条是核心：选「插入」必须真的插入，而不是被当成删除 / 自定义
  assert.equal(one('abc.txt', cfg({ mode: 'insert', insert: { at: 1, text: 'X' } })).toName, 'aXbc.txt')
  // 导入模式 + 无表项 → 保持原名不动（引擎不参与）
  assert.equal(one('abc.txt', cfg({ mode: 'import' })).toName, 'abc.txt')
})

/* ══ 4. 冗余关系不变量 ════════════════════════════════════════════════ */

test('★ 冗余不变量：开着扩展名处理时 newName === newStem + ext（抓 stemOf 没跟着改）', () => {
  const it = one('报告.docx', cfg({ mode: 'rule', extMode: 'set', extValue: 'pdf' }))
  assert.equal(it.toName, '报告.pdf')
  assert.equal(it.ext, '.pdf')
  assert.equal(it.newStem, '报告')
  assert.equal(it.toName, it.newStem + it.ext, '★ 接口文档承诺的冗余关系')
})

test('★ 冗余不变量：append 档（.docx.bak）也必须成立', () => {
  const it = one('报告.docx', cfg({ mode: 'rule', extMode: 'append', extValue: 'bak' }))
  assert.equal(it.toName, '报告.docx.bak')
  assert.equal(it.newStem, '报告')
  assert.equal(it.toName, it.newStem + it.ext)
})

test('★ 冗余不变量：删掉扩展名时（ext 变空）也成立', () => {
  const it = one('报告.docx', cfg({ mode: 'rule', extMode: 'remove' }))
  assert.equal(it.toName, '报告')
  assert.equal(it.ext, '')
  assert.equal(it.toName, it.newStem + it.ext)
})

/* ══ 5. sanitizeRule 五个模式值 ═══════════════════════════════════════ */

test('★★ sanitizeRule：五个模式值都能原样取出；insert / import 不会被吞成 delete', () => {
  for (const m of ['delete', 'replace', 'rule', 'insert', 'import'] as const) {
    assert.equal(sanitizeRule({ mode: m }).mode, m, `模式 ${m} 必须原样保留`)
  }
  // ★ 这两条是 §7.5 第 1 行的唯一防线：从前 `?: 'delete'` 兜底会把新值静默吞掉
  assert.notEqual(sanitizeRule({ mode: 'insert' }).mode, 'delete', '★ 插入绝不能被吞成删除')
  assert.notEqual(sanitizeRule({ mode: 'import' }).mode, 'delete', '★ 导入绝不能被吞成删除')
})

test('★ sanitizeRule：新字段逐字段收口（extMode / extValue / insert）', () => {
  const s = sanitizeRule({ extMode: 'append', extValue: 'bak', insert: { at: 7, text: 'Q' } })
  assert.equal(s.extMode, 'append')
  assert.equal(s.extValue, 'bak')
  assert.equal(s.insert.at, 7)
  assert.equal(s.insert.text, 'Q')
  assert.equal(sanitizeRule({ extMode: '不存在的档' }).extMode, 'keep', '不认识的档回落 keep')
  assert.equal(sanitizeRule({ insert: { at: -3 } }).insert.at, 0, '插入位置负数当 0')
})

/* ══ 6. cli-args 互斥 ═════════════════════════════════════════════════ */

test('★ cli-args：五模式两两冲突各一条（--insert 与 --delete 必须被拒绝，不能静默接受）', () => {
  const base = ['--rename', '--dir', 'D:\\x']
  const pairs: Array<[string[], string[]]> = [
    [['--delete', 'a'], ['--replace', 'a', 'b']],
    [['--delete', 'a'], ['--insert', '0:x']],
    [['--delete', 'a'], ['--table', 't.csv']],
    [['--delete', 'a'], ['--prefix', 'p']],
    [['--replace', 'a', 'b'], ['--insert', '0:x']],
    [['--replace', 'a', 'b'], ['--table', 't.csv']],
    [['--insert', '0:x'], ['--table', 't.csv']],
    [['--insert', '0:x'], ['--prefix', 'p']],
    [['--table', 't.csv'], ['--prefix', 'p']],
  ]
  for (const [a, b] of pairs) {
    const r = parseCliArgs([...base, ...a, ...b])
    assert.equal(r.ok, false, `应拒绝：${a.join(' ')} + ${b.join(' ')}`)
  }
})

test('★ cli-args：--insert / --table 的解析', () => {
  const r1 = parseCliArgs(['--rename', '--dir', 'D:\\x', '--insert', '2:2026'])
  assert.ok(r1.ok, '应能解析 --insert 2:2026')
  if (r1.ok) {
    assert.equal(r1.options.rule.mode, 'insert')
    assert.deepEqual(r1.options.rule.insert, { at: 2, text: '2026' })
  }
  const r2 = parseCliArgs(['--rename', '--dir', 'D:\\x', '--insert', '2026'])
  assert.ok(r2.ok)
  if (r2.ok) assert.deepEqual(r2.options.rule.insert, { at: 0, text: '2026' }, '没有 数字: 前缀 → 位置 0')

  const r3 = parseCliArgs(['--rename', '--dir', 'D:\\x', '--table', 'a.csv'])
  assert.ok(r3.ok, '应能解析 --table')
  if (r3.ok) {
    assert.equal(r3.options.rule.mode, 'import')
    assert.equal(r3.options.table, 'a.csv')
  }
})

/* ══ 7. rule-summary ══════════════════════════════════════════════════ */

test('rule-summary：五个模式各自成文；老模式（rule）逐字节不变', () => {
  assert.equal(buildRuleSummary(cfg({ mode: 'delete', delete: { text: 'X' } })), '删除「X」')
  assert.equal(buildRuleSummary(cfg({ mode: 'replace', replace: { find: 'a', to: 'b' } })), '替换「a」→「b」')
  assert.ok(
    buildRuleSummary(cfg({ mode: 'insert', insert: { at: 2, text: 'Q' } })).includes('在第 2 个字后插入「Q」'),
    '插入的摘要要说清「第几个字后、插什么」',
  )
  assert.ok(
    buildRuleSummary(cfg({ mode: 'import' })).includes('名字来自导入的表格'),
    '导入的摘要要说清「名字来自表格」',
  )
  // ★ 老模式（自定义）的输出必须一个字不变 —— 它会被写进 history.json
  assert.equal(buildRuleSummary(cfg({ mode: 'rule', rule: { prefix: 'A_' } })), '前缀「A_」 + 保留原名')
})

/* ══ 8. override 的互斥语义 + 老行为不变 ══════════════════════════════ */

test('★★ override 只在导入模式生效（第 4 批的「叠加覆盖层」已收回成五选一互斥）', () => {
  const ov = { stem: '表里名', sourceTable: 't.xlsx' }
  // 自定义模式 + override → 表格**不生效**，走规则（前缀照加）
  assert.equal(
    one('素材.docx', cfg({ mode: 'rule', rule: { prefix: 'P_' } }), ov).toName,
    'P_素材.docx',
    '★ 非导入模式下，表格必须完全不生效',
  )
  // 导入模式 + override → 用表里的名字，且不经规则
  assert.equal(one('素材.docx', cfg({ mode: 'import', rule: { prefix: 'P_' } }), ov).toName, '表里名.docx')
})

test('★ 导入模式：表外的项「保持原名完全不动」（连大小写 / 扩展名处理都不作用于它们）', () => {
  assert.equal(
    one('ABC.docx', cfg({ mode: 'import', caseTransform: 'lower' })).toName,
    'ABC.docx',
    '表外项不能被「全部小写」改掉',
  )
  assert.equal(
    one('a.docx', cfg({ mode: 'import', extMode: 'set', extValue: 'pdf' })).toName,
    'a.docx',
    '表外项不能被扩展名处理改掉',
  )
  // 匹配上的项则扩展名处理照常生效
  assert.equal(
    one('a.docx', cfg({ mode: 'import', extMode: 'set', extValue: 'pdf' }), { stem: 'B', sourceTable: 't' })
      .toName,
    'B.pdf',
  )
})

test('老行为不变：extMode 默认 keep → 五个模式下扩展名都原样', () => {
  for (const m of ['delete', 'replace', 'rule', 'insert', 'import'] as const) {
    assert.equal(one('abc.docx', cfg({ mode: m })).ext, '.docx', `${m} 模式下扩展名不该被动`)
  }
})

/* ══ 附：第 7 个模板「只用编号」═══════════════════════════════════════ */

test('★ 第 7 个模板「只用编号」：丢原名、序号从头、不补零（设计 §3.5 的效果）', () => {
  const t = RULE_TEMPLATES.find((x) => x.id === 'seqOnly')
  assert.ok(t, '模板库里必须有「只用编号」')
  const r = cloneTemplateRule(t)
  assert.equal(r.mode, 'rule')
  assert.equal(r.rule.seqEnabled, true)
  assert.equal(r.rule.keepOriginal, false)
  assert.equal(r.rule.seqPad, 0, '不补零 → 得到 1 而不是 001')
  assert.equal(r.extMode, 'keep', '不带扩展名处理')
  assert.equal(one('照片A.jpg', r).toName, '1.jpg', '照片A.jpg → 1.jpg')
})
