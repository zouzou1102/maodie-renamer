/**
 * P1（F-10 正则表达式 / F-11 大小写转换）—— 共享层单测。
 *
 * 运行：`npm run test:core`
 *   = `node --import tsx --test tests/p1-rules.test.ts`
 *
 * 规矩（项目既定，2026-09-14）：不引入第三方测试框架 —— 只用运行时内置的
 * `node:test` + `node:assert`；被测逻辑就是 `src/shared/` 里那份唯一源码
 * （预览 Worker 与主进程执行器共用同一份，所以这里测过就等于两边都测过）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyCaseTransform,
  applyDelete,
  applyReplace,
  compileRegex,
  computeNewStem,
  REGEX_MAX_LENGTH,
} from '../src/shared/rule-engine'
import { buildRuleSummary } from '../src/shared/rule-summary'
import { joinName, splitName } from '../src/shared/name-split'
import { REGEX_CHEATSHEET, REGEX_DEMO_FILE } from '../src/shared/regex-cheatsheet'
import { DEFAULT_RULE, type RuleConfig } from '../src/shared/types'

function rule(
  patch: Partial<RuleConfig> = {},
  rulePatch: Partial<RuleConfig['rule']> = {},
): RuleConfig {
  return { ...DEFAULT_RULE, ...patch, rule: { ...DEFAULT_RULE.rule, ...rulePatch } }
}

/**
 * 规则上下文工厂。
 * P3-1 给 `RuleContext` 加了必填的 `seedKey`（「随机字符」类型的种子来源）。
 * 本文件用的都是数字 / 日期，用不到它，所以给一个固定值 —— **断言本身一个字没改**。
 */
const ctx = (index = 0, total = 1, date = '2026-09-11', seedKey = 'seed-fixed') => ({
  index,
  total,
  date,
  seedKey,
  attrs: { created: '', modified: '', sizeBytes: null },
})

/* ── TC-21 正则删除 ─────────────────────────────────────────────────── */

test('TC-21 正则删除：删除 \\d+ → abc', () => {
  const r = rule({ mode: 'delete', regexEnabled: true, delete: { text: '\\d+' } })
  assert.equal(computeNewStem({ stem: 'abc123', ext: '.txt' }, r, ctx()), 'abc')
})

/* ── TC-22 捕获组替换 ───────────────────────────────────────────────── */

test('TC-22 正则捕获组替换：$2/$1', () => {
  const r = rule({
    mode: 'replace',
    regexEnabled: true,
    replace: { find: '(\\d{4})-(\\d{2})', to: '$2/$1' },
  })
  assert.equal(computeNewStem({ stem: '2026-09', ext: '.txt' }, r, ctx()), '09/2026')
})

/* ── F-10 替换串细节 ───────────────────────────────────────────────── */

test('F-10 $0 = 整体匹配；$1 越界展开为空串', () => {
  assert.equal(applyReplace('abc', 'b', '[$0]', false, true), 'a[b]c')
  assert.equal(applyReplace('abc', 'b', '$1', false, true), 'ac')
  assert.equal(applyReplace('2026-09', '(\\d{4})-(\\d{2})', '$2/$1', false, true), '09/2026')
})

test('F-10 默认不区分大小写；开启区分后只匹配大小写一致处', () => {
  assert.equal(applyDelete('ABCabc', 'abc', false, true), '')
  assert.equal(applyDelete('ABCabc', 'abc', true, true), 'ABC')
})

test('F-10 空 pattern 规则不生效（与 P0 空规则一致，且不是错误）', () => {
  assert.deepEqual(compileRegex('', false), { regex: null, error: null })
  const r = rule({ mode: 'delete', regexEnabled: true, delete: { text: '' } })
  assert.equal(computeNewStem({ stem: 'abc', ext: '' }, r, ctx()), 'abc')
})

test('F-10 零宽匹配不死循环', () => {
  assert.equal(applyReplace('abc', 'x*', '-', false, true), '-a-b-c-')
})

