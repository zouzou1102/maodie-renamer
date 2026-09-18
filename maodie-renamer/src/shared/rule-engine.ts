/**
 * 规则引擎 —— 「算新名」。
 *
 * 三个约束必须刻在实现里：
 * 1. **只算「新主体」**：不管扩展名、不判冲突、不碰文件。
 * 2. **三个模式互斥**（DEC-02）：用 switch 而非「顺序执行三条规则」，
 *    从实现上排除「删了又替换还加序号」这种复合结果。
 * 3. **不取当前时间**：日期由调用方以参数传入（ADR-001 代价 2 / DEC-03），
 *    这样同一个函数在测试里能给出确定结果。
 */

import type { CaseTransform, DateFormat, RuleConfig } from './types'
import type { NameParts } from './name-split'

export interface RuleContext {
  /** 该项在列表中的序号（从 0 开始） */
  index: number
  /** 列表总数 */
  total: number
  /** 目标日期，格式 YYYY-MM-DD，由调用方传入（DEC-03） */
  date: string
  /**
   * P3-1：随机字符的种子来源 —— 传文件自己的 `id`。
   *
   * ⚠️ 做成**必填**不是洁癖：随机串若是每次重掷的，用户看到的新名与真正改下去的
   * 就是两个东西，而这种不一致在界面上**完全看不出来**（「预览 ≡ 执行」是底线）。
   * 必填 → 任何新增的调用点漏传都会在编译期就红。
   */
  seedKey: string
}

/* ── 序号与日期的文本化 ─────────────────────────────────────────────── */

/** 随机字符的字符集：`a–z` + `0–9`（36 个）。刻意不含大写与符号 —— 见设计 §3.3 */
const RANDOM_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/**
 * 序号文本，按 `seqKind` 分派到 4 条支路。
 *
 * ★ **数字这一支的取值与输出与 P0/P1 逐字节相同**（函数体原样搬进 `numberText`），
 *   所以既有单测一条都不用改。
 *
 * @param ctx 只有「随机字符」与「时间」用得到（前者要 `seedKey`，后者要兜底的日期）
 */
export function seqText(rule: RuleConfig['rule'], index: number, ctx?: RuleContext): string {
  switch (rule.seqKind) {
    case 'letter':
      return letterText(rule, index)
    case 'random':
      // 没有 ctx 就没有种子来源 —— 宁可返回空串，也绝不退回 Math.random()
      // （调用点漏传属于编码错误，由 RuleContext.seedKey 必填在编译期挡住）
      return ctx ? randomText(rule, ctx) : ''
    case 'time':
      return timeText(rule, index, ctx)
    case 'number':
    default:
      return numberText(rule, index)
  }
}

/** 数字（P0 起就有）。**函数体与 P0 完全一致，一个字都没动** */
function numberText(rule: RuleConfig['rule'], index: number): string {
  const start = Math.max(0, Math.trunc(rule.seqStart) || 0)
  const step = Math.max(1, Math.trunc(rule.seqStep) || 1)
  const pad = Math.min(6, Math.max(0, Math.trunc(rule.seqPad) || 0))
  const n = start + index * step
  return pad > 0 ? String(n).padStart(pad, '0') : String(n)
}

/**
 * `1 → A`、`26 → Z`、`27 → AA`、`702 → ZZ`、`703 → AAA`
 * —— Excel 的列标序列（不用解释，一看就懂）。
 * 非正数 / 非有限值一律当 1：字母编号里 0 没有意义，填 0 自动变 1，不报错、不弹提示。
 */
