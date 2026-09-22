/**
 * P3-1（编号系统升级）—— 单测。
 *
 * 运行：`npm run test:core`（**必须显式传本文件**，见 package.json 的 test:core）。
 *
 * 这个文件盯八件事（对应设计 §9 的 TC-42 ~ TC-49）：
 *  1. **TC-48（本批最重要）**：同一份规则，预览算出的新名与「过完主进程白名单再建计划」
 *     算出的新名**逐字节相等** —— 4 种类型 × 3 档位置共 12 组都跑。这是**唯一**能抓住
 *     `sanitizeRule` 漏字段的用例（漏了字段 = 预览对、执行错、界面无异常）。
 *  2. `sanitizeRule`：6 个新字段「喂进去 → 取出来相等」；非法值回落到合法默认。
 *  3. `toLetters` / `letterText`：Excel 列标序列（1→A、27→AA、702→ZZ、703→AAA），起始钳 ≥ 1。
 *  4. `randomText`：同一 seedKey 反复算**恒定**（预览 ≡ 执行的硬要求）、换 seedKey / 换种子会变、
 *     输出只含 `[a-z0-9]`。
 *  5. `addDays`：**纯整数算法**，跨月 / 跨年 / 闰年都对，且绝不产出不存在的日期。
 *  6. `dateText`：既有三档输出不变，新增两档正确。
 *  7. `applyRuleMode` 的第三档：正常 / k=0 / k=长度 / 越界 / 含 emoji / 不保留原名。
 *  8. **数字分支的输出逐字节不变**（P0/P1 回归），默认值下老行为完全一致。
 *
 * 规矩同前：只用 `node:test` + `node:assert`，不引入任何第三方框架。
 * 被测逻辑就是 `src/shared/` 里那**唯一一份**源码（预览 Worker 与主进程执行器共用它）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  addDays,
  applyRuleMode,
  computeNewStem,
  dateText,
  isYmd,
  letterText,
  randomText,
  seqText,
  toLetters,
} from '../src/shared/rule-engine'
import { sanitizeRule } from '../src/shared/sanitize-rule'
import { buildPreview } from '../src/shared/preview'
import { buildRenamePlan } from '../src/shared/rename-plan'
import { buildRuleSummary } from '../src/shared/rule-summary'
import { joinName, splitName } from '../src/shared/name-split'
import { todayYmd } from '../src/shared/today'
import { DEFAULT_RULE, type RuleConfig, type SeqKind, type SeqPosition } from '../src/shared/types'

const ROOT = process.cwd()
assert.ok(
  fs.existsSync(path.join(ROOT, 'package.json')),
  `单测必须在工程根目录下运行（当前 cwd = ${ROOT}）—— 用 npm run test:core`,
)

function rule(
  patch: Partial<RuleConfig> = {},
  rulePatch: Partial<RuleConfig['rule']> = {},
): RuleConfig {
  return { ...DEFAULT_RULE, ...patch, rule: { ...DEFAULT_RULE.rule, ...rulePatch } }
}

const ctx = (index = 0, total = 1, date = '2026-09-11', seedKey = 'test-seed') => ({
  index,
  total,
  date,
  seedKey,
  attrs: { created: '', modified: '', sizeBytes: null },
})

/** 模拟 IPC 的序列化往返（`undefined` 会丢键 —— 白名单漏字段最容易在这里露出来）*/
function overWire<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/* ══ 0. 默认值：老行为逐字节不变的地基 ══════════════════════════════════ */

test('DEFAULT_RULE 的 6 个新字段等于设计写的默认值（默认值 = 行为与 P0/P1 相同）', () => {
  assert.equal(DEFAULT_RULE.rule.seqKind, 'number')
  assert.equal(DEFAULT_RULE.rule.seqAt, 1)
  assert.equal(DEFAULT_RULE.rule.seqRandomLen, 6)
  assert.equal(DEFAULT_RULE.rule.seqRandomSeed, 0)
  assert.equal(DEFAULT_RULE.rule.seqTimeStart, '')
  assert.equal(DEFAULT_RULE.rule.seqTimeFormat, 'YYYY年MM月DD日')
})

