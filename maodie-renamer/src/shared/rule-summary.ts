/**
 * 规则摘要文案（供历史页展示，`RenameTask.ruleSummary`）。
 *
 * 单独成模块的理由：同一段文案在「历史页卡片」「撤销确认弹窗」两处出现，
 * 且它要参与持久化 —— 硬编码在组件里会让历史记录与代码版本耦合。
 */

import { caseTransformLabel, dateFormatLabel, seqPositionLabel } from './labels'
import type { RuleConfig } from './types'

/** 规则摘要 = 模式摘要 + 大小写后缀（设计 §8：大小写对任意模式都追加在末尾）*/
export function buildRuleSummary(rule: RuleConfig): string {
  const base = buildBaseSummary(rule)
  const suffix = caseTransformLabel(rule.caseTransform ?? 'none')
  return suffix ? `${base} + ${suffix}` : base
}

function buildBaseSummary(rule: RuleConfig): string {
  // 「（正则）」只对会用到匹配的两种模式有意义 —— 规则化模式不涉及匹配
  const regex = rule.regexEnabled ? '（正则）' : ''
  switch (rule.mode) {
    case 'delete': {
      const text = rule.delete.text
      if (!text) return '未设置删除内容'
      return `删除「${text}」${regex}${rule.caseSensitive ? '（区分大小写）' : ''}`
    }

    case 'replace': {
      const { find, to } = rule.replace
      if (!find) return '未设置查找内容'
      const right = to === '' ? '（删除）' : `「${to}」`
      return `替换「${find}」→${right}${regex}${rule.caseSensitive ? '（区分大小写）' : ''}`
    }

    case 'rule': {
      const r = rule.rule
      const parts: string[] = []

      if (r.prefix) parts.push(`前缀「${r.prefix}」`)
      if (r.suffix) parts.push(`后缀「${r.suffix}」`)

      if (r.seqEnabled) {
        const bits = [`起始 ${r.seqStart}`]
        if (r.seqStep !== 1) bits.push(`步长 ${r.seqStep}`)
        bits.push(r.seqPad === 0 ? '不补零' : `补零 ${r.seqPad}`)
        bits.push(seqPositionLabel(r.seqPosition))
        parts.push(`序号(${bits.join(' / ')})`)
      }

      if (r.dateEnabled) {
        parts.push(`日期(${dateFormatLabel(r.dateFormat)})`)
      }

      if (parts.length === 0) return '未设置任何规则要素'

      parts.push(r.keepOriginal ? '保留原名' : '不保留原名')
      return parts.join(' + ')
    }

    default:
      return '未知规则'
  }
}

/* ── 显示层截断（P2-B §5.2）───────────────────────────────────────────── */

/** 引号内内容超过这个长度就该截断 */
export const SUMMARY_QUOTE_MAX = 14
/** 截断后保留前几个字符 */
export const SUMMARY_QUOTE_KEEP = 12

/**
 * 把摘要里**过长的引号内容**截断，供历史卡片展示。
 *
 * 「去掉括号」这类模板会往规则里塞一条长正则，摘要就成了
 * `替换「[（(【\[](?:[^）)】\]]*)[）)】\]]」→（删除）（正则）`
 * —— 一长串符号糊在卡片上，用户根本读不懂当时用了什么规则。
 * 截断后是 `替换「[（(【\[](?:[^…」→（删除）（正则）`，完整原文放 `title` 悬停可见。
 *
 * ⚠️⚠️ **只改显示，绝不动 `buildRuleSummary`。**
 *    `buildRuleSummary` 的返回值会被写进 `history.json`。在那一层截断等于
 *    **改变了持久化的数据** —— 新记录是截断的、老记录是完整的，同一份文件里
 *    两种格式，数据就不一致了。**原始数据一个字都不动，只改显示。**
 *
 * 这也意味着：**不需要、也不允许**为了这个功能写数据迁移。
 */
export function truncateSummaryForDisplay(summary: string): string {
  return summary.replace(/「([^」]*)」/g, (whole, inner: string) =>
    inner.length > SUMMARY_QUOTE_MAX ? `「${inner.slice(0, SUMMARY_QUOTE_KEEP)}…」` : whole,
  )
}
