/**
 * 预览组装（F-08 / 技术方案 §4.3.3）。
 *
 * ★ 这里是「预览 ≡ 执行」的实现落点：渲染进程的 Worker 与主进程的阶段 0
 * **调用的是同一个 `resolveItems`**。两边只是取用的字段不同：
 *   · Worker 取 newName / status / diffRange → 画列表
 *   · 主进程取 outcome / toName           → 生成待执行清单
 *
 * 分段职责：
 *   1. 逐项 computeNewStem → joinName（扩展名原样拼回）
 *   2. validateNewName —— 失败 → invalid，**不参与冲突检测**（它根本不会执行）
 *   3. detectConflicts —— 只对合法项做，避免非法项污染「已分配集合」
 *   4. computeDiffRange —— 比较**完整名字**（用户看到的是完整名）
 */

import { detectConflicts, toSnapshotMap, type ConflictInput } from './conflicts'
import { computeDiffRange } from './diff-range'
import { MD_ERROR, errorText, type MdErrorCode } from './errors'
import { joinName, splitName } from './name-split'
import { computeNewStem } from './rule-engine'
import { validateNewName } from './validator'
import type {
  ConflictKind,
  ItemStatus,
  PreviewItemInput,
  PreviewItemOutput,
  PreviewStats,
  ItemAttrs,
  ItemOverride,
  RuleConfig,
} from './types'

/* ── 输入 / 输出 ────────────────────────────────────────────────────── */

export interface ResolveInput {
  id: string
  dirPath: string
  /** 当前完整名称（含扩展名）*/
  fromName: string
  isDir: boolean
  /**
   * ★ P3-3：入列时的属性快照。
   *
   * 这个形状同时被主进程（执行）与 Worker（预览）用——
   * 所以它与 `PreviewItemInput` **两边都不能漏**，否则就是「预览 ≠ 执行」。
   */
  attrs: ItemAttrs

  /**
   * ★ P3-4：表格给定的新名（有它就不走规则）。
   *
   * ⚠️ 与 `FileItem` / `ExecuteItem` / `PreviewItemInput` **保持同一个形状**
   *   （对象，不是「就存 stem 那个字符串」）—— 四层同形，`toResolveInput`
   *   就只是原样搬运，少一次「取 `.stem`」就少一处能漏的地方。
   *   真正要字符串的地方只有一处：构造 `RuleContext`（见 `resolveItems`）。
   */
  override?: ItemOverride
}

export type PlanOutcome = 'ready' | 'skipped' | 'invalid'

export interface ResolvedItem {
  id: string
  dirPath: string
  fromName: string
  isDir: boolean
  /** 该项的扩展名（含点；文件夹与无扩展名为空串）。用于保证 newName === newStem + ext */
  ext: string
  /** 用户「想改成」的名字（未加冲突补救序号）*/
  attemptedName: string
  /** 实际会生效的名字：开了自动加序号时为 resolvedName，否则等于 attemptedName */
  toName: string
  /** 最终生效名字的主体。恒满足 `newName === newStem + ext` */
  newStem: string
  /** 该项最终会走哪条路：执行 / 跳过 / 不执行 */
  outcome: PlanOutcome
  status: ItemStatus
  conflictKind: ConflictKind
  code?: MdErrorCode
  /** 可直接显示的中文原因 */
  reason?: string
  /** 开启「自动加序号」后算出的最终名字 */
  resolvedName?: string
  /** 差异高亮区间，null 表示无变化 */
  diffRange: ReturnType<typeof computeDiffRange>
}

/* ── 核心：一次算出「新名 + 合法性 + 冲突 + 结果分类」────────────────── */

/**
 * @param items           待算清单
 * @param rule            规则配置
 * @param date            目标日期（YYYY-MM-DD），由调用方传入 —— 引擎不取「现在」
 * @param snapshot        目录快照：dirKey → 该目录现存名称清单
 * @param autoResolve     冲突策略：false = 跳过（默认，DEC-05）
 */