test('数字分支的输出与 P0/P1 逐字节一致，且越界防御照旧（钉住 seqPad ≤ 6）', () => {
  assert.equal(seqText(rule({}, { seqStart: 1, seqStep: 1, seqPad: 3 }).rule, 0), '001')
  assert.equal(seqText(rule({}, { seqStart: 1, seqStep: 1, seqPad: 3 }).rule, 9), '010')
  assert.equal(seqText(rule({}, { seqStart: 5, seqStep: 2, seqPad: 3 }).rule, 2), '009')
  assert.equal(seqText(rule({}, { seqStart: 1, seqStep: 1, seqPad: 0 }).rule, 4), '5')
  assert.equal(seqText(rule({}, { seqStart: 0, seqStep: 1, seqPad: 2 }).rule, 0), '00')
  // ★ 这条钉住「补零上限 6」：P3-1 的「长度」刻意做成**独立字段**，就是为了不动它
  assert.equal(seqText(rule({}, { seqStart: -3, seqStep: 0, seqPad: 99 }).rule, 1), '000001')
})

test('seqKind 缺失（老数据 / 老 JSON）时按数字走，不报错', () => {
  const r = rule({}, { seqStart: 7, seqStep: 1, seqPad: 0 })
  const legacy = { ...r.rule } as Record<string, unknown>
  delete legacy.seqKind
  assert.equal(seqText(legacy as unknown as RuleConfig['rule'], 0), '7')
})

/* ══ TC-43 字母 = Excel 列标 ═══════════════════════════════════════════ */

test('TC-43 toLetters：1→A、26→Z、27→AA、702→ZZ、703→AAA', () => {
  assert.equal(toLetters(1), 'A')
  assert.equal(toLetters(26), 'Z')
  assert.equal(toLetters(27), 'AA')
  assert.equal(toLetters(702), 'ZZ')
  assert.equal(toLetters(703), 'AAA')
})

test('TC-43 toLetters：0 / 负数 / 非整数 / 非有限值都当 1（不报错、不弹提示）', () => {
  assert.equal(toLetters(0), 'A')
  assert.equal(toLetters(-3), 'A')
  assert.equal(toLetters(1.7), 'A')
  assert.equal(toLetters(Number.NaN), 'A')
  assert.equal(toLetters(Number.POSITIVE_INFINITY), 'A')
})

test('TC-43 letterText：起始 0 自动钳到 1；增量生效', () => {
  assert.equal(letterText(rule({}, { seqKind: 'letter', seqStart: 1, seqStep: 1 }).rule, 0), 'A')
  assert.equal(letterText(rule({}, { seqKind: 'letter', seqStart: 1, seqStep: 1 }).rule, 2), 'C')
  assert.equal(letterText(rule({}, { seqKind: 'letter', seqStart: 0, seqStep: 1 }).rule, 0), 'A')
  assert.equal(letterText(rule({}, { seqKind: 'letter', seqStart: -5, seqStep: 1 }).rule, 0), 'A')
  assert.equal(letterText(rule({}, { seqKind: 'letter', seqStart: 1, seqStep: 26 }).rule, 1), 'AA')
})

/* ══ TC-46 / TC-47 随机字符 ═══════════════════════════════════════════ */

const RANDOM_RULE = rule({}, { seqKind: 'random', seqRandomLen: 6, seqRandomSeed: 0 }).rule

test('TC-46 同一 seedKey + 同一 seed → 反复算 100 次结果完全相同（预览 ≡ 执行的硬要求）', () => {
  const first = randomText(RANDOM_RULE, ctx(0, 1, '2026-09-11', 'file-abc'))
  assert.equal(first.length, 6)
  for (let i = 0; i < 100; i++) {
    assert.equal(randomText(RANDOM_RULE, ctx(0, 1, '2026-09-11', 'file-abc')), first)
  }
})

test('TC-46 不同 seedKey → 结果不同；索引变了结果也不变（随机不依赖列表位置）', () => {
  const a = randomText(RANDOM_RULE, ctx(0, 5, '2026-09-11', 'file-a'))
  const b = randomText(RANDOM_RULE, ctx(0, 5, '2026-09-11', 'file-b'))
  assert.notEqual(a, b)
  // 同一个文件的随机串只认 seedKey，不认它在列表里的第几个 —— 否则调个顺序名字就变了
  assert.equal(randomText(RANDOM_RULE, ctx(3, 5, '2026-09-11', 'file-a')), a)
})

