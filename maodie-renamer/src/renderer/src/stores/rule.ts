/**
 * 规则配置 store。
 *
 * 这一层不 import files store —— 规则的变更由 files store 里的 `watch` 捕获并
 * 触发预览重算。这样依赖方向只有 files → rule 一条，不会成环
 * （技术方案 §4.3.2 的「跨 store 依赖方向」）。
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { DEFAULT_RULE, type RuleConfig, type RuleMode, type SeqKind } from '@shared/types'
import { SIZE_UNIT_OPTIONS } from '@shared/labels'
import { buildRuleSummary } from '@shared/rule-summary'
import { compileRegex, isYmd } from '@shared/rule-engine'
import { todayYmd } from '@shared/today'
import { cloneTemplateRule, type RuleTemplate } from '@shared/templates'

function cloneDefault(): RuleConfig {
  return { ...DEFAULT_RULE, delete: { ...DEFAULT_RULE.delete }, replace: { ...DEFAULT_RULE.replace }, rule: { ...DEFAULT_RULE.rule } }
}

/**
 * patch 的入参形状：顶层字段可选，三个子对象也**只给要改的字段**即可。
 * 若直接要求 `Partial<RuleConfig>`，调用方就得写
 * `patch({ delete: { text } })` 之外还得补全 find/to —— 明明是可选补丁却要写全，
 * 很容易漏字段（编译期就会报「Property 'to' is missing」）。
 */
export type RulePatch = Partial<Omit<RuleConfig, 'delete' | 'replace' | 'rule'>> & {
  delete?: Partial<RuleConfig['delete']>
  replace?: Partial<RuleConfig['replace']>
  rule?: Partial<RuleConfig['rule']>
}