export function resolveItems(
  items: ResolveInput[],
  rule: RuleConfig,
  date: string,
  snapshot: Record<string, string[]>,
  autoResolve: boolean,
): ResolvedItem[] {
  const total = items.length

  /** 第一遍：算新名 + 校验，筛出合法项 */
  const computed = items.map((item, index) => {
    const parts = splitName(item.fromName, item.isDir)
    // ★ P3-1：seedKey 传**文件自己的 id** —— 「随机字符」类型靠它做确定性伪随机，
    //   这样同一个文件反复预览拿到的串恒定（预览 ≡ 执行的硬要求）。
    // ★ P3-4：`override` = 「表里已经写好的新名」 —— 有它就不算规则（见 `computeNewStem`）
    const newStem = computeNewStem(parts, rule, {
      index,
      total,
      date,
      seedKey: item.id,
      attrs: item.attrs,
      // 只在这里取 `.stem` —— 引擎要的是字符串，而四层之间传的是同一个对象
      override: item.override?.stem,
    })
    const attemptedName = joinName(newStem, parts.ext)
    // ★ 必须把原始扩展名传进去：「只剩扩展名」与「本来就叫 .gitignore」
    //   在字符串层面同构，只有调用方知道原始 ext
    const verdict = validateNewName(attemptedName, item.dirPath, parts.ext)
    return { item, parts, attemptedName, verdict }
  })

  /** 第二遍：只对合法项做冲突检测 —— 非法项不会执行，不该占用目标名 */
  const validInputs: ConflictInput[] = computed
    .filter((c) => c.verdict.ok)
    .map((c) => ({
      id: c.item.id,
      dirPath: c.item.dirPath,
      fromName: c.item.fromName,
      toName: c.attemptedName,
      isDir: c.item.isDir,
    }))

  const outcomes = detectConflicts(validInputs, toSnapshotMap(snapshot), autoResolve)
  const outcomeById = new Map(outcomes.map((o) => [o.input.id, o]))

  /** 先统计 batch 类冲突数量 —— EX-05 的文案里要填 N */
  const batchCount = outcomes.filter((o) => o.result.kind === 'batch').length

  /**
   * 最终名字的「主体」。
   *
   * 为什么不直接对最终名再跑一次 splitName：`splitName` 对改名结果是**不幂等**的。
   * 例：输入 `.gitignore`（ext 为空）加前缀得到 `P-.gitignore04`，
   *    再拆一次会把 `.gitignore04` 当成扩展名。
   * 因此这里按**该项原本的 ext** 从末尾剥离，从而恒满足
   * `newName === newStem + ext` 这条接口文档承诺的冗余关系。
   */
  const stemOf = (final: string, ext: string): string =>
    ext !== '' && final.endsWith(ext) ? final.slice(0, final.length - ext.length) : final

  return computed.map(({ item, attemptedName, verdict, parts }): ResolvedItem => {
    const ext = parts.ext
    // ① 校验不通过
    if (!verdict.ok) {
      const code = verdict.code ?? MD_ERROR.E_UNKNOWN
      return {
        id: item.id,
        dirPath: item.dirPath,
        fromName: item.fromName,
        isDir: item.isDir,
        ext,
        attemptedName,
        toName: attemptedName,
        newStem: stemOf(attemptedName, ext),
        outcome: 'invalid',
        status: 'invalid',
        conflictKind: 'none',
        code,
        reason: verdict.detail ?? errorText(code),
        diffRange: computeDiffRange(item.fromName, attemptedName),
      }
    }

    const outcome = outcomeById.get(item.id)
    const kind: ConflictKind = outcome?.result.kind ?? 'none'
    const resolvedName = outcome?.resolvedName
    const finalName = resolvedName ?? attemptedName

    // ② 名字完全没变 —— 界面显示灰色「—」，执行时跳过（不占目标名）
    if (kind === 'self') {
      return {
        id: item.id,
        dirPath: item.dirPath,
        fromName: item.fromName,
        isDir: item.isDir,
        ext,
        attemptedName,
        toName: attemptedName,
        newStem: stemOf(attemptedName, ext),
        outcome: 'skipped',
        status: 'unchanged',
        conflictKind: kind,
        code: MD_ERROR.E_NO_CHANGE,
        reason: '无变化，无需改名',
        diffRange: null,
      }
    }

    // ③ 冲突且未开自动加序号 → 跳过，绝不覆盖（DEC-05）
    if (kind === 'batch' || kind === 'disk') {
      const code = kind === 'batch' ? MD_ERROR.E_CONFLICT_BATCH : MD_ERROR.E_CONFLICT_DISK
      const reason =
        kind === 'batch' ? errorText(code, batchCount) : errorText(MD_ERROR.E_CONFLICT_DISK)
      return {
        id: item.id,
        dirPath: item.dirPath,
        fromName: item.fromName,
        isDir: item.isDir,
        ext,
        attemptedName,
        toName: attemptedName,
        newStem: stemOf(attemptedName, ext),
        outcome: 'skipped',
        status: 'conflict',
        conflictKind: kind,
        code,
        reason,
        diffRange: computeDiffRange(item.fromName, attemptedName),
      }
    }

    // ④ 可执行（含 case-only 与「自动加序号后」）
    return {
      id: item.id,
      dirPath: item.dirPath,
      fromName: item.fromName,
      isDir: item.isDir,
      ext,
      attemptedName,
      toName: finalName,
      newStem: stemOf(finalName, ext),
      outcome: 'ready',
      status: 'changed',
      conflictKind: kind,
      resolvedName,
      diffRange: computeDiffRange(item.fromName, finalName),
    }
  })
}