test('TC-47 「换一批」：种子 +1 后整批换掉，且不会回到上一批', () => {
  const s0 = randomText(RANDOM_RULE, ctx(0, 1, '2026-09-11', 'file-a'))
  const s1 = randomText(rule({}, { seqKind: 'random', seqRandomLen: 6, seqRandomSeed: 1 }).rule, ctx(0, 1, '2026-09-11', 'file-a'))
  const s2 = randomText(rule({}, { seqKind: 'random', seqRandomLen: 6, seqRandomSeed: 2 }).rule, ctx(0, 1, '2026-09-11', 'file-a'))
  assert.notEqual(s0, s1, '点了「换一批」但结果没变')
  assert.notEqual(s1, s2, '再点一次又变回上一批了')
  assert.notEqual(s0, s2)
})

test('随机字符输出只含 [a-z0-9]（天然合法文件名，且不掺大写避开 Windows 撞名）', () => {
  for (let i = 0; i < 1000; i++) {
    const s = randomText(RANDOM_RULE, ctx(0, 1, '2026-09-11', `k${i}`))
    assert.match(s, /^[a-z0-9]{6}$/, `第 ${i} 次出现了非法字符：${s}`)
  }
})

test('随机字符长度钳到 1–16（0 / 99 都不报错）', () => {
  assert.equal(randomText(rule({}, { seqKind: 'random', seqRandomLen: 1 }).rule, ctx()).length, 1)
  assert.equal(randomText(rule({}, { seqKind: 'random', seqRandomLen: 16 }).rule, ctx()).length, 16)
  assert.equal(randomText(rule({}, { seqKind: 'random', seqRandomLen: 0 }).rule, ctx()).length, 1)
  assert.equal(randomText(rule({}, { seqKind: 'random', seqRandomLen: 99 }).rule, ctx()).length, 16)
})

/* ══ TC-49 时间：纯整数日序 ════════════════════════════════════════════ */

/** 某年某月的天数（闰年规则写出来，好让下面的断言真的在验「日期存在」）*/
function daysInMonth(y: number, m: number): number {
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
}

/** 断言是一个**真实存在**的日期 —— 挡住 2026-09-31 / 2 月 30 日这类 */
function assertRealYmd(s: string): void {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  assert.ok(m, `不是 YYYY-MM-DD：${s}`)
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  assert.ok(mo >= 1 && mo <= 12, `月份非法：${s}`)
  assert.ok(d >= 1, `日非法：${s}`)
  assert.ok(d <= daysInMonth(y, mo), `这一天不存在：${s}（${y} 年 ${mo} 月只有 ${daysInMonth(y, mo)} 天）`)
}

test('TC-49 addDays：跨月 / 跨年 / 闰年（设计给的三个例子）', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02')
  assert.equal(addDays('2028-02-27', 1), '2028-02-28')
  assert.equal(addDays('2026-09-30', 1), '2026-10-01')
})

test('TC-49 addDays：闰年 29 天月 / 平年 2 月末 / 退一天', () => {
  assert.equal(addDays('2028-02-28', 1), '2028-02-29', '2028 是闰年，2 月该有 29 天')
  assert.equal(addDays('2028-02-29', 1), '2028-03-01')
  assert.equal(addDays('2027-02-28', 1), '2027-03-01', '2027 是平年，2 月只有 28 天')
  assert.equal(addDays('2026-01-01', -1), '2025-12-31')
  assert.equal(addDays('2026-09-18', 0), '2026-09-18')
})

test('TC-49 addDays：大数与负数扫一遍，**绝不产出不存在的日期**', () => {
  const starts = ['2026-01-31', '2026-12-31', '2028-02-29', '2100-02-28', '2000-02-29']
  for (const start of starts) {
    for (const n of [1, 28, 30, 31, 59, 60, 365, 366, 1000, 3650, -1, -365, -3650]) {
      assertRealYmd(addDays(start, n))
    }
  }
  // 加完再加回来必须回到原处（往返一致，且不依赖任何手算）
  for (const start of starts) {
    assert.equal(addDays(addDays(start, 1000), -1000), start)
    assert.equal(addDays(addDays(start, 3650), -3650), start)
  }
})

test('addDays / isYmd：输入不合法时原样返回，不抛错、不猜', () => {
  assert.equal(addDays('2026/09/18', 1), '2026/09/18')
  assert.equal(addDays('', 1), '')
  assert.equal(isYmd('2026-09-18'), true)
  assert.equal(isYmd('2026-13-01'), false)
  assert.equal(isYmd('2026-9-1'), false)
  assert.equal(isYmd('2026-09-18 '), false)
})

