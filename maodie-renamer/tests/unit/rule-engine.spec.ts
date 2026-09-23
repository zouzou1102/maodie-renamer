import { describe, expect, it } from 'vitest'
import {
  applyDelete,
  applyReplace,
  applyRuleMode,
  computeNewStem,
  dateText,
  seqText,
} from '@shared/rule-engine'
import { DEFAULT_RULE, type RuleConfig } from '@shared/types'

/** 造一个规则配置：默认值 + 覆盖 */
function rule(patch: Partial<RuleConfig> = {}, rulePatch: Partial<RuleConfig['rule']> = {}): RuleConfig {
  return {
    ...DEFAULT_RULE,
    ...patch,
    rule: { ...DEFAULT_RULE.rule, ...rulePatch },
  }
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
  // ★ P3-6：`{文件夹}` 的来源。**形状跟随** —— 本批把 `dirName` 做成必填，
  //   所以老用例的上下文都要补上它；**断言与判定一个都没改**。
  dirName: '素材',
})

describe('rule-engine · 序号与日期文本', () => {
  it('seqText 按 起始 / 步长 / 补零 生成', () => {
    expect(seqText({ ...DEFAULT_RULE.rule, seqStart: 1, seqStep: 1, seqPad: 3 }, 0)).toBe('001')
    expect(seqText({ ...DEFAULT_RULE.rule, seqStart: 1, seqStep: 1, seqPad: 3 }, 9)).toBe('010')
    expect(seqText({ ...DEFAULT_RULE.rule, seqStart: 5, seqStep: 2, seqPad: 3 }, 2)).toBe('009')
    expect(seqText({ ...DEFAULT_RULE.rule, seqStart: 1, seqStep: 1, seqPad: 0 }, 4)).toBe('5')
    expect(seqText({ ...DEFAULT_RULE.rule, seqStart: 0, seqStep: 1, seqPad: 2 }, 0)).toBe('00')
  })

  it('seqText 对越界参数做防御（起始 ≥0 / 步长 ≥1 / 补零 ≤6）', () => {
    // 起始 -3 → 0；步长 0 → 1；补零 99 → 6；index 1 → n = 0 + 1*1 = 1
    expect(seqText({ ...DEFAULT_RULE.rule, seqStart: -3, seqStep: 0, seqPad: 99 }, 1)).toBe('000001')
  })

  it('dateText 三种格式', () => {
    expect(dateText('2026-09-11', 'YYYY-MM-DD')).toBe('2026-09-11')
    expect(dateText('2026-09-11', 'YYYYMMDD')).toBe('20260911')
    expect(dateText('2026-09-11', 'YYYY年MM月DD日')).toBe('2026年09月11日')
  })
})

describe('rule-engine · 删除模式（F-03）', () => {
  it('删除全部出现位置：a广a告a → aaa', () => {
    expect(applyDelete('a广a告a', '广告', false)).toBe('a广a告a') // 非连续 → 不命中
    expect(applyDelete('广告a广告', '广告', false)).toBe('a')
    expect(applyDelete('abc广告abc', '广告', false)).toBe('abcabc')
  })

  it('大小写不敏感时必须按索引切片（不能用 replaceAll）', () => {
    expect(applyDelete('ABC广告abc', 'abc', false)).toBe('广告')
    expect(applyDelete('ABC广告abc', 'abc', true)).toBe('ABC广告')
  })

  it('待删字符串为空时规则不生效（且不死循环）', () => {
    expect(applyDelete('abc', '', false)).toBe('abc')
  })

  it('TC-03：含 abc广告.txt 删除「广告」→ abc', () => {
    expect(computeNewStem({ stem: 'abc广告', ext: '.txt' }, rule({ mode: 'delete', delete: { text: '广告' } }), ctx())).toBe('abc')
  })
})

describe('rule-engine · 替换模式（F-04）', () => {
  it('TC-04：会议纪要-最终版 → 会议纪要-定稿', () => {
    expect(applyReplace('会议纪要-最终版', '最终版', '定稿', false)).toBe('会议纪要-定稿')
  })

  it('替换为空 = 删除', () => {
    expect(applyReplace('abc广告', '广告', '', false)).toBe('abc')
  })

  it('替换结果不二次匹配（a → aa 不膨胀）', () => {
    expect(applyReplace('a', 'a', 'aa', false)).toBe('aa')
    expect(applyReplace('aaa', 'a', 'aa', false)).toBe('aaaaaa')
  })
})

