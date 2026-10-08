/**
 * 规则文案：**两套**，一个文件 —— 存档摘要 + 面板那句人话。
 *
 * 单独成模块的理由：这些文案在「历史页卡片」「撤销确认弹窗」「规则块那句 25px 大字」
 * 三处出现，且前者要参与持久化 —— 硬编码在组件里会让历史记录与代码版本耦合。
 *
 * ★ 2026-09-27：拆出 `buildRuleSummaryParts` —— 界面按 `hl` 把**用户填的值**
 *   （`广告` / `推广` / 前缀…）高亮成橘色小块（设计 §04「摘要里的高亮词」）。
 *   `buildRuleSummary` 保留为**字符串**形式（要写进 `history.json`），实现改成
 *   「分段拼回去」，于是两处**同一份逻辑**，不会漂移；字符串输出逐字节不变，
 *   由 `tests/p1-rules.test.ts` / `tests/p2b-templates.test.ts` / `tests/p3-1-seq.test.ts`
 *   的既有断言兜底。
 *
 * ★ 2026-10-08：面板那句大字**改用设计稿的人话**（`buildRuleSentenceParts`）。
 *   分工必须记牢，别把两者合并：
 *   · **存档摘要**（`buildRuleSummary`）＝写进 `history.json` + 历史卡片 + 撤销弹窗。
 *     它要**紧凑、且永久不变**（老记录不回填），所以长得像 `替换「广告」→「推广」（正则）`。
 *   · **面板那句话**（`buildRuleSentenceParts`）＝只活在界面上，要读起来像人话
 *     （设计原文：「把名字里所有的〔广告〕都换成〔推广〕」）。
 *   两者都**只从 `rule` 取值**，谁也不复制对方的字符串 —— 改一处不会让另一处过期。
 */

import { ATTR_VARS } from './attr-vars'
import { caseTransformLabel, dateFormatLabel, seqPositionLabel } from './labels'
import { isInsertAtEnd } from './rule-engine'
import type { RuleConfig } from './types'

/** P3-4：摘要里要能说明「这批名字有一部分来自导入的表格」*/
export interface ImportedSummaryInfo {
  /** 名字来自表格的项数 */
  count: number
  /** 来源表格的显示名 */
  source: string
}

/**
 * 摘要的一段。
 *
 * `hl` 表示「这一段是**用户在输入框里填的值**」—— 界面上把它做成橘色小块，
 * 让「哪个词是这条规则的可调参数」一眼可见（设计 §04）。它**只影响渲染**，
 * 拼接后的字符串与高亮无关。
 */
export interface SummaryPart {
  text: string
  hl?: boolean
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
  return buildRuleSummaryParts(rule, imported)
    .map((p) => p.text)
    .join('')
}

/** 摘要的**分段**形式（界面上按 `hl` 高亮；拼起来与 `buildRuleSummary` 完全一致）*/
export function buildRuleSummaryParts(
  rule: RuleConfig,
  imported?: ImportedSummaryInfo,
): SummaryPart[] {
  const parts = buildBaseParts(rule)
  const suffix = caseTransformLabel(rule.caseTransform ?? 'none')
  if (suffix) parts.push({ text: ` + ${suffix}` })
  if (imported !== undefined && imported.count > 0) {
    parts.push({ text: ` + 含表格导入 ${imported.count} 项（${imported.source}）` })
  }
  return parts
}

/**
 * 面板那句话（规则块里那句 25px 大字）。设计原文见 `C-面板阵列` 的 `.sentence`：
 * 「把名字里所有的〔广告〕都换成〔推广〕」—— 用户填的值包成橘色小块。
 *
 * ⚠️ 与上面的存档摘要是**两套文案、同一个数据源**（都只从 `rule` 取值），理由见文件头。
 *
 * ★ 穷尽 `switch` + `never` 兜底：将来加第 6 个模式时**编译就红**，
 *   而不是悄悄落进兜底分支显示一句错的话（本项目第 6 类静默 bug）。
 */
export function buildRuleSentenceParts(rule: RuleConfig): SummaryPart[] {
  const parts = buildSentenceBase(rule)
  // 大小写是「算完之后再套一层」的收尾动作，挂在句尾说（口径与存档摘要一致）
  const suffix = caseTransformLabel(rule.caseTransform ?? 'none')
  if (suffix) parts.push({ text: `，最后改成「${suffix}」` })
  return parts
}