test('时间类型：起点 + 增量（天）；起点为空时回落到调用方给的目标日期', () => {
  // 位置**显式**设成 prefix：本用例只想看日期文本本身，所以让日期排在「a」前面。
  // （默认是 suffix、即日期排在末尾——那条路径由 TC-48 的 4 类型 × 3 档位置覆盖，不在此重复。）
  const r = rule({ mode: 'rule' }, {
    seqEnabled: true, seqKind: 'time', seqStep: 1, seqPosition: 'prefix',
    seqStart: 1, seqPad: 0, seqTimeStart: '2026-09-18', seqTimeFormat: 'YYYY-MM-DD', keepOriginal: true,
  })
  assert.equal(applyRuleMode('a', r.rule, ctx(0, 3)), '2026-09-18a')
  assert.equal(applyRuleMode('a', r.rule, ctx(1, 3)), '2026-09-19a')
  assert.equal(applyRuleMode('a', r.rule, ctx(2, 3)), '2026-09-20a')

  const weekly = rule({ mode: 'rule' }, { ...r.rule, seqStep: 7 })
  assert.equal(applyRuleMode('a', weekly.rule, ctx(2, 3)), '2026-10-02a', '增量 7 天 = 一周一个')

  // 起点没填 → 用调用方传进来的目标日期（引擎自己从不读时钟，DEC-03）
  const empty = rule({ mode: 'rule' }, { ...r.rule, seqTimeStart: '' })
  assert.equal(applyRuleMode('a', empty.rule, ctx(0, 1, '2026-01-02')), '2026-01-02a')
})

/* ══ 日期样式 5 档 ════════════════════════════════════════════════════ */

test('dateText：既有三档输出不变，新增两档正确', () => {
  assert.equal(dateText('2026-09-11', 'YYYY-MM-DD'), '2026-09-11')
  assert.equal(dateText('2026-09-11', 'YYYYMMDD'), '20260911')
  assert.equal(dateText('2026-09-11', 'YYYY年MM月DD日'), '2026年09月11日')
  assert.equal(dateText('2026-09-11', 'MM月DD日'), '09月11日')
  assert.equal(dateText('2026-09-11', 'YYMMDD'), '260911')
})

/* ══ TC-44 / TC-45 位置第三档 ═════════════════════════════════════════ */

const atRule = (at: number, more: Partial<RuleConfig['rule']> = {}) =>
  rule({ mode: 'rule' }, {
    seqEnabled: true, seqKind: 'number', seqStart: 1, seqStep: 1, seqPad: 0,
    seqPosition: 'at', seqAt: at, keepOriginal: true, ...more,
  })

test('TC-44 位置第三档：n=3 → 【素材1】（插在「材」和「】」之间）', () => {
  assert.equal(applyRuleMode('【素材】', atRule(3).rule, ctx()), '【素材1】')
})

test('TC-44 扩展名永不参与：规则只算主体，扩展名由调用方原样拼回', () => {
  const parts = splitName('【素材】.docx', false)
  assert.equal(parts.stem, '【素材】')
  assert.equal(parts.ext, '.docx')
  const stem = computeNewStem(parts, atRule(3), ctx())
  assert.equal(stem, '【素材1】')
  assert.equal(joinName(stem, parts.ext), '【素材1】.docx')
})

test('TC-45 位置第三档的边界：k=0 / k=长度 / k 越界（落末尾，不报错）', () => {
  assert.equal(applyRuleMode('素材', atRule(0).rule, ctx()), '1素材', 'k=0 = 插在主体最前面')
  assert.equal(applyRuleMode('素材', atRule(2).rule, ctx()), '素材1', 'k=长度 = 等于排在最后')
  assert.equal(applyRuleMode('素材', atRule(3).rule, ctx()), '素材1', 'k 越界 → 自动落到末尾，不报错')
  assert.equal(applyRuleMode('素材', atRule(200).rule, ctx()), '素材1')
  assert.equal(applyRuleMode('', atRule(3).rule, ctx()), '1', '空主体也不会炸')
})