export function toLetters(n: number): string {
  let x = Number.isFinite(n) ? Math.trunc(n) : 1
  if (x < 1) x = 1
  let out = ''
  while (x > 0) {
    const rem = (x - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    x = Math.floor((x - 1) / 26)
  }
  return out
}

/** 字母：起始钳到 ≥ 1，输出大写（要小写靠进阶设置的「全部小写」全局转） */
export function letterText(rule: RuleConfig['rule'], index: number): string {
  const start = Math.max(1, Math.trunc(rule.seqStart) || 0)
  const step = Math.max(1, Math.trunc(rule.seqStep) || 1)
  return toLetters(start + index * step)
}

/** FNV-1a 32 位哈希。乘法必须走 `Math.imul` —— 直接 `* 16777619` 会丢精度 */
function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** xorshift32。0 是吸收态，先挪开 —— 否则种子算出 0 时会一直输出同一个字符 */
function xorshift32(x: number): number {
  let s = x | 0
  if (s === 0) s = 0x9e3779b9
  s ^= s << 13
  s ^= s >>> 17
  s ^= s << 5
  return s >>> 0
}

/**
 * 随机字符：**同一个文件每次预览都拿到同一个串**。
 *
 * 种子 = `文件 id` + 「换一批」的次数（`seqRandomSeed`）：id 定了就不变，
 * 所以反复预览恒定；点「换一批」种子 +1，整批才变。
 * 用 `Math.random()` 会让「预览看到的」和「真正改下去的」变成两个东西。
 */
export function randomText(rule: RuleConfig['rule'], ctx: RuleContext): string {
  const len = Math.min(16, Math.max(1, Math.trunc(rule.seqRandomLen) || 0))
  const seed = Math.max(0, Math.trunc(rule.seqRandomSeed) || 0)
  let s = fnv1a(`${ctx.seedKey}#${seed}`)
  let out = ''
  for (let i = 0; i < len; i++) {
    s = xorshift32(s)
    out += RANDOM_ALPHABET[s % RANDOM_ALPHABET.length]
  }
  return out
}

/* ── 日期：纯整数公历日序，禁用 `Date` ───────────────────────────────── */

/**
 * 年月日 → 日序（1970-01-01 = 0）。Howard Hinnant 的 `days_from_civil`，纯整数。
 *
 * 为什么不用 `new Date()`：`new Date('2026-09-18')` 按 **UTC** 解析，时区偏移与
 * 夏令时会让「加 1 天」在某些日子里偏出整整一天。批量改名的日期一旦错一天，
 * 就是**一整批文件全错**，且用户很难当场发现。纯整数算法跨月 / 跨年 / 闰年都确定，
 * 也才写得出单测。
 */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y
  const era = Math.floor(yy / 400)
  const yoe = yy - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

/** 日序 → 年月日（`civil_from_days`） */
function civilFromDays(z: number): { y: number; m: number; d: number } {
  const zz = z + 719468
  const era = Math.floor(zz / 146097)
  const doe = zz - era * 146097
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  )
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp + (mp < 10 ? 3 : -9)
  return { y: y + (m <= 2 ? 1 : 0), m, d }
}

/** 某年某月的天数（闰年：能被 4 整除且不被 100 整除，或能被 400 整除）*/
export function daysInMonth(y: number, m: number): number {
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
}

/**
 * 是不是一个**真实存在**的 `YYYY-MM-DD`。
 *
 * 界面取默认值、主进程白名单、引擎三处共用这一支。刻意连「这一天存不存在」一起验
 * （只验月 1–12、日 1–31 的话，`2026-02-30` 会被放行，再经 `addDays` 被静默
 * 规范化成 3 月 2 日 —— 又是一个「界面看不出异常」的错）。
 */
export function isYmd(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12) return false
  return d >= 1 && d <= daysInMonth(y, mo)
}

/**
 * `YYYY-MM-DD` 加 n 天。输入不合法时**原样返回**（不抛错、不猜）。
 * 输出恒是一个真实存在的日期 —— 绝不会出现 `2026-09-31` 这种。
 */
export function addDays(ymd: string, n: number): string {
  if (!isYmd(ymd)) return ymd
  const [y, mo, d] = ymd.split('-').map(Number)
  const delta = Number.isFinite(n) ? Math.trunc(n) : 0
  const r = civilFromDays(daysFromCivil(y, mo, d) + delta)
  const p = (v: number, w: number): string => String(v).padStart(w, '0')
  return `${p(r.y, 4)}-${p(r.m, 2)}-${p(r.d, 2)}`
}

/**
 * 时间类型：起点 + 「增量（天）」× 第几个（第 1 个用起点，第 2 个 +1 天…）。
 * 起点为空 / 非法时回落到调用方传入的目标日期 —— 起点是**冻结进规则的字面值**，
 * 所以它不会像「启用日期」那样跨零点漂移。
 */