export const useRuleStore = defineStore('rule', () => {
  const rule = ref<RuleConfig>(cloneDefault())

  const summary = computed(() => buildRuleSummary(rule.value))

  const activeMode = computed(() => rule.value.mode)

  /**
   * F-10 正则非法时的中文原因（合法 / 未开启 / 空 pattern 时为 null）。
   *
   * 由「输入框红框」「状态栏提示」「开始改名置灰」三处共用 —— 单一来源，
   * 避免三处各判一次导致文案或口径不一致。
   */
  const regexError = computed<string | null>(() => {
    const r = rule.value
    if (!r.regexEnabled) return null
    // 规则化模式不涉及匹配，正则开关根本不出现，也就不校验
    if (r.mode === 'rule') return null
    const pattern = r.mode === 'delete' ? r.delete.text : r.replace.find
    return compileRegex(pattern, r.caseSensitive).error
  })

  function setMode(mode: RuleMode): void {
    if (rule.value.mode === mode) return
    rule.value.mode = mode
  }

  /** 深合并式补丁：只覆盖传进来的字段 */
  function patch(p: RulePatch): void {
    const { delete: del, replace: rep, rule: inner, ...rest } = p
    Object.assign(rule.value, rest)
    if (del) Object.assign(rule.value.delete, del)
    if (rep) Object.assign(rule.value.replace, rep)
    if (inner) Object.assign(rule.value.rule, inner)
    clamp()
  }

  function patchInner(p: Partial<RuleConfig['rule']>): void {
    Object.assign(rule.value.rule, p)
    clamp()
  }

  /**
   * 越界钳制（IX-044）。
   *
   * P0/P1：起始 ≥ 0、步长 ≥ 1、补零 0–6。
   * P3-1 追加：`seqAt` 1–200、`seqRandomLen` 1–16、`seqRandomSeed` ≥ 0、
   * `seqTimeStart` 必须是合法 `YYYY-MM-DD`（不合法就清空，引擎会回落到目标日期）。
   *
   * ⚠️ 这些范围必须与 `src/main/ipc/rename.ipc.ts` 的 `sanitizeRule`
   *    **完全一致**：两边不一致就是「预览对、执行错」，而界面看不出来。
   */
  function clamp(): void {
    const r = rule.value.rule
    r.seqStart = Math.max(0, Math.trunc(r.seqStart) || 0)
    r.seqStep = Math.max(1, Math.trunc(r.seqStep) || 1)
    r.seqPad = Math.min(6, Math.max(0, Math.trunc(r.seqPad) || 0))
    r.seqAt = Math.min(200, Math.max(1, Math.trunc(r.seqAt) || 0))
    r.seqRandomLen = Math.min(16, Math.max(1, Math.trunc(r.seqRandomLen) || 0))
    r.seqRandomSeed = Math.max(0, Math.trunc(r.seqRandomSeed) || 0)
    if (!isYmd(r.seqTimeStart)) r.seqTimeStart = ''
    // ★ P3-3：`sizeUnit` 是枚举，非法值落 `'auto'`。
    //   这里的口径必须与 `sanitize-rule.ts` 的 `sizeUnitOf()` **完全一致**
    //   —— 两边不一致就是「预览对、执行错」。
    if (!SIZE_UNIT_OPTIONS.some((o) => o.value === r.sizeUnit)) r.sizeUnit = 'auto'
  }

  function reset(): void {
    rule.value = cloneDefault()
  }

  /**
   * P2-B（F-12）套用常用规则模板：**整份替换** RuleConfig。
   *
   * 为什么是整份替换、而不是「只补不覆盖」：那样"套用"的语义就模糊了 ——
   * 用户不知道点下去会改什么、不会改什么，还会出现「一半来自模板、一半是上次填的」。
   * 整份替换，点完就知道自己现在的完整状态（设计 §4.1）。页签不用特意去动，
   * 它读的是 `rule.mode`，会自己跟上。
   *
   * ⚠️ **必须走 `cloneTemplateRule()` 深拷贝。** 直接 `rule.value = t.rule`
   *    是把模板常量的引用交了出去：用户随后每一次改参数都会改到 `RULE_TEMPLATES`
   *    本身，第二次点这个模板拿到的就不是原始模板了。那种 bug 的表现是
   *    「模板越用越怪」，而**界面永远不报错**（TC-41 专门钉它）。
   *
   * 为什么在这里再 `clamp()` 一次：模板虽是内置的、值本来就合法，但规则越界钳制
   * （IX-044）是**任何**写入路径都不能绕过的底线。将来若有人给模板填个 99，
   * 这里能兜住，不用去翻每个模板的数值。
   */
  function applyTemplate(t: RuleTemplate): void {
    rule.value = cloneTemplateRule(t)
    clamp()
  }

  /**
   * P3-1 · EL-125 / IX-108「换一批」：把随机种子 +1。
   *
   * 种子一变，整批随机串就换一批（同一个文件在自己那一批里仍然恒定，所以
   * 「预览 ≡ 执行」不受影响）。为什么必须有这个按钮：没有它，用户第一次随机
   * 出来的串会跟他一辈子，撞上重名也没法自救。
   *
   * 用**单调 +1** 而不是重新随机：点一次必然与上一批不同，也就不会出现
   * 「点了好像没变」的错觉；而且单调递增让种子本身也是可复现的。
   */
  function bumpRandomSeed(): void {
    const r = rule.value.rule
    r.seqRandomSeed = Math.max(0, Math.trunc(r.seqRandomSeed) || 0) + 1
  }

  /**
   * P3-1 · EL-121 / IX-107 切换编号类型。
   *
   * 切到「时间」且起点还是空的时候，把起点填成**本机今天** —— 设计写死的默认值
   * 就是「你点选『时间』那一刻」。填进去之后它就成了**冻结进规则的字面值**，
   * 不会像「启用日期」那样跟着执行日漂移；之后用户想改成任意一天都行。
   */
  function switchSeqKind(k: SeqKind): void {
    const r = rule.value.rule
    r.seqKind = k
    if (k === 'time' && !isYmd(r.seqTimeStart)) r.seqTimeStart = todayYmd()
    clamp()
  }

  return {
    rule,
    summary,
    activeMode,
    regexError,
    setMode,
    patch,
    patchInner,
    reset,
    applyTemplate,
    bumpRandomSeed,
    switchSeqKind,
  }
})