test('TC-45 按**码点**切：emoji 与增补平面字符不会被劈成半个代理对', () => {
  // '🎉庆' 在 UTF-16 里是 3 个 code unit，但只有 2 个码点 —— 直接 slice(1) 会切出半个 emoji
  assert.equal(applyRuleMode('🎉庆', atRule(1).rule, ctx()), '🎉1庆')
  assert.equal(applyRuleMode('🎉庆', atRule(2).rule, ctx()), '🎉庆1')
  const out = computeNewStem({ stem: '🎉庆', ext: '' }, atRule(1), ctx())
  assert.ok(!out.includes('\uFFFD'), '结果里出现了替换字符，说明切坏了')
  assert.equal(Array.from(out).length, 3)
})

test('TC-45/§4.2 取消「保留原文件名」时没有可插的地方 → 退化成「排在最前」', () => {
  const r = atRule(3, { keepOriginal: false })
  assert.equal(applyRuleMode('素材', r.rule, ctx()), '1', '退化后就是 prefix + n + d + suffix')
  const withAffix = atRule(3, { keepOriginal: false, prefix: 'P-', suffix: '-S' })
  assert.equal(applyRuleMode('素材', withAffix.rule, ctx()), 'P-1-S')
})

test('第三档与日期、{n} 变量叠加时组合公式正确', () => {
  const r = rule({ mode: 'rule' }, {
    seqEnabled: true, seqKind: 'number', seqStart: 1, seqStep: 1, seqPad: 0,
    seqPosition: 'at', seqAt: 2, dateEnabled: true, dateFormat: 'YYYYMMDD', keepOriginal: true,
  })
  // [E] prefix + d + 前 k 个码点 + n + 后段 + suffix
  assert.equal(applyRuleMode('abcd', r.rule, ctx(0, 1, '2026-09-18')), '20260918ab1cd')
})

/* ══ sanitizeRule 白名单（TC-48 的抓手）═══════════════════════════════ */

test('sanitizeRule：6 个新字段「喂进去 → 取出来相等」，一个都不许丢', () => {
  const full = rule({ mode: 'rule' }, {
    seqEnabled: true, seqKind: 'time', seqPosition: 'at', seqAt: 200,
    seqRandomLen: 16, seqRandomSeed: 7,
    seqTimeStart: '2026-09-18', seqTimeFormat: 'YYMMDD', dateFormat: 'MM月DD日',
  })
  assert.deepEqual(sanitizeRule(overWire(full)), full)
})

test('sanitizeRule：第三档位置与两个新日期样式必须被**显式放行**（否则静默降级）', () => {
  const s = sanitizeRule({
    mode: 'rule',
    rule: { seqPosition: 'at', dateFormat: 'MM月DD日', seqTimeFormat: 'YYMMDD', seqTimeStart: '2026-09-18' },
  })
  assert.equal(s.rule.seqPosition, 'at', 'at 被降级成了 suffix')
  assert.equal(s.rule.dateFormat, 'MM月DD日', '新日期样式被降级成了 YYYY-MM-DD')
  assert.equal(s.rule.seqTimeFormat, 'YYMMDD')
  assert.equal(s.rule.seqTimeStart, '2026-09-18')
})

test('sanitizeRule：非法值一律回落到合法默认，范围与 clamp() 一致', () => {
  const s = sanitizeRule(overWire({
    mode: 'rule',
    rule: {
      seqEnabled: true, prefix: '', suffix: '', keepOriginal: true, dateEnabled: false,
      seqKind: 'BOGUS', seqPosition: 'BOGUS', seqAt: -5, seqRandomLen: 999, seqRandomSeed: -3,
      seqTimeStart: '2026/09/18', seqTimeFormat: 'BOGUS', dateFormat: 'BOGUS',
      seqStart: -1, seqStep: 0, seqPad: 99,
    },
  }))
  assert.equal(s.rule.seqKind, 'number')
  assert.equal(s.rule.seqPosition, 'suffix')
  assert.equal(s.rule.seqAt, 1, 'seqAt 下限是 1')
  assert.equal(s.rule.seqRandomLen, 16, 'seqRandomLen 上限是 16')
  assert.equal(s.rule.seqRandomSeed, 0, 'seqRandomSeed 下限是 0')
  assert.equal(s.rule.seqTimeStart, '', '非法日期串要清空（引擎会回落到目标日期）')
  assert.equal(s.rule.seqTimeFormat, 'YYYY年MM月DD日')
  assert.equal(s.rule.dateFormat, 'YYYY-MM-DD')
  assert.equal(s.rule.seqStart, 0)
  assert.equal(s.rule.seqStep, 1)
  assert.equal(s.rule.seqPad, 6)
})