test('F-10 pattern 长度上限 200', () => {
  assert.equal(compileRegex('a'.repeat(REGEX_MAX_LENGTH), false).error, null)
  assert.ok(compileRegex('a'.repeat(REGEX_MAX_LENGTH + 1), false).error)
})

/* ── TC-23 非法正则 ─────────────────────────────────────────────────── */

test('TC-23 正则非法：编译给出中文原因，引擎降级为不改且不抛错', () => {
  const res = compileRegex('(', false)
  assert.equal(res.regex, null)
  const err = res.error
  assert.ok(err)
  assert.match(err, /右括号/)
  const r = rule({ mode: 'delete', regexEnabled: true, delete: { text: '(' } })
  assert.equal(computeNewStem({ stem: 'abc', ext: '' }, r, ctx()), 'abc')
})

/* ── TC-24 大小写保护扩展名 ─────────────────────────────────────────── */

test('TC-24 大小写只作用主体，扩展名保持大写：IMG_0001.JPG → img_0001.JPG', () => {
  const parts = { stem: 'IMG_0001', ext: '.JPG' }
  const r = rule({ mode: 'delete', caseTransform: 'lower', delete: { text: '' } })
  const stem = computeNewStem(parts, r, ctx())
  assert.equal(stem, 'img_0001')
  assert.equal(stem + parts.ext, 'img_0001.JPG')
})

/* ── F-11 四种取值与边界 ────────────────────────────────────────────── */

test('F-11 大小写四种取值', () => {
  assert.equal(applyCaseTransform('AbC', 'none'), 'AbC')
  assert.equal(applyCaseTransform('AbC', 'lower'), 'abc')
  assert.equal(applyCaseTransform('AbC', 'upper'), 'ABC')
  assert.equal(applyCaseTransform('meetingNotes', 'capitalize'), 'MeetingNotes')
  assert.equal(applyCaseTransform('中文name', 'capitalize'), '中文name')
  assert.equal(applyCaseTransform('', 'capitalize'), '')
})

test('F-11 特殊字符：ß 转大写变 SS（字符数变化，交给冲突流程，不算错）', () => {
  assert.equal(applyCaseTransform('straße', 'upper'), 'STRASSE')
})

/* ── 执行顺序：先模式、后大小写（设计 §5 唯一权威）────────────────── */

test('执行顺序：先按模式算主体，再整体做大小写', () => {
  const r = rule({ mode: 'delete', regexEnabled: true, caseTransform: 'lower', delete: { text: '\\d+' } })
  assert.equal(computeNewStem({ stem: 'ABC123', ext: '' }, r, ctx()), 'abc')
})

/* ── 规则摘要（设计 §8）────────────────────────────────────────────── */

test('规则摘要：正则标记与大小写后缀', () => {
  assert.equal(
    buildRuleSummary(rule({ mode: 'delete', regexEnabled: true, delete: { text: '\\d+' } })),
    '删除「\\d+」（正则）',
  )
  assert.equal(
    buildRuleSummary(
      rule({ mode: 'replace', regexEnabled: true, replace: { find: '(\\d{4})-(\\d{2})', to: '$2/$1' } }),
    ),
    '替换「(\\d{4})-(\\d{2})」→「$2/$1」（正则）',
  )
  assert.equal(
    buildRuleSummary(rule({ mode: 'delete', delete: { text: '广告' }, caseTransform: 'lower' })),
    '删除「广告」 + 全部小写',
  )
  assert.equal(
    buildRuleSummary(rule({ mode: 'delete', regexEnabled: true, caseTransform: 'upper', delete: { text: 'x' } })),
    '删除「x」（正则） + 全部大写',
  )
  // 规则化模式不涉及匹配 → 不显示（正则）
  assert.equal(
    buildRuleSummary(rule({ mode: 'rule', regexEnabled: true }, { prefix: 'P' })),
    '前缀「P」 + 保留原名',
  )
})

/* ── TC-26 P0 逐字节回归（红线：正则关 + 大小写 none 必须与 P0 一致）── */

