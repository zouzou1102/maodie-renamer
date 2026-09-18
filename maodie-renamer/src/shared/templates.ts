/**
 * P2-B · 常用规则模板库（F-12）—— **纯数据，无副作用**。
 *
 * 核心判断（P2-B 轻量设计确认 §1）：
 *   **模板不是新的规则类型，也不新增任何引擎能力。**
 *   套用模板 = 把一份完整的 `RuleConfig` 写进 store，用户接着还能继续改。
 *   这正是这一版能「轻」下来的原因：不碰引擎、不碰 IPC、不碰持久化。
 *
 * 为什么住在 `shared/`：与 `regex-cheatsheet.ts` 同理 —— 纯数据、要能被单测直接引用。
 * ⚠️ 本项目硬规矩：`tsconfig.node.json` 的 include **不含 `src/renderer`**，
 *    纯数据一旦放在渲染层，`tests/` 里 import 会直接编译失败（P2-C 增量踩过一次，
 *    那个测试文件「写了却从来没被跑过」）。
 */

import { DEFAULT_RULE, type RuleConfig } from './types'

export interface RuleTemplate {
  id: string
  /** chip 上的短名 */
  name: string
  /** title 悬停说明（一句大白话） */
  hint: string
  /** 完整的规则配置 —— 套用是**整份替换**，不是只补不覆盖 */
  rule: RuleConfig
}

/**
 * 补丁的形状：顶层字段可选，三个子对象也**只给要改的字段**即可
 * （与 `stores/rule.ts` 的 `RulePatch` 同形）。
 *
 * 为什么需要它：模板必须是一份**完整**的 `RuleConfig`（整份替换，见设计 §4.1），
 * 但手写六份完整对象里全是重复的默认值 —— 改一个默认值要改六遍，必漏。
 * 这里从 `DEFAULT_RULE` 起底，只写「这个模板跟默认不一样的地方」。
 */
type TemplateRulePatch = Partial<Omit<RuleConfig, 'delete' | 'replace' | 'rule'>> & {
  delete?: Partial<RuleConfig['delete']>
  replace?: Partial<RuleConfig['replace']>
  rule?: Partial<RuleConfig['rule']>
}

function withRule(patch: TemplateRulePatch): RuleConfig {
  return {
    ...DEFAULT_RULE,
    ...patch,
    delete: { ...DEFAULT_RULE.delete, ...(patch.delete ?? {}) },
    replace: { ...DEFAULT_RULE.replace, ...(patch.replace ?? {}) },
    rule: { ...DEFAULT_RULE.rule, ...(patch.rule ?? {}) },
  }
}

/**
 * 「去掉括号」用的正则：吃掉中英文圆括号、方括号、粗方括号**连同里面的内容**。
 *
 * ⚠️ 引擎必须按「全部匹配」处理（PRD F3/F4：删除**所有出现位置**）。
 *    `(1)(2)报告.docx` 要去成 `报告.docx`，只去掉第一组就说明少了 `g` 标志。
 *    实测 `src/shared/rule-engine.ts` 的 `spliceAllRegex` 用的已经是 `g` / `gi`，
 *    所以**不需要改引擎** —— 但单测里仍钉了一条，防止将来有人把它改回去。
 */
const BRACKET_RE = '[（(【\\[](?:[^）)】\\]]*)[）)】\\]]'

/**
 * 六个内置模板。**顺序就是界面上的顺序**（先给能看懂的一键入口）。
 *
 * ⚠️ 这些是**模块级常量**，绝不能被写坏 —— 套用前必须 `cloneTemplateRule()`。
 *    直接 `rule.value = t.rule` 把引用赋进去的话，用户随后每一次编辑都会改到
 *    这里的常量本身，第二次点同一个模板拿到的就不是原始模板了。
 *    那种 bug 表现为「模板越用越怪」，但**界面永远不报错**，极难排查（TC-41）。
 */
export const RULE_TEMPLATES: readonly RuleTemplate[] = [
  {
    id: 'datePrefix',
    name: '加日期前缀',
    hint: '在名字最前面加上今天的日期，原名字保留',
    rule: withRule({
      mode: 'rule',
      rule: { prefix: '{d} ', dateEnabled: true, dateFormat: 'YYYY-MM-DD', keepOriginal: true },
    }),
  },
  {
    id: 'seqPad',
    name: '补零编号',
    hint: '在名字最后加上 001、002 这样的编号',
    rule: withRule({
      mode: 'rule',
      rule: { seqEnabled: true, seqStart: 1, seqStep: 1, seqPad: 3, seqPosition: 'suffix', keepOriginal: true },
    }),
  },
  {
    id: 'dateSeq',
    name: '日期+编号',
    hint: '前面加日期、最后加编号，适合整理一整套资料',
    rule: withRule({
      mode: 'rule',
      rule: {
        prefix: '{d}-',
        seqEnabled: true,
        seqStart: 1,
        seqStep: 1,
        seqPad: 3,
        seqPosition: 'suffix',
        dateEnabled: true,
        dateFormat: 'YYYY-MM-DD',
        keepOriginal: true,
      },
    }),
  },
  {
    id: 'stripBrackets',
    name: '去掉括号',
    hint: '删掉名字里带括号的部分，比如【某某公众号】、(1)、（副本）',
    rule: withRule({
      mode: 'replace',
      regexEnabled: true,
      replace: { find: BRACKET_RE, to: '' },
    }),
  },
  {
    id: 'spaceToUnderscore',
    name: '空格换下划线',
    hint: '把文件名里的空格换成下划线，适合上传网站或写进代码',
    rule: withRule({
      mode: 'replace',
      replace: { find: ' ', to: '_' },
    }),
  },
  {
    id: 'lowercase',
    name: '全部小写',
    hint: '把名字统一成小写，扩展名不受影响',
    rule: withRule({
      mode: 'rule',
      caseTransform: 'lower',
      rule: { keepOriginal: true },
    }),
  },
]

/**
 * 取一份模板规则的**深拷贝**。套用前必须走这里 —— 理由见上面 `RULE_TEMPLATES` 的警告。
 *
 * 用 `structuredClone` 而不是手写三层展开：手写的版本在「将来给 `RuleConfig`
 * 加一层嵌套字段」时会**静默退化成浅拷贝**，而那种 bug 不报错、只表现为
 * 「模板越用越怪」。`structuredClone` 天然跟着结构走。
 * （`RuleConfig` 全是可序列化的原始值 —— 它本来就要过 IPC，见 types.ts 开头。）
 */
export function cloneTemplateRule(t: RuleTemplate): RuleConfig {
  return structuredClone(t.rule)
}

/**
 * 套用后给状态栏的那句话。
 *
 * 「去掉括号」会顺手替用户打开正则开关 → 「⚙ 进阶设置」折叠条会亮起。
 * 不说明白的话，用户会以为软件自己乱动了他的设置。
 */
export function templateAppliedMessage(t: RuleTemplate): string {
  return `已套用模板：${t.name}${t.rule.regexEnabled ? '（已自动开启正则）' : ''}`
}
