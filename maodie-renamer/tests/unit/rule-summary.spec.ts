import { describe, expect, it } from 'vitest'
import { buildRuleSummary } from '@shared/rule-summary'
import { DEFAULT_RULE, type RuleConfig } from '@shared/types'

function rule(patch: Partial<RuleConfig> = {}, rulePatch: Partial<RuleConfig['rule']> = {}): RuleConfig {
  return { ...DEFAULT_RULE, ...patch, rule: { ...DEFAULT_RULE.rule, ...rulePatch } }
}

describe('rule-summary · 历史页规则摘要', () => {
  it('删除模式（数据库设计 §4.1 的示例文案）', () => {
    expect(buildRuleSummary(rule({ mode: 'delete', delete: { text: '【某某公众号】' } }))).toBe(
      '删除「【某某公众号】」',
    )
  })

  it('删除模式 + 区分大小写', () => {
    expect(
      buildRuleSummary(rule({ mode: 'delete', caseSensitive: true, delete: { text: 'ABC' } })),
    ).toBe('删除「ABC」（区分大小写）')
  })

  it('删除内容为空 → 明确说明未设置，而不是显示空引号', () => {
    expect(buildRuleSummary(rule({ mode: 'delete', delete: { text: '' } }))).toBe('未设置删除内容')
  })

  it('替换模式', () => {
    expect(
      buildRuleSummary(rule({ mode: 'replace', replace: { find: '最终版', to: '定稿' } })),
    ).toBe('替换「最终版」→「定稿」')
  })

  it('替换为空 → 标注（删除）', () => {
    expect(buildRuleSummary(rule({ mode: 'replace', replace: { find: '广告', to: '' } }))).toBe(
      '替换「广告」→（删除）',
    )
  })

  it('规则化模式（数据库设计 §4.1 的示例文案口径）', () => {
    const s = buildRuleSummary(
      rule(
        { mode: 'rule' },
        { prefix: '{d}-发票-', dateEnabled: true, seqEnabled: true, seqStart: 1, seqPad: 3, keepOriginal: false },
      ),
    )
    expect(s).toContain('前缀「{d}-发票-」')
    expect(s).toContain('序号(数字 / 起始 1 / 增量 1 / 位数 3 / 排在最后)')
    expect(s).toContain('日期(YYYY-MM-DD)')
    expect(s).toContain('不保留原名')
  })

  /**
   * ⚠️ P3-1 改过这里的**期望值**（不是放宽断言）：设计 §7.3 明文把摘要措辞
   *    「步长 → 增量」「补零 → 位数」对齐到界面用词，且**增量与位数总是写出来**
   *    （不再「非 1 才显示」）。所以这条用例的前提跟着需求变了：
   *    它现在盯的是「两个字段在任何取值下都出现在摘要里」——包括 0。
   *    摘要会写进 `history.json`，老记录保持旧措辞（不写迁移），两种写法各自自洽。
   */
  it('规则化模式：增量与位数总是写出来（含 0），措辞已对齐界面', () => {
    const s = buildRuleSummary(rule({ mode: 'rule' }, { seqEnabled: true, seqStep: 5, seqPad: 0 }))
    expect(s).toContain('增量 5')
    expect(s).toContain('位数 0')
  })

  it('规则化模式一个要素都没启用 → 明确说明，而不是空字符串', () => {
    expect(buildRuleSummary(rule({ mode: 'rule' }))).toBe('未设置任何规则要素')
  })

  it('规则化模式的序号/日期位置标签', () => {
    expect(buildRuleSummary(rule({ mode: 'rule' }, { seqEnabled: true, seqPosition: 'prefix' }))).toContain(
      '排在最前',
    )
  })
})