function buildSentenceBase(rule: RuleConfig): SummaryPart[] {
  switch (rule.mode) {
    case 'delete': {
      const text = rule.delete.text
      if (!text) return [{ text: '还没填要删掉的内容' }]
      return [{ text: '把名字里所有的' }, { text, hl: true }, { text: '删掉' }]
    }

    case 'replace': {
      const { find, to } = rule.replace
      if (!find) return [{ text: '还没填要查找的内容' }]
      if (to === '') return [{ text: '把名字里所有的' }, { text: find, hl: true }, { text: '删掉' }]
      return [
        { text: '把名字里所有的' },
        { text: find, hl: true },
        { text: '都换成' },
        { text: to, hl: true },
      ]
    }

    case 'insert': {
      const { at, text } = rule.insert
      if (!text) return [{ text: '还没填要插入的内容' }]
      const where = isInsertAtEnd(at)
        ? '在名字最末尾插入'
        : Math.max(0, at) === 0
          ? '在最前面插入'
          : `在第 ${Math.max(0, at)} 个字符后插入`
      return [{ text: where }, { text, hl: true }]
    }

    case 'import':
      // 设计原文照抄：导入模式没有可调参数
      return [{ text: '名字由表格决定，规则引擎不参与' }]

    case 'rule':
      // 自定义模式有 6 类要素（前缀 / 后缀 / 序号 / 日期 / 属性 / 保留原名），
      // 设计只给了「最前面加上 {d}-，最后加上 001 这样的编号」一个例子 —— 做成固定
      // 句式会把其余要素藏起来（「看不见的功能等于不存在」），所以这一支沿用存档摘要的分段。
      return buildBaseParts(rule)

    default: {
      const never: never = rule.mode
      return never
    }
  }
}

function buildBaseParts(rule: RuleConfig): SummaryPart[] {
  // 「（正则）」只对会用到匹配的两种模式有意义 —— 规则化模式不涉及匹配
  const regex = rule.regexEnabled ? '（正则）' : ''
  switch (rule.mode) {
    case 'delete': {
      const text = rule.delete.text
      if (!text) return [{ text: '未设置删除内容' }]
      return [
        { text: '删除「' },
        { text, hl: true },
        { text: '」' },
        ...(regex ? [{ text: regex }] : []),
        ...(rule.caseSensitive ? [{ text: '（区分大小写）' }] : []),
      ]
    }

    case 'replace': {
      const { find, to } = rule.replace
      if (!find) return [{ text: '未设置查找内容' }]
      return [
        { text: '替换「' },
        { text: find, hl: true },
        { text: '」→' },
        ...(to === ''
          ? [{ text: '（删除）' }]
          : [{ text: '「' }, { text: to, hl: true }, { text: '」' }]),
        ...(regex ? [{ text: regex }] : []),
        ...(rule.caseSensitive ? [{ text: '（区分大小写）' }] : []),
      ]
    }

    case 'rule': {
      const r = rule.rule
      const segs: SummaryPart[][] = []

      if (r.prefix) segs.push([{ text: '前缀「' }, { text: r.prefix, hl: true }, { text: '」' }])
      if (r.suffix) segs.push([{ text: '后缀「' }, { text: r.suffix, hl: true }, { text: '」' }])

      if (r.seqEnabled) {
        segs.push([{ text: `序号(${seqBits(r).join(' / ')})` }])
      }

      if (r.dateEnabled) {
        segs.push([{ text: `日期(${dateFormatLabel(r.dateFormat)})` }])
      }

      // ★ P3-3 / P3-6：属性变量（写在前后缀里、**没有开关**）。
      //   摘要里必须说出来 —— 否则撤销之后没人知道当初是怎么算出来的（设计 §7.5 第 10 行）。
      //   ⚠️ 这一段必须在下面 `segs.length === 0` 判断**之前** ——
      //      否则「只写了属性变量」的规则会被误报成「未设置任何规则要素」。
      //   ★ P3-6：改成由 `shared/attr-vars.ts` 的清单生成 —— 以后加变量**只改那一处**
      //   （这个坑咬过两次：P3-3 加变量时提示行漏改，P3-6 又差点漏）。见设计 §5.①。
      const vars = `${r.prefix ?? ''}${r.suffix ?? ''}`
      for (const v of ATTR_VARS) {
        if (vars.includes(v.token)) segs.push([{ text: v.summary(r) }])
      }

      if (segs.length === 0) return [{ text: '未设置任何规则要素' }]

      segs.push([{ text: r.keepOriginal ? '保留原名' : '不保留原名' }])
      return segs.flatMap((s, i) => (i === 0 ? s : [{ text: ' + ' }, ...s]))
    }

    case 'insert': {
      const { at, text } = rule.insert
      if (!text) return [{ text: '未设置插入内容' }]
      // ★ 2026-10-08：界面上的〔末尾〕按钮把位置写成 `INSERT_AT_END`（哨兵值）。
      //   摘要里照实说「在末尾」，别把 255 印出来 —— 历史记录里出现「第 255 个字后」
      //   没人看得懂。这个值是新加的，不存在老记录里，所以不涉及迁移。
      const where = isInsertAtEnd(at) ? '在末尾' : `在第 ${Math.max(0, at)} 个字后`
      return [
        { text: `${where}插入「` },
        { text, hl: true },
        { text: '」' },
      ]
    }

    // ★ P3-5：导入模式 = 名字来自表格（引擎不参与）。摘要必须说出来 ——
    //   否则撤销之后没人知道当初那批名字是怎么来的（这段会写进 history.json）。
    case 'import':
      return [{ text: '名字来自导入的表格（规则不参与）' }]

    default: {
      // ★ 穷尽兜底：加模式时「忘了写摘要分支」变编译期错误，而不是静默给「未知规则」。
      const never: never = rule.mode
      return never
    }
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