function timeText(rule: RuleConfig['rule'], index: number, ctx?: RuleContext): string {
  const start = isYmd(rule.seqTimeStart) ? rule.seqTimeStart : (ctx?.date ?? '')
  if (!isYmd(start)) return ''
  const step = Math.max(1, Math.trunc(rule.seqStep) || 1)
  return dateText(addDays(start, index * step), rule.seqTimeFormat)
}

/** 按 dateFormat 格式化日期串（输入形如 `2026-09-11`）。5 档，「启用日期」与时间类型共用 */
export function dateText(date: string, format: DateFormat): string {
  const [y = '', m = '', d = ''] = date.split('-')
  switch (format) {
    case 'YYYYMMDD':
      return `${y}${m}${d}`
    case 'YYYY年MM月DD日':
      return `${y}年${m}月${d}日`
    case 'MM月DD日':
      return `${m}月${d}日`
    case 'YYMMDD':
      return `${y.slice(2)}${m}${d}`
    case 'YYYY-MM-DD':
    default:
      return date
  }
}

/* ── 删除 / 替换的匹配定位 ──────────────────────────────────────────── */

/**
 * 按「全部出现位置」扫描并拼接。
 *
 * **不能**用 `stem.replaceAll(needle, '')` —— 那在大小写不敏感时完全失效
 * （大小写不一致的出现位置匹配不到）。正确做法是把两边归一化后定位，
 * 再**按原串的索引**切片。
 */
function spliceAll(
  stem: string,
  needle: string,
  replacement: string | null,
  caseSensitive: boolean,
): string {
  if (needle === '') return stem

  const hay = caseSensitive ? stem : stem.toLowerCase()
  const pin = caseSensitive ? needle : needle.toLowerCase()

  let out = ''
  let i = 0
  while (i <= hay.length) {
    const at = hay.indexOf(pin, i)
    if (at === -1) {
      out += stem.slice(i)
      break
    }
    out += stem.slice(i, at)
    if (replacement !== null) out += replacement
    // ★ 游标跳过命中片段，**不回头二次匹配** —— 避免 `a → aa` 无限膨胀
    i = at + pin.length
  }
  return out
}

/* ── F-10 正则匹配 ──────────────────────────────────────────────────── */

/** pattern 长度上限（EX-16：挡掉明显的回溯爆炸输入，纯兜底）*/
export const REGEX_MAX_LENGTH = 200

export interface RegexCompileResult {
  /** 合法时的正则对象；空 / 非法时为 null */
  regex: RegExp | null
  /** 非法时的中文原因；合法或空 pattern 时为 null */
  error: string | null
}

/** 把运行时的英文正则报错映射成一句中文（不穷举，识别不了的给通用文案）*/
function mapRegexError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/Unterminated group/.test(msg)) return '正则表达式不完整：缺少右括号 )'
  if (/Unmatched/.test(msg)) return '正则表达式不完整：多了一个右括号 )'
  if (/Unterminated character class/.test(msg)) return '正则表达式不完整：缺少右方括号 ]'
  if (/Nothing to repeat/.test(msg)) return '正则表达式不完整：重复符号（* + ?）前面缺内容'
  if (/Invalid escape/.test(msg)) return '正则表达式里有无效的转义'
  if (/Invalid group/.test(msg)) return '正则表达式里的分组写法不正确'
  return '正则表达式不合法'
}

/**
 * 编译正则。空 pattern 视为「规则不生效」（不是错误）—— 与 P0 的空规则一致。
 * 供**引擎与界面校验共用**：界面靠它给出红框原因，引擎靠它决定是否降级为「不改」。
 */
export function compileRegex(pattern: string, caseSensitive: boolean): RegexCompileResult {
  if (pattern === '') return { regex: null, error: null }
  if (pattern.length > REGEX_MAX_LENGTH) {
    return { regex: null, error: `正则表达式太长了（最多 ${REGEX_MAX_LENGTH} 个字符）` }
  }
  try {
    return { regex: new RegExp(pattern, caseSensitive ? '' : 'i'), error: null }
  } catch (err) {
    return { regex: null, error: mapRegexError(err) }
  }
}