/* ── 预览：把 ResolvedItem 压成界面需要的形状 ────────────────────────── */

export interface PreviewBuildResult {
  items: PreviewItemOutput[]
  stats: PreviewStats
  elapsedMs: number
}

/**
 * 预览的两种输入形态：
 *  · `ResolveInput`（带 fromName）—— 单测与主进程用
 *  · `PreviewItemInput`（只有 stem/ext）—— Worker 协议用它，接口文档 §4.3.3
 *    刻意不传 name（那是冗余字段），所以这里用 `joinName(stem, ext)` 还原。
 */
export type PreviewInput = ResolveInput | PreviewItemInput

function toResolveInput(i: PreviewInput): ResolveInput {
  if ('fromName' in i) return i
  // ★ P3-3：逐字段手写搬运，漏拷 `attrs` → Worker 那条路上属性为空，而主进程路径有值
  //   → **预览 ≠ 执行**（设计 §7.5 第 2 行）。
  return {
    id: i.id,
    dirPath: i.dirPath,
    fromName: joinName(i.stem, i.ext),
    isDir: i.isDir,
    attrs: i.attrs,
    // ★ P3-4：同一个搬运点、同一个坑。漏拷 `override` → Worker 那条路按规则算名字，
    //   而主进程执行时用的是表里的名字 → **预览 ≠ 执行**（设计 §7.5 第 2 行）
    override: i.override,
  }
}

/**
 * 预览请求里「每一项」的来源形状 —— 只列真正要搬运的字段。
 *
 * 刻意不直接用 `FileItem`：那个类型还带着 `newName` / `status` 这些**由预览自己算出来**
 * 的字段，让它们跟着请求走一圈，只会让人分不清「谁算谁」。
 */
export interface PreviewSourceItem {
  id: string
  dirPath: string
  stem: string
  ext: string
  isDir: boolean
  attrs: ItemAttrs
  override?: ItemOverride
}

/**
 * 把列表项压成预览请求的形状。
 *
 * ── ★★ 为什么嵌套对象一定要**摊平成普通对象** ────────────────────────
 * `items` 是 Vue 的响应式数组，**它里面的 `attrs` / `override` 也是 Vue 代理**。
 * 把代理塞进 `postMessage` 会抛 `DataCloneError` —— 而 `preview-runner` 的兜底会
 * 「就地算完」，于是**功能看起来一切正常**，实际上：
 *   · Worker 白搭了（每次预览都在主线程算）；
 *   · 每次预览刷一条 `预览请求无法发给 Worker` 的警告（2026-09-22 的实测：一轮冒烟 43 条）。
 * 这正是本项目最怕的「值没错、只是悄悄降级」类问题 —— 所以这里单独成函数，
 * 好让单测**用真 Proxy 钉住它**（见 `tests/p3-4-import.test.ts` 的「必须传普通对象」）。
 *
 * 与 `stores/files.ts` 里对 `rule` / `snapshot` 过一遍 `JSON.parse(JSON.stringify(...))`
 * 是同一条纪律：**跨 Worker 边界只传纯数据**。
 */
export function toPreviewItemInputs(items: PreviewSourceItem[]): PreviewItemInput[] {
  return items.map((i) => ({
    id: i.id,
    dirPath: i.dirPath,
    stem: i.stem,
    ext: i.ext,
    isDir: i.isDir,
    attrs: { ...i.attrs },
    override: i.override === undefined ? undefined : { ...i.override },
  }))
}

export function buildPreview(
  items: PreviewInput[],
  rule: RuleConfig,
  date: string,
  snapshot: Record<string, string[]>,
  autoResolve: boolean,
): PreviewBuildResult {
  const t0 = Date.now()
  const stats: PreviewStats = { changed: 0, unchanged: 0, conflict: 0, invalid: 0 }

  // 空列表兜底：不做任何计算
  if (items.length === 0) {
    return { items: [], stats, elapsedMs: 0 }
  }

  const resolved = resolveItems(items.map(toResolveInput), rule, date, snapshot, autoResolve)
  const out: PreviewItemOutput[] = resolved.map((r) => {
    switch (r.status) {
      case 'changed':
        stats.changed++
        break
      case 'unchanged':
        stats.unchanged++
        break
      case 'conflict':
        stats.conflict++
        break
      case 'invalid':
        stats.invalid++
        break
      default:
        break
    }

    return {
      id: r.id,
      newStem: r.newStem,
      newName: r.toName,
      status: r.status,
      conflictKind: r.conflictKind,
      reason: r.reason,
      reasonCode: r.code,
      diffRange: r.diffRange,
      resolvedName: r.resolvedName,
    }
  })

  return { items: out, stats, elapsedMs: Date.now() - t0 }
}