describe('rule-engine · 规则化模式的组合公式（U-07 / TC-06）', () => {
  // ★ U-07 的四种组合
  it('U-07 [A] keepOriginal=true + seqPosition=suffix（默认）', () => {
    const r = rule({ mode: 'rule' }, { prefix: 'P-', suffix: '-S', seqEnabled: true, seqStart: 1, seqPad: 3 })
    // 前缀 + 日期('') + 原主体 + 后缀 + 序号
    expect(applyRuleMode('名字', r.rule, ctx())).toBe('P-名字-S001')
  })

  it('U-07 [B] keepOriginal=true + seqPosition=prefix', () => {
    const r = rule({ mode: 'rule' }, { prefix: 'P-', suffix: '-S', seqEnabled: true, seqStart: 1, seqPad: 3, seqPosition: 'prefix' })
    // 前缀 + 序号 + 日期('') + 原主体 + 后缀
    expect(applyRuleMode('名字', r.rule, ctx())).toBe('P-001名字-S')
  })

  it('U-07 [C] keepOriginal=false + seqPosition=suffix', () => {
    const r = rule({ mode: 'rule' }, { prefix: 'P-', suffix: '-S', seqEnabled: true, seqStart: 1, seqPad: 3, keepOriginal: false })
    // 前缀 + 日期('') + 后缀 + 序号
    expect(applyRuleMode('名字', r.rule, ctx())).toBe('P--S001')
  })

  it('U-07 [D] keepOriginal=false + seqPosition=prefix', () => {
    const r = rule({ mode: 'rule' }, { prefix: 'P-', suffix: '-S', seqEnabled: true, seqStart: 1, seqPad: 3, seqPosition: 'prefix', keepOriginal: false })
    // 前缀 + 序号 + 日期('') + 后缀
    expect(applyRuleMode('名字', r.rule, ctx())).toBe('P-001-S')
  })

  it('四种组合在「日期也启用」时同样遵循 §4.2.5 次序', () => {
    const base = { prefix: 'P-', suffix: '-S', seqEnabled: true, seqStart: 1, seqPad: 3, dateEnabled: true }
    const A = rule({ mode: 'rule' }, { ...base })
    const B = rule({ mode: 'rule' }, { ...base, seqPosition: 'prefix' })
    const C = rule({ mode: 'rule' }, { ...base, keepOriginal: false })
    const D = rule({ mode: 'rule' }, { ...base, seqPosition: 'prefix', keepOriginal: false })

    // 前缀 + 日期 + 原主体 + 后缀 + 序号
    expect(applyRuleMode('名', A.rule, ctx())).toBe('P-2026-09-11名-S001')
    // 前缀 + 序号 + 日期 + 原主体 + 后缀
    expect(applyRuleMode('名', B.rule, ctx())).toBe('P-0012026-09-11名-S')
    // 前缀 + 日期 + 后缀 + 序号
    expect(applyRuleMode('名', C.rule, ctx())).toBe('P-2026-09-11-S001')
    // 前缀 + 序号 + 日期 + 后缀
    expect(applyRuleMode('名', D.rule, ctx())).toBe('P-0012026-09-11-S')
  })

  it('TC-06：{d}-发票- + 序号(1/补零3) + 不保留原名 → 2026-09-11-发票-001', () => {
    const r = rule(
      { mode: 'rule' },
      { prefix: '{d}-发票-', dateEnabled: true, seqEnabled: true, seqStart: 1, seqStep: 1, seqPad: 3, keepOriginal: false },
    )
    const stem = computeNewStem({ stem: 'IMG_0001', ext: '.JPG' }, r, ctx(0, 1, '2026-09-11'))
    expect(stem).toBe('2026-09-11-发票-001')
    // 扩展名原样拼回
    expect(stem + '.JPG').toBe('2026-09-11-发票-001.JPG')
  })
})