/**
 * 正则的「全部出现位置」替换（结构同 spliceAll，逐段切片拼接）。
 * `replacement === null` 等价于按正则删除。
 *
 * 用 `exec` 循环而不是 `String.replace` 的理由：替换串里要支持 `$0`（整体匹配）——
 * JS 原生只认 `$&`，`$0` 会被当字面量，与设计不一致。
 */
function spliceAllRegex(
  stem: string,
  pattern: string,
  replacement: string | null,
  caseSensitive: boolean,
): string {
  const re = new RegExp(pattern, caseSensitive ? 'g' : 'gi')
  let out = ''
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(stem)) !== null) {
    const match = m
    out += stem.slice(last, match.index)
    if (replacement !== null) {
      out += replacement.replace(/\$(\d{1,2})/g, (_all, digits: string) => {
        const n = Number(digits)
        if (n === 0) return match[0]
        // 越界 / 未参与匹配的组展开为空串（设计 §3.2），不报错
        return match[n] ?? ''
      })
    }
    last = match.index + match[0].length
    // 零宽匹配（如 `a*`）会让 lastIndex 原地踏步 → 手动 +1，避免死循环
    if (match[0].length === 0) re.lastIndex++
  }
  out += stem.slice(last)
  return out
}

/** 删除模式的算法（F-03）。`text` 为空时规则不生效 */
export function applyDelete(
  stem: string,
  text: string,
  caseSensitive: boolean,
  regexEnabled = false,
): string {
  if (regexEnabled) {
    // 空 / 超长 / 非法 → 规则不生效（非法时界面另有红框提示，这里只保证不算错）
    if (!compileRegex(text, caseSensitive).regex) return stem
    return spliceAllRegex(stem, text, null, caseSensitive)
  }
  return spliceAll(stem, text, null, caseSensitive)
}

/** 替换模式的算法（F-04）。`to` 为空等价于删除 */
export function applyReplace(
  stem: string,
  find: string,
  to: string,
  caseSensitive: boolean,
  regexEnabled = false,
): string {
  if (regexEnabled) {
    if (!compileRegex(find, caseSensitive).regex) return stem
    return spliceAllRegex(stem, find, to, caseSensitive)
  }
  return spliceAll(stem, find, to, caseSensitive)
}

/* ── 规则化模式的组合公式（★ 唯一权威：技术方案 §4.1.2 / PRD §4.2.5）── */

/**
 * ```
 * 序号文本 n = 按 seqKind 算出的序号（数字 / 字母 / 随机字符 / 时间）
 * 日期文本 d = 按 dateFormat 格式化
 *
 * [A] keepOriginal = true,  seqPosition = 'suffix'（默认）
 *       prefix + d + stem + suffix + n
 * [B] keepOriginal = true,  seqPosition = 'prefix'
 *       prefix + n + d + stem + suffix
 * [C] keepOriginal = false, seqPosition = 'suffix'
 *       prefix + d + suffix + n
 * [D] keepOriginal = false, seqPosition = 'prefix'
 *       prefix + n + d + suffix
 * [E] keepOriginal = true,  seqPosition = 'at'（P3-1 新增）
 *       prefix + d + [主体前 k 个码点] + n + [主体后段] + suffix
 * [F] keepOriginal = false, seqPosition = 'at'（P3-1 新增）
 *       主体为空 → 没有可插的地方 → 退化成 [D]（排在最前）
 * ```
 *
 * 变量去重：`{n}` / `{d}` 出现在前缀或后缀里时，对应的自动片段不再追加。
 * 实现要点：**先扫一遍收集 consumed 标记，再做组合** —— 不能边替换边判断，
 * 否则 `{n}` 只出现在后缀里时会被漏掉（因为前缀的替换已经先跑完了）。
 *
 * `seqEnabled === false` → `{n}` 展开为空串（保持位置，不报错）；`{d}` 同理。
 *
 * ⚠️ 这里**从前是 `seqPosition === 'prefix'` 的布尔二选一**，P3-1 加第三档时
 *    必须改成三分支：布尔写法会把 `'at'` 判成 `false`，用户看到的是
 *    「插在第 3 个字符后」、拿到的是「排在最后」，**界面一点异常都没有**。
 */