test('sanitizeRule：seqAt 上限 200、seqRandomLen 下限 1', () => {
  assert.equal(sanitizeRule({ rule: { seqAt: 999 } }).rule.seqAt, 200)
  assert.equal(sanitizeRule({ rule: { seqAt: 0 } }).rule.seqAt, 1)
  assert.equal(sanitizeRule({ rule: { seqRandomLen: 0 } }).rule.seqRandomLen, 1)
})

test('sanitizeRule：不存在的日期要被清掉，而不是放行后被静默规范化', () => {
  // 只验「月 1–12 / 日 1–31」的话 2026-02-30 会被放行，再经 addDays 变成 3 月 2 日
  assert.equal(sanitizeRule({ rule: { seqTimeStart: '2026-02-30' } }).rule.seqTimeStart, '')
  assert.equal(sanitizeRule({ rule: { seqTimeStart: '2027-02-29' } }).rule.seqTimeStart, '', '2027 不是闰年')
  assert.equal(sanitizeRule({ rule: { seqTimeStart: '2028-02-29' } }).rule.seqTimeStart, '2028-02-29', '2028 是闰年')
  assert.equal(sanitizeRule({ rule: { seqTimeStart: '2026-13-01' } }).rule.seqTimeStart, '')
  assert.equal(isYmd('2026-04-31'), false, '4 月只有 30 天')
})

test('sanitizeRule：整个入参是垃圾时不炸，给一份默认规则', () => {
  for (const bad of [undefined, null, 42, 'x', [], { rule: 'nope' }]) {
    const s = sanitizeRule(bad)
    assert.equal(s.mode, 'delete')
    assert.equal(s.rule.seqKind, 'number')
    assert.equal(s.rule.seqTimeStart, '')
  }
})

/* ══ TC-42 四种类型在规则化模式下各自成串 ═══════════════════════════ */

test('TC-42 四种类型都算得出东西来（示例行不会空着）', () => {
  const base = { seqEnabled: true, seqStart: 1, seqStep: 1, seqPad: 0, seqPosition: 'prefix' as SeqPosition }
  const out: Record<SeqKind, string> = {
    number: applyRuleMode('素材', rule({ mode: 'rule' }, { ...base, seqKind: 'number' }).rule, ctx()),
    letter: applyRuleMode('素材', rule({ mode: 'rule' }, { ...base, seqKind: 'letter' }).rule, ctx()),
    random: applyRuleMode('素材', rule({ mode: 'rule' }, { ...base, seqKind: 'random', seqRandomLen: 6 }).rule, ctx()),
    time: applyRuleMode('素材', rule({ mode: 'rule' }, { ...base, seqKind: 'time', seqTimeStart: '2026-09-18', seqTimeFormat: 'YYYY年MM月DD日' }).rule, ctx()),
  }
  assert.equal(out.number, '1素材')
  assert.equal(out.letter, 'A素材')
  assert.match(out.random, /^[a-z0-9]{6}素材$/)
  assert.equal(out.time, '2026年09月18日素材')
})

/* ══ TC-48 ★ 本批最重要：预览 ≡ 执行，逐字节相等 ═════════════════════ */

const DATE = '2026-09-18'

/** 三个互不相同的文件；用不同主体长度好让第三档的落点也不一样 */
const ITEMS = [
  { id: 'f1', dirPath: 'D:\\p31', fromName: '素材.docx', isDir: false, attrs: { created: '', modified: '', sizeBytes: null } },
  { id: 'f2', dirPath: 'D:\\p31', fromName: '季度报告（终稿）.txt', isDir: false, attrs: { created: '', modified: '', sizeBytes: null } },
  { id: 'f3', dirPath: 'D:\\p31', fromName: 'photo-01.jpg', isDir: false, attrs: { created: '', modified: '', sizeBytes: null } },
]

const SEQ_KINDS: readonly SeqKind[] = ['number', 'letter', 'random', 'time']
const SEQ_POSITIONS: readonly SeqPosition[] = ['prefix', 'suffix', 'at']

