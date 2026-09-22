/**
 * 规则摘要文案（供历史页展示，`RenameTask.ruleSummary`）。
 *
 * 单独成模块的理由：同一段文案在「历史页卡片」「撤销确认弹窗」两处出现，
 * 且它要参与持久化 —— 硬编码在组件里会让历史记录与代码版本耦合。
 */

import { caseTransformLabel, dateFormatLabel, seqPositionLabel, sizeUnitLabel } from './labels'
import type { RuleConfig } from './types'

/** P3-4：摘要里要能说明「这批名字有一部分来自导入的表格」*/
export interface ImportedSummaryInfo {
  /** 名字来自表格的项数 */
  count: number
  /** 来源表格的显示名 */
  source: string
}

/**
 * 规则摘要 = 模式摘要 + 大小写后缀 + 表格导入说明（设计 §8：都追加在末尾）。
 *
 * ★ P3-4：表格导入的项**不受规则影响**（override 优先）。摘要不说这件事，
 *   撤销之后就没人知道当初那批名字是怎么来的了 —— 而这段字符串会写进
 *   `history.json`（设计 §7.5 第 8 行）。
 *
 * ⚠️ 第二个参数做成**可选**：老调用点（CLI、以及没有导入的场景）一个字都不用改，
 *   老的历史记录也不会因此变化 —— **绝不为了统一写法去写数据迁移**。
 */
export function buildRuleSummary(rule: RuleConfig, imported?: ImportedSummaryInfo): string {
  const base = buildBaseSummary(rule)
  const suffix = caseTransformLabel(rule.caseTransform ?? 'none')
  const head = suffix ? `${base} + ${suffix}` : base
  return imported !== undefined && imported.count > 0
    ? `${head} + 含表格导入 ${imported.count} 项（${imported.source}）`
    : head
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
        parts.push(`序号(${seqBits(r).join(' / ')})`)
      }

      if (r.dateEnabled) {
        parts.push(`日期(${dateFormatLabel(r.dateFormat)})`)
      }

      // ★ P3-3：属性变量（写在前后缀里、**没有开关**）。
      //   摘要里必须说出来 —— 否则撤销之后没人知道当初是怎么算出来的（设计 §7.5 第 10 行）。
      //   ⚠️ 这三行必须在下面 `parts.length === 0` 判断**之前** ——
      //      否则「只写了属性变量」的规则会被误报成「未设置任何规则要素」。
      const vars = `${r.prefix ?? ''}${r.suffix ?? ''}`
      if (vars.includes('{创建}')) parts.push('创建日期')
      if (vars.includes('{修改}')) parts.push('修改日期')
      if (vars.includes('{大小}')) parts.push(`大小(${sizeUnitLabel(r.sizeUnit)})`)

      if (parts.length === 0) return '未设置任何规则要素'

      parts.push(r.keepOriginal ? '保留原名' : '不保留原名')
      return parts.join(' + ')
    }

    default:
      return '未知规则'
  }
}

/**
 * 序号段的摘要片段（P3-1 起要体现**类型**与**位置**）。
 *
 * 措辞对齐（设计 §7.3）：「步长」改叫「**增量**」、「补零」改叫「**位数**」，
 * 与界面用词一致。
 *
 * ⚠️ 这段字符串会**写进 `history.json`**：上了这一批之后，新记录是新写法
 *    （`序号(数字 / 起始 4 / 增量 4 / 位数 0 / 排在最前)`），老记录保持旧写法
 *    （`序号(起始 1 / 步长 1 / 补零 3 / 排在最后)`）。这是**可以接受**的 ——
 *    摘要是纯显示字符串，不参与任何解析。
 *    **但绝对不要为了「新老一致」去写迁移改老记录**：那等于去改已经落盘的
 *    历史数据，而历史数据是撤销功能的依据（与 P2-B「摘要截断只在渲染层」同一条纪律）。
 */
function seqBits(r: RuleConfig['rule']): string[] {
  const bits: string[] = []
  switch (r.seqKind) {
    case 'letter':
      bits.push('字母', `起始 ${Math.max(1, r.seqStart)}`, `增量 ${Math.max(1, r.seqStep)}`)
      break
    case 'random':
      bits.push(`随机 ${r.seqRandomLen} 位`)
      break
    case 'time': {
      const start = r.seqTimeStart || '当天'
      bits.push(r.seqStep === 1 ? `时间 ${start} 起每天` : `时间 ${start} 起每 ${r.seqStep} 天`)
      break
    }
    case 'number':
    default:
      bits.push('数字', `起始 ${r.seqStart}`, `增量 ${r.seqStep}`, `位数 ${r.seqPad}`)
      break
  }
  // 第三档要把 n 一起写出来：只写「第 n 个字符后」，历史记录里就读不出当时到底插在哪儿
  bits.push(r.seqPosition === 'at' ? `第 ${r.seqAt} 个字符后` : seqPositionLabel(r.seqPosition))
  return bits
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