describe('rule-engine · 变量展开与去重（U-08）', () => {
  it('U-08 前缀含 {n} 且序号启用 → 序号只出现一次', () => {
    const r = rule({ mode: 'rule' }, { prefix: '{n}-', seqEnabled: true, seqPad: 3, keepOriginal: true })
    expect(applyRuleMode('名字', r.rule, ctx())).toBe('001-名字')
  })

  it('{d} 只出现在后缀里时同样算「已使用」（先扫后替，不能边替边判）', () => {
    const r = rule({ mode: 'rule' }, { suffix: '-{d}', dateEnabled: true, keepOriginal: true })
    expect(applyRuleMode('名字', r.rule, ctx())).toBe('名字-2026-09-11')
  })

  it('前缀与后缀同时用了 {n} → 两处都展开，且不再自动追加', () => {
    const r = rule({ mode: 'rule' }, { prefix: '{n}-', suffix: '-{n}', seqEnabled: true, seqPad: 2, keepOriginal: true })
    expect(applyRuleMode('名字', r.rule, ctx())).toBe('01-名字-01')
  })

  it('前缀同时含 {d} 与 {n} → 各自只出现一次', () => {
    const r = rule({ mode: 'rule' }, { prefix: '{d}-{n}-', dateEnabled: true, seqEnabled: true, seqPad: 3, keepOriginal: false })
    expect(applyRuleMode('名字', r.rule, ctx())).toBe('2026-09-11-001-')
  })

  it('序号未启用时 {n} 展开为空串（保持位置，不报错）', () => {
    const r = rule({ mode: 'rule' }, { prefix: 'A{n}B', seqEnabled: false })
    expect(applyRuleMode('名字', r.rule, ctx())).toBe('AB名字')
  })

  it('日期未启用时 {d} 展开为空串', () => {
    const r = rule({ mode: 'rule' }, { prefix: 'A{d}B', dateEnabled: false })
    expect(applyRuleMode('名字', r.rule, ctx())).toBe('AB名字')
  })

  it('序号补零 0 位时不补零；序号随 index 递增（序号顺序 = 列表顺序）', () => {
    const r = rule({ mode: 'rule' }, { suffix: '{n}', seqEnabled: true, seqStart: 1, seqStep: 1, seqPad: 0, keepOriginal: true })
    expect(applyRuleMode('a', r.rule, ctx(0, 3))).toBe('a1')
    expect(applyRuleMode('b', r.rule, ctx(1, 3))).toBe('b2')
    expect(applyRuleMode('c', r.rule, ctx(2, 3))).toBe('c3')
  })
})

describe('rule-engine · 模式互斥（DEC-02）', () => {
  it('规则化模式下删除 / 替换参数完全无效', () => {
    const r = rule(
      { mode: 'rule', delete: { text: '名' }, replace: { find: '名', to: 'X' } },
      { prefix: 'P' },
    )
    expect(computeNewStem({ stem: '名字', ext: '' }, r, ctx())).toBe('P名字')
  })

  it('删除模式下规则化参数完全无效', () => {
    const r = rule({ mode: 'delete', delete: { text: '名' } }, { prefix: 'P', seqEnabled: true })
    expect(computeNewStem({ stem: '名字', ext: '' }, r, ctx())).toBe('字')
  })

  it('替换模式下删除参数完全无效', () => {
    const r = rule({ mode: 'replace', delete: { text: '名' }, replace: { find: '字', to: 'Z' } })
    expect(computeNewStem({ stem: '名字', ext: '' }, r, ctx())).toBe('名Z')
  })
})

describe('rule-engine · U-05 扩展名保护（删除「.」）', () => {
  /**
   * 技术方案 §9.2 的 U-05 期望值是 `报告docx.docx`。
   *
   * 按 §4.1.1「规则只作用于主体、扩展名一律原样拼回」这条唯一权威实现，
   * 该期望成立的前提是**输入名的主体里含有点**。因此这里把两种输入都固化：
   *   ① 输入 `报告.docx`（主体无点）→ 主体不变，扩展名的点完好无损
   *   ② 输入 `报告.docx.docx`（主体含点）→ 与 U-05 写的期望值逐字一致
   * 两种情况都证明「扩展名点位保留」这一性质。
   */
  it('① 主体无点时，主体不受影响、扩展名点位保持', () => {
    const r = rule({ mode: 'delete', delete: { text: '.' } })
    const stem = computeNewStem({ stem: '报告', ext: '.docx' }, r, ctx())
    expect(stem + '.docx').toBe('报告.docx')
  })

  it('② 主体含点时，与 U-05 期望值一致：报告.docx.docx → 报告docx.docx', () => {
    const r = rule({ mode: 'delete', delete: { text: '.' } })
    const parts = { stem: '报告.docx', ext: '.docx' }
    const stem = computeNewStem(parts, r, ctx())
    expect(stem + parts.ext).toBe('报告docx.docx')
  })

  it('多段扩展名：只切最后一个点，前面的点参与规则', () => {
    const r = rule({ mode: 'delete', delete: { text: '.' } })
    const parts = { stem: '我的.备份.tar', ext: '.gz' }
    const stem = computeNewStem(parts, r, ctx())
    expect(stem + parts.ext).toBe('我的备份tar.gz')
  })
})