/** 12 组规则：4 种类型 × 3 档位置，其余要素（前缀 / 后缀 / 日期 / 增量 / 起点）全部打开 */
function caseRule(kind: SeqKind, pos: SeqPosition): RuleConfig {
  return rule({ mode: 'rule' }, {
    prefix: 'P-',
    suffix: '-S',
    seqEnabled: true,
    seqKind: kind,
    seqPosition: pos,
    seqAt: 2,
    seqStart: 1,
    seqStep: 2,
    seqPad: 2,
    seqRandomLen: 6,
    seqRandomSeed: 3,
    seqTimeStart: '2026-09-18',
    seqTimeFormat: 'YYMMDD',
    dateEnabled: true,
    dateFormat: 'YYYYMMDD',
    keepOriginal: true,
  })
}

for (const kind of SEQ_KINDS) {
  for (const pos of SEQ_POSITIONS) {
    test(`TC-48 ${kind} × ${pos}：预览算出的新名与执行算出的新名逐字节相等`, () => {
      const r = caseRule(kind, pos)

      // 预览路径：渲染层拿完整规则直接算（Worker 与主进程共用 resolveItems）
      const preview = buildPreview(ITEMS, r, DATE, {}, false)

      // 执行路径：规则先过主进程的**逐字段白名单**，再建计划。
      // 中间刻意过一次 JSON 往返，模拟真实的 IPC 序列化。
      const sanitized = sanitizeRule(overWire(r))
      const plan = buildRenamePlan(ITEMS, sanitized, DATE, {}, false)

      const previewName = new Map(preview.items.map((i) => [i.id, i.newName]))
      const execName = new Map(
        [...plan.ready, ...plan.skipped, ...plan.invalid].map((x) => [x.id, x.toName]),
      )

      for (const it of ITEMS) {
        assert.equal(
          previewName.get(it.id),
          execName.get(it.id),
          `「${it.fromName}」预览与执行不一致（${kind} / ${pos}）`,
        )
      }

      // 别让用例空转：这一组必须真的改到了至少一个名字
      assert.ok(
        ITEMS.some((it) => previewName.get(it.id) !== it.fromName),
        `这一组规则一个名字都没改到，用例失去意义（${kind} / ${pos}）`,
      )

      // ★ 白名单一个字段都不许丢 —— 漏一个就是「预览对、执行错、界面无异常」
      assert.deepEqual(sanitized, r, `sanitizeRule 丢了字段（${kind} / ${pos}）`)
    })
  }
}

/* ══ 摘要措辞（会写进 history.json；新老记录两种写法各自自洽）════════ */

test('摘要：四种类型与第三档位置都有明确措辞，且「步长→增量」「补零→位数」已对齐界面', () => {
  const num = buildRuleSummary(rule({ mode: 'rule' }, {
    seqEnabled: true, seqStart: 4, seqStep: 4, seqPad: 0, seqPosition: 'prefix',
  }))
  assert.ok(num.includes('序号(数字 / 起始 4 / 增量 4 / 位数 0 / 排在最前)'), num)

  const let_ = buildRuleSummary(rule({ mode: 'rule' }, {
    seqEnabled: true, seqKind: 'letter', seqStart: 1, seqStep: 1,
  }))
  assert.ok(let_.includes('序号(字母 / 起始 1 / 增量 1 / 排在最后)'), let_)

  const rnd = buildRuleSummary(rule({ mode: 'rule' }, { seqEnabled: true, seqKind: 'random', seqRandomLen: 6 }))
  assert.ok(rnd.includes('序号(随机 6 位 / 排在最后)'), rnd)

  const tim = buildRuleSummary(rule({ mode: 'rule' }, {
    seqEnabled: true, seqKind: 'time', seqTimeStart: '2026-09-18', seqStep: 1,
  }))
  assert.ok(tim.includes('序号(时间 2026-09-18 起每天 / 排在最后)'), tim)

  const at = buildRuleSummary(rule({ mode: 'rule' }, { seqEnabled: true, seqPosition: 'at', seqAt: 3 }))
  assert.ok(at.includes('第 3 个字符后'), at)
})

/* ══ 本机日期：本地时区，不是 UTC ═══════════════════════════════════ */

test('todayYmd 取的是**本地**日期（用 toISOString 在东八区会在早上 8 点前给昨天）', () => {
  assert.equal(todayYmd(new Date(2026, 8, 18, 23, 59)), '2026-09-18')
  assert.equal(todayYmd(new Date(2026, 0, 1, 0, 0)), '2026-01-01')
  assert.equal(todayYmd(new Date(2026, 11, 31, 23, 59)), '2026-12-31')
  assert.equal(todayYmd(new Date(2026, 8, 1, 5, 0)), '2026-09-01')
})
