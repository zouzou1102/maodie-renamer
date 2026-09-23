/**
 * 属性变量清单 —— **一处定义，三处使用**（P3-6 / DEC-23）。
 *
 * ── 为什么值得单独开一个文件 ────────────────────────────────────────
 * 同一个坑已经咬过两次：
 *   · P3-3 加 `{创建}` `{修改}` `{大小}` 时，**前缀下面那行提示是硬编码手写的** ——
 *     差点漏改（漏了就等于「功能完全正常，但没有任何用户知道有它们」）；
 *   · P3-6 再加 `{文件夹}` 时，同一个坑**第三次**出现。
 *
 * 所以本批把清单收在这里，让**三处**都由它生成：
 *   ① 属性组的 chip（`RulePanel.vue`）
 *   ② 前缀 / 后缀下面那行提示（`RulePanel.vue`）
 *   ③ 规则摘要（`rule-summary.ts`）
 * 以后再加属性变量，**只改这一个文件**。
 *
 * ⚠️ 刻意住在 `shared/` 而不是渲染层：`tsconfig.node.json` 的 include
 *    **不含 `src/renderer`** —— 放渲染层的话 `tests/` 里 import 会直接编译失败
 *    （P2-C 增量踩过一次，那个测试文件「写了却从来没被跑过」）。
 *
 * ⚠️ 它**不负责**引擎里的字符串替换（那是 `rule-engine.ts` 的 `expand()`）。
 *    新增变量时那边也要加一行 —— 这一处**仍是手动的**，由单测
 *    「6 个变量各一条」盯着（设计 §10）。
 */

import { sizeUnitLabel } from './labels'
import type { RuleConfig } from './types'

export interface AttrVar {
  /** 写在前缀 / 后缀里的占位符 */
  token: string
  /** chip 上的短名；也是提示行里的短名 */
  label: string
  /**
   * 规则摘要里的一段文字。
   * 写成函数的原因只有一个：`{大小}` 的摘要要带上**单位**（`大小(自动)`），
   * 而单位在 `RuleConfig['rule'].sizeUnit` 里 —— 静态字符串表达不了。
   * 入参刻意是 **`RuleConfig['rule']`（内层）**：摘要生成器只吃那一层
   * （`rule-summary.ts` 里拿到的正是 `rule.rule`）。
   */
  summary: (rule: RuleConfig['rule']) => string
}

/**
 * 四个属性变量。**顺序即界面顺序**（chip 从左到右、提示行从左到右）。
 *
 * 前三个是 P3-3 加的（`DEC-18`）；第四个「文件夹名」是 P3-6 加的（`DEC-23`）。
 * 它们都是「**写在前后缀里、没有开关、写上就生效**」—— 与「序号 / 日期」那两个
 * 「要先勾开关」的变量**刻意不同**。
 */
export const ATTR_VARS: readonly AttrVar[] = [
  { token: '{创建}', label: '创建日期', summary: () => '创建日期' },
  { token: '{修改}', label: '修改日期', summary: () => '修改日期' },
  {
    token: '{大小}',
    label: '文件大小',
    summary: (r) => `大小(${sizeUnitLabel(r.sizeUnit)})`,
  },
  { token: '{文件夹}', label: '文件夹名', summary: () => '文件夹名' },
]
