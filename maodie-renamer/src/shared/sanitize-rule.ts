/**
 * 规则白名单收敛 —— 不信任渲染层，把入参逐字段收敛成合法形状。
 *
 * ## 为什么它住在 `shared/` 而不是 `main/ipc/rename.ipc.ts`
 *
 * 它原本是 `rename.ipc.ts` 里的一个模块私有函数。P3-1 把它挪出来，理由是硬的：
 *
 *  · 它是**纯函数** —— 只吃 `unknown`、吐 `RuleConfig`，不 import electron / fs / path；
 *  · 而它恰好是本项目**最危险的一处**：逐字段白名单，新字段漏一个就会
 *    「预览对、执行错、界面无异常」（P2-A 被同一类故障坑过）；
 *  · 住在 `rename.ipc.ts` 里，`node --test` **根本 import 不动**那个模块
 *    （它顶层 `import { ipcMain } from 'electron'`）—— 于是最容易出错的地方
 *    反而一条单测都写不了。
 *
 * 挪到共享层之后，`tests/p3-1-seq.test.ts` 能直接盯着它，而且用的是
 * 「喂进去 → 取出来」这种最直接的形状。
 *
 * ⚠️ **钳制范围必须与 `src/renderer/src/stores/rule.ts` 的 `clamp()` 完全一致。**
 *    两边不一致就是「预览对、执行错」，而界面看不出来。
 */

import { isYmd } from './rule-engine'
import { DEFAULT_RULE, type DateFormat, type ItemAttrs, type RuleConfig, type SizeUnit } from './types'

/** 5 档日期样式白名单（「启用日期」与「时间」类型共用一份实现） */
const DATE_FORMAT_VALUES: readonly string[] = ['YYYYMMDD', 'YYYY年MM月DD日', 'MM月DD日', 'YYMMDD']

/** P3-3：大小单位 5 档。不认识的回落 `'auto'` —— 与界面侧 `clamp()` 口径一致 */
const SIZE_UNIT_VALUES: readonly string[] = ['auto', 'B', 'KB', 'MB', 'GB']

/** 不认识的大小单位一律回落到 fallback（默认 `'auto'`） */
function sizeUnitOf(v: unknown, fallback: SizeUnit = 'auto'): SizeUnit {
  return typeof v === 'string' && SIZE_UNIT_VALUES.includes(v) ? (v as SizeUnit) : fallback
}

/** 不认识的日期样式一律回落到 fallback（默认 `'YYYY-MM-DD'`） */
function dateFormatOf(v: unknown, fallback: DateFormat = 'YYYY-MM-DD'): DateFormat {
  return typeof v === 'string' && DATE_FORMAT_VALUES.includes(v) ? (v as DateFormat) : fallback
}

/**
 * 把任意入参收敛成一份合法的 `RuleConfig`。
 *
 * ★ P3-1 新增的 6 个字段每个都有一处收口，且**默认值一律取自 `DEFAULT_RULE`**
 *   （写字面量就会和渲染层漂移）。`'at'` 与两个新日期样式必须**显式放行**，
 *   否则会被静默降级：`at` → `suffix`、新样式 → `YYYY-MM-DD`。
 */
/**
 * ★ P3-3：属性快照的逐字段收口。
 *
 * 与 `sanitizeRule` 同一形态 —— **主进程不信任渲染层**。
 * 漏收的后果：`{大小}` 静默变空串 / 得到一个 NaN 的字节数，而界面无异常。
 *
 * ★ `sizeBytes` 的 `null` 与 `0` 是**两种含义**（不可用 vs 真空文件），
 *   收口时必须保住这个区别 —— 把非法值归成 `0` 就等于把文件夹说成空的（设计 §1.4）。
 */
export function sanitizeAttrs(v: unknown): ItemAttrs {
  const src = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>
  const ymd = (x: unknown): string => (typeof x === 'string' && isYmd(x) ? x : '')
  const n = src.sizeBytes
  return {
    created: ymd(src.created),
    modified: ymd(src.modified),
    sizeBytes: typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null,
  }
}

export function sanitizeRule(raw: unknown): RuleConfig {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const r = (typeof src.rule === 'object' && src.rule !== null ? src.rule : {}) as Record<string, unknown>
  const del = (typeof src.delete === 'object' && src.delete !== null ? src.delete : {}) as Record<string, unknown>
  const rep = (typeof src.replace === 'object' && src.replace !== null ? src.replace : {}) as Record<string, unknown>

  const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
  const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

  const mode = src.mode === 'replace' || src.mode === 'rule' ? src.mode : 'delete'
  const seqKind =
    r.seqKind === 'letter' || r.seqKind === 'random' || r.seqKind === 'time'
      ? r.seqKind
      : DEFAULT_RULE.rule.seqKind
  const seqPosition = r.seqPosition === 'prefix' || r.seqPosition === 'at' ? r.seqPosition : 'suffix'
  const dateFormat = dateFormatOf(r.dateFormat)
  const caseTransform =
    src.caseTransform === 'lower' || src.caseTransform === 'upper' || src.caseTransform === 'capitalize'
      ? src.caseTransform
      : 'none'

  return {
    mode,
    caseSensitive: bool(src.caseSensitive, DEFAULT_RULE.caseSensitive),
    autoResolveConflict: bool(src.autoResolveConflict, DEFAULT_RULE.autoResolveConflict),
    regexEnabled: bool(src.regexEnabled, DEFAULT_RULE.regexEnabled),
    caseTransform,
    delete: { text: str(del.text) },
    replace: { find: str(rep.find), to: str(rep.to) },
    rule: {
      prefix: str(r.prefix),
      suffix: str(r.suffix),
      seqEnabled: bool(r.seqEnabled, false),
      seqStart: Math.max(0, Math.trunc(num(r.seqStart, 1))),
      seqStep: Math.max(1, Math.trunc(num(r.seqStep, 1))),
      seqPad: Math.min(6, Math.max(0, Math.trunc(num(r.seqPad, 3)))),
      seqPosition,
      dateEnabled: bool(r.dateEnabled, false),
      dateFormat,
      keepOriginal: bool(r.keepOriginal, true),
      seqKind,
      seqAt: Math.min(200, Math.max(1, Math.trunc(num(r.seqAt, DEFAULT_RULE.rule.seqAt)))),
      seqRandomLen: Math.min(
        16,
        Math.max(1, Math.trunc(num(r.seqRandomLen, DEFAULT_RULE.rule.seqRandomLen))),
      ),
      seqRandomSeed: Math.max(0, Math.trunc(num(r.seqRandomSeed, DEFAULT_RULE.rule.seqRandomSeed))),
      // 只认合法的 YYYY-MM-DD；其余（undefined / 非串 / 乱填）回落到空串，
      // 引擎那边会再回落到调用方传入的目标日期
      seqTimeStart: isYmd(str(r.seqTimeStart)) ? str(r.seqTimeStart) : '',
      seqTimeFormat: dateFormatOf(r.seqTimeFormat, DEFAULT_RULE.rule.seqTimeFormat),
      // ★ P3-3：漏收这一行 → 用户选了 MB，**执行时还是按 auto 渲染**，界面无异常
      sizeUnit: sizeUnitOf(r.sizeUnit, DEFAULT_RULE.rule.sizeUnit),
    },
  }
}