export function applyRuleMode(
  stem: string,
  rule: RuleConfig['rule'],
  ctx: RuleContext,
): string {
  const n = rule.seqEnabled ? seqText(rule, ctx.index, ctx) : ''
  const d = rule.dateEnabled ? dateText(ctx.date, rule.dateFormat) : ''

  const rawPrefix = rule.prefix ?? ''
  const rawSuffix = rule.suffix ?? ''

  // 第一步：扫一遍，判定变量是否已被用户显式使用
  const usesN = rule.seqEnabled && (rawPrefix.includes('{n}') || rawSuffix.includes('{n}'))
  const usesD = rule.dateEnabled && (rawPrefix.includes('{d}') || rawSuffix.includes('{d}'))

  // 第二步：展开变量（未启用的变量展开为空串）
  const prefix = expand(rawPrefix, n, d)
  const suffix = expand(rawSuffix, n, d)

  // 第三步：按 seqPosition 组合
  const autoD = usesD ? '' : d
  const autoN = usesN ? '' : n

  const body = rule.keepOriginal ? stem : ''

  switch (rule.seqPosition) {
    case 'prefix':
      return prefix + autoN + autoD + body + suffix
    case 'at':
      return atPosition(prefix, autoN, autoD, body, suffix, rule.seqAt)
    case 'suffix':
    default:
      return prefix + autoD + body + suffix + autoN
  }
}

/**
 * 位置第三档：插在主体的第 k 个**码点**之后（设计 §4）。
 *
 * 三条边界在这里收口：
 *  1. 按**码点**切（`Array.from`）—— 直接 `slice(k)` 会把 emoji / 增补平面字符
 *     劈成半个代理对，生成出**非法文件名**；
 *  2. 越界**自动落到末尾**，不报错 —— 名字只有 2 个字却填「第 3 个字符后」，
 *     按最接近的意思办（等价于「排在最后」），胜过弹一个用户看不懂的错；
 *  3. `body` 为空（取消「保留原文件名」）→ 没有可插的地方 → 退化成「排在最前」。
 */
function atPosition(
  prefix: string,
  autoN: string,
  autoD: string,
  body: string,
  suffix: string,
  seqAt: number,
): string {
  if (body === '') return prefix + autoN + autoD + suffix
  const chars = Array.from(body)
  const raw = Math.trunc(seqAt) || 0
  const k = Math.min(Math.max(0, raw), chars.length)
  return prefix + autoD + chars.slice(0, k).join('') + autoN + chars.slice(k).join('') + suffix
}

function expand(text: string, n: string, d: string): string {
  return text.split('{n}').join(n).split('{d}').join(d)
}

/* ── 对外主函数 ─────────────────────────────────────────────────────── */

/** F-11 大小写转换。只对新名主体做，扩展名由调用方原样拼回，不经过这里 */
export function applyCaseTransform(s: string, t: CaseTransform): string {
  switch (t) {
    case 'lower':
      return s.toLowerCase()
    case 'upper':
      return s.toUpperCase()
    case 'capitalize':
      // 只动首字符、其余原样（非破坏性：不吞掉驼峰 meetingNotes）
      return s === '' ? s : s.charAt(0).toUpperCase() + s.slice(1)
    case 'none':
    default:
      return s
  }
}

/**
 * 只算「新主体」：不管扩展名、不判冲突、不碰文件。
 *
 * 执行顺序（设计 §5 唯一权威）：**先按模式算出主体，最后整体做大小写**。
 */
export function computeNewStem(
  parts: NameParts,
  rule: RuleConfig,
  ctx: RuleContext,
): string {
  const stem = computeStemByMode(parts, rule, ctx)
  return applyCaseTransform(stem, rule.caseTransform ?? 'none')
}

function computeStemByMode(parts: NameParts, rule: RuleConfig, ctx: RuleContext): string {
  switch (rule.mode) {
    case 'delete':
      return applyDelete(parts.stem, rule.delete.text ?? '', rule.caseSensitive, rule.regexEnabled ?? false)
    case 'replace':
      return applyReplace(
        parts.stem,
        rule.replace.find ?? '',
        rule.replace.to ?? '',
        rule.caseSensitive,
        rule.regexEnabled ?? false,
      )
    case 'rule':
      return applyRuleMode(parts.stem, rule.rule, ctx)
    default:
      return parts.stem
  }
}