test('TC-26 回归：正则关 + 大小写 none 时，输出与 P0 逐字节一致', () => {
  assert.equal(
    computeNewStem({ stem: 'abc广告', ext: '.txt' }, rule({ mode: 'delete', delete: { text: '广告' } }), ctx()),
    'abc',
  )
  assert.equal(
    computeNewStem(
      { stem: '会议纪要-最终版', ext: '.docx' },
      rule({ mode: 'replace', replace: { find: '最终版', to: '定稿' } }),
      ctx(),
    ),
    '会议纪要-定稿',
  )
  assert.equal(
    computeNewStem({ stem: 'ABC广告abc', ext: '' }, rule({ mode: 'delete', delete: { text: 'abc' } }), ctx()),
    '广告',
  )
  assert.equal(
    computeNewStem({ stem: 'a', ext: '' }, rule({ mode: 'replace', replace: { find: 'a', to: 'aa' } }), ctx()),
    'aa',
  )
  const r = rule({ mode: 'rule' }, { prefix: 'P-', suffix: '-S', seqEnabled: true, seqStart: 1, seqPad: 3 })
  assert.equal(computeNewStem({ stem: '名字', ext: '' }, r, ctx()), 'P-名字-S001')
  // 显式把两个新字段设为默认值，防止将来默认值被误改而无人发现
  const r2 = rule({ mode: 'delete', regexEnabled: false, caseTransform: 'none', delete: { text: '广告' } })
  assert.equal(computeNewStem({ stem: 'abc广告', ext: '' }, r2, ctx()), 'abc')
})

test('TC-26 回归：旧的 3 参调用仍可用（向后兼容）', () => {
  assert.equal(applyDelete('abc广告', '广告', false), 'abc')
  assert.equal(applyReplace('会议纪要-最终版', '最终版', '定稿', false), '会议纪要-定稿')
})

/* ── 照抄表（EL-104）与当场演示（EL-105）───────────────────────────────
   这两块是「给新手看的说明」。说明里的每个结果都由引擎真算一遍 ——
   否则文案写歪了（比如将来改了引擎行为）没有任何东西会发现。
   这就是它们当初被放进 src/shared/ 而不是组件里的原因。 */

test('照抄表：每一行写的结果，都与引擎真算的完全一致', () => {
  assert.ok(REGEX_CHEATSHEET.length > 0, '照抄表不能是空的')
  for (const row of REGEX_CHEATSHEET) {
    const where = `照抄表「${row.goal}」`
    // 不变式：删除模式没有「替换框」，所以含 delete 的行替换内容必须留空
    if (row.modes.includes('delete')) {
      assert.equal(row.to, '', `${where}：含删除模式的行，替换框必须留空`)
      assert.equal(
        applyDelete(row.sampleFrom, row.find, false, true),
        row.sampleTo,
        `${where}：删除模式算出来的结果与表里写的不一致`,
      )
    }
    if (row.modes.includes('replace')) {
      assert.equal(
        applyReplace(row.sampleFrom, row.find, row.to, false, true),
        row.sampleTo,
        `${where}：替换模式算出来的结果与表里写的不一致`,
      )
    }
  }
})

test('照抄表：删除模式的行不会带 $1（那个在删除模式里根本没法填）', () => {
  for (const row of REGEX_CHEATSHEET.filter((r) => r.modes.includes('delete'))) {
    assert.ok(!row.to.includes('$'), `照抄表「${row.goal}」：删除模式的行不该出现 $n`)
  }
})

test('当场演示（EL-105）：示例名字拆出主体与扩展名，扩展名不参与规则', () => {
  const parts = splitName(REGEX_DEMO_FILE, false)
  assert.equal(parts.stem, '发票 2026-08-01')
  assert.equal(parts.ext, '.pdf')
  // 用照抄表里的写法跑一遍端到端（与组件里调的是同一个函数）
  assert.equal(
    joinName(applyReplace(parts.stem, '(\\d{4})-(\\d{2})-(\\d{2})', '$1年$2月$3日', false, true), parts.ext),
    '发票 2026年08月01日.pdf',
  )
})
