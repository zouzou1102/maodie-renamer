/**
 * 两阶段改名执行器（技术方案 §4.2.1 / PRD §4.4.3）。
 *
 * ── 为什么必须两阶段 ─────────────────────────────────────────────────
 * 若有 `A.txt → B.txt`、同时 `B.txt → C.txt`，直接按顺序改会在第一步就撞上
 * 尚未处理的 `B.txt`。改成「先全部改临时名，再改目标名」即可避免。
 *
 * ── 本文件的角色 ────────────────────────────────────────────────────
 * **执行器不做任何决策。** 所有判定都在阶段 0（`@shared/rename-plan`）完成，
 * 执行器只照单执行已判定为安全的清单。这是「绝不覆盖」的第 2 层防护。
 *
 * ⚠ ESLint 硬规则（P-02）：本文件内**禁止**直接调用 `fs.rename` /
 * `fs.promises.rename` / `renameSync`，只能用 `fs-safe.ts` 的 `safeRename`
 * （它内含存在性检查）。这使「绝不覆盖」从口头约定变成写不出来的代码。
 */

import { PROBLEMS_MAX, PROGRESS_EVERY_ITEMS, PROGRESS_EVERY_MS, SUCCESS_EXAMPLES_MAX, TMP_INDEX_PAD, TMP_MAX_RETRY, TMP_PREFIX, YIELD_THRESHOLD } from '@shared/constants'
import { MD_ERROR, errorText, type MdErrorCode } from '@shared/errors'
import { dirKey } from '@shared/path-utils'
import { assertPlanIsSafe, buildRenamePlan } from '@shared/rename-plan'
import type { ResolvedItem, ResolveInput } from '@shared/preview'
import type {
  ExecuteRequest,
  ExecuteResult,
  ProgressPayload,
  RenameEntry,
  UndoSkip,
} from '@shared/types'
import { listDirOrNull, pathOf, safeRename, toMdErrorCode } from './fs-safe'

/* ── 类型 ───────────────────────────────────────────────────────────── */

type EntryState = 'ready' | 'tmp' | 'done' | 'failed'

interface LiveEntry {
  id: string
  dirPath: string
  fromName: string
  toName: string
  ext: string
  isDir: boolean
  state: EntryState
  tmpName?: string
  code?: MdErrorCode
  reason?: string
}

export interface ExecuteOutcome {
  result: ExecuteResult
  /** 只含「改名成功」的明细，供调用方写历史（数据库设计 §4.3） */
  successEntries: RenameEntry[]
  /** 取消时成功回滚的项数（供 CancelResult 回报） */
  rolledBack: number
}

export type ProgressFn = (p: ProgressPayload) => void

/* ── 目录快照 ───────────────────────────────────────────────────────── */

/**
 * 阶段 0.2：按 dirPath 去重后并发 readdir（并发度 8）。
 * 1000 个文件若在 1 个目录 → 只查 1 次。
 *
 * 读不出来的目录记为「无现存文件」—— 这里乐观不影响安全：
 * 真正的最后一道闸门是 `safeRename`，它在读不出目录时会**拒绝改名**。
 */
async function readSnapshots(items: ResolveInput[]): Promise<Record<string, string[]>> {
  const dirs = new Map<string, string>()
  for (const it of items) {
    const k = dirKey(it.dirPath)
    if (!dirs.has(k)) dirs.set(k, it.dirPath)
  }

  const list = [...dirs.entries()]
  const out: Record<string, string[]> = {}
  let cursor = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++
      if (i >= list.length) return
      const [k, dir] = list[i]
      try {
        out[k] = (await listDirOrNull(dir)) ?? []
      } catch {
        out[k] = []
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(8, list.length) }, worker))
  return out
}

/* ── 本地日期 ───────────────────────────────────────────────────────── */

/** 本机当天日期（YYYY-MM-DD，本地时区）。DEC-03：日期取执行当天 */
export function localDateString(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/* ── 进度节流 ───────────────────────────────────────────────────────── */

/**
 * 进度节流：每 50 项 **或** 距上次推送 > 100ms（两者取先到）推一次。
 *
 * 必要性：10000 项若每项推一次，就是 10000 次 IPC + 10000 次 Vue 更新，
 * 界面必然卡死。节流把 10000 项压到约 200 次推送。
 */
function makeProgressEmitter(taskId: string, onProgress: ProgressFn) {
  let lastAt = 0
  return (
    phase: ProgressPayload['phase'],
    done: number,
    total: number,
    currentName: string | null,
    force = false,
  ) => {
    const now = Date.now()
    const due = done % PROGRESS_EVERY_ITEMS === 0
    if (!force && !due && now - lastAt < PROGRESS_EVERY_MS) return
    lastAt = now
    onProgress({ taskId, phase, done, total, currentName })
  }
}

const yieldToLoop = (): Promise<void> => new Promise((r) => setImmediate(r))

/* ── 临时名生成 ─────────────────────────────────────────────────────── */

function makeTmpName(taskId: string, index: number, ext: string): string {
  return `${TMP_PREFIX}${taskId}_${String(index).padStart(TMP_INDEX_PAD, '0')}${ext}`
}

/* ── 主流程 ─────────────────────────────────────────────────────────── */

export async function execute(
  req: ExecuteRequest,
  onProgress: ProgressFn,
  signal: AbortSignal,
): Promise<ExecuteOutcome> {
  const t0 = Date.now()
  const taskId = req.taskId
  const total = req.items.length

  const emit = makeProgressEmitter(taskId, onProgress)

  // ── 阶段 0：构建计划 ────────────────────────────────────────────────
  emit('planning', 0, total, null, true)

  // 0.1 校验日期参数等于本机当前日期（不一致则用本机当天）
  const today = localDateString()
  const date = req.date === today ? req.date : today
  if (req.date !== today) {
    console.warn(`[md] execute: 收到日期 ${req.date}，与本机今天 ${today} 不一致，已改用本机日期`)
  }

  // 0.2 目录快照
  const inputs: ResolveInput[] = req.items.map((it) => ({
    id: it.id,
    dirPath: it.dirPath,
    fromName: it.fromName,
    isDir: it.isDir,
    // ★ P3-3：不补这一行 → 主进程算新名时拿不到属性 → `{大小}` 展开成空串（设计 §7.5 第 4 行）
    attrs: it.attrs,
    // ★ P3-4：不补这一行 → 主进程按规则重算、**表里的名字被完全忽略**，
    //   而界面预览是对的 → 「预览对、执行错」（与 P3-1 同一类形态，设计 §7.5 第 3 行）
    override: it.override,
  }))
  const snapshot = await readSnapshots(inputs)

  // 0.3 ~ 0.5 算新名 → 校验 → 冲突判定 → 分三份清单
  const plan = buildRenamePlan(inputs, req.rule, date, snapshot, req.autoResolveConflict)
  assertPlanIsSafe(plan)

  // 待执行清单 + 已完成判定但不执行的项（跳过 / 非法）
  const problems: ExecuteResult['problems'] = []
  const pushProblem = (
    src: { id: string; dirPath: string; fromName: string },
    attemptedName: string,
    result: 'skipped' | 'failed' | 'invalid',
    code: MdErrorCode,
    reason: string,
  ) => {
    problems.push({ id: src.id, dirPath: src.dirPath, fromName: src.fromName, attemptedName, result, code, reason })
  }

  for (const e of plan.invalid) {
    pushProblem(e, e.attemptedName, 'invalid', e.code ?? MD_ERROR.E_UNKNOWN, e.reason ?? errorText(e.code ?? MD_ERROR.E_UNKNOWN))
  }
  for (const e of plan.skipped) {
    // 「无变化」不是一个「问题」，不列进失败/跳过清单（界面列表里已灰显）
    if (e.code === MD_ERROR.E_NO_CHANGE) continue
    pushProblem(e, e.attemptedName, 'skipped', e.code ?? MD_ERROR.E_CONFLICT_DISK, e.reason ?? '')
  }

  const live: LiveEntry[] = plan.ready.map((e: ResolvedItem) => ({
    id: e.id,
    dirPath: e.dirPath,
    fromName: e.fromName,
    toName: e.toName,
    ext: e.ext,
    isDir: e.isDir,
    state: 'ready',
  }))

  // ── 阶段 1：原名 → 临时名 ───────────────────────────────────────────
  let canceled = false
  let processed = 0
  emit('to_temp', 0, live.length, null, true)

  for (const e of live) {
    if (signal.aborted) {
      canceled = true
      break
    }

    const from = pathOf(e.dirPath, e.fromName)
    let renamed = false

    for (let attempt = 0; attempt < TMP_MAX_RETRY; attempt++) {
      const tmpName = makeTmpName(taskId, processed + attempt, e.ext)
      const to = pathOf(e.dirPath, tmpName)
      try {
        await safeRename(from, to)
        e.state = 'tmp'
        e.tmpName = tmpName
        renamed = true
        break
      } catch (err) {
        const code = await toMdErrorCode(err, e.dirPath)
        // 临时名撞名（自己前缀，只可能是极端巧合）→ 换号重试
        if (code === MD_ERROR.E_CONFLICT_DISK && attempt < TMP_MAX_RETRY - 1) continue
        e.state = 'failed'
        e.code = code
        e.reason = errorText(code)
        pushProblem(e, e.toName, 'failed', code, e.reason)
        break
      }
    }

    if (!renamed && e.state === 'ready') {
      // 5 次换号都失败
      e.state = 'failed'
      e.code = MD_ERROR.E_CONFLICT_DISK
      e.reason = errorText(MD_ERROR.E_CONFLICT_DISK)
      pushProblem(e, e.toName, 'failed', MD_ERROR.E_CONFLICT_DISK, e.reason)
    }

    processed++
    emit('to_temp', processed, live.length, e.fromName)
    if (live.length > YIELD_THRESHOLD && processed % 500 === 0) await yieldToLoop()
  }

  // ── 阶段 2：临时名 → 目标名 ─────────────────────────────────────────
  if (!canceled) {
    await yieldToLoop()
    emit('to_target', 0, live.length, null, true)

    let step = 0
    for (const e of live) {
      if (e.state !== 'tmp') continue
      if (signal.aborted) {
        canceled = true
        break
      }

      const from = pathOf(e.dirPath, e.tmpName!)
      const to = pathOf(e.dirPath, e.toName)
      try {
        // ★ 最后一道闸门：safeRename 内含存在性检查，存在即拒绝
        await safeRename(from, to)
        e.state = 'done'
      } catch (err) {
        // 回滚该项：tmp → 原名
        const code = await toMdErrorCode(err, e.dirPath)
        let rolling = code
        try {
          await safeRename(from, pathOf(e.dirPath, e.fromName))
        } catch (rbErr) {
          rolling = await toMdErrorCode(rbErr, e.dirPath)
        }
        e.state = 'failed'
        e.code = rolling
        e.reason = errorText(rolling)
        pushProblem(e, e.toName, 'failed', rolling, e.reason)
      }

      step++
      emit('to_target', step, live.length, e.fromName)
      if (live.length > YIELD_THRESHOLD && step % 500 === 0) await yieldToLoop()
    }
  }

  // ── 取消 → 回滚 ────────────────────────────────────────────────────
  let rolledBack = 0
  if (canceled) {
    emit('rolling_back', 0, live.length, null, true)
    rolledBack = await rollback(live, (done) => emit('rolling_back', done, live.length, null), (e) => {
      // 回滚失败的项：文件**仍然是改名后的状态**，必须如实报告，
      // 并且仍然写进历史 —— 否则用户再也无法把它改回去
      pushProblem(e, e.toName, 'failed', MD_ERROR.E_UNKNOWN, errorText(MD_ERROR.E_UNKNOWN))
    })
  }

  // ── 收尾：汇总 ─────────────────────────────────────────────────────
  const successEntries: RenameEntry[] = []
  const successExamples: ExecuteResult['successExamples'] = []
  let success = 0
  let failed = 0

  for (const e of live) {
    if (e.state === 'done') {
      success++
      successEntries.push({ dirPath: e.dirPath, fromName: e.fromName, toName: e.toName })
      if (successExamples.length < SUCCESS_EXAMPLES_MAX) {
        successExamples.push({ dirPath: e.dirPath, fromName: e.fromName, toName: e.toName })
      }
    } else if (e.state === 'failed') {
      failed++
    }
  }

  const skipped = plan.skipped.filter((e) => e.code !== MD_ERROR.E_NO_CHANGE).length
  const invalid = plan.invalid.length
  const problemsTotal = problems.length
  const truncated = problems.slice(0, PROBLEMS_MAX)

  const result: ExecuteResult = {
    taskId,
    canceled,
    summary: { total, success, skipped, invalid, failed },
    successExamples,
    problems: truncated,
    problemsTotal,
    problemsTruncated: problemsTotal > PROBLEMS_MAX,
    // recordSaved 由调用方（rename-service）在写历史之后回填
    recordSaved: false,
    elapsedMs: Date.now() - t0,
  }

  emit(canceled ? 'rolling_back' : 'to_target', live.length, live.length, null, true)
  return { result, successEntries, rolledBack }
}

/**
 * 取消时的回滚：按 tmp / done 的**逆序**执行，避免中间态撞名
 * （例如批次里有 `A→B`、`B→C`，回滚时先还 `B→C` 这一项，再还 `A→B`）。
 *
 * 回滚**不中断**：某一项回滚失败时继续处理其余项；失败项**保持 `done` 状态**
 * （它确实还是改名后的样子），由调用方如实报告并仍然写进历史 ——
 * 否则用户再也无法把它改回去。
 */
async function rollback(
  live: LiveEntry[],
  onTick: (done: number) => void,
  onFailed: (e: LiveEntry) => void,
): Promise<number> {
  let done = 0
  for (let i = live.length - 1; i >= 0; i--) {
    const e = live[i]
    if (e.state !== 'tmp' && e.state !== 'done') continue

    const current = e.state === 'tmp' ? e.tmpName! : e.toName
    try {
      await safeRename(pathOf(e.dirPath, current), pathOf(e.dirPath, e.fromName))
      done++
      e.state = 'ready'
    } catch {
      e.code = MD_ERROR.E_UNKNOWN
      e.reason = errorText(MD_ERROR.E_UNKNOWN)
      onFailed(e)
    }
    onTick(live.length - i)
  }
  return done
}

/* ── 撤销 ───────────────────────────────────────────────────────────── */

export interface UndoEntriesResult {
  restored: number
  skipped: UndoSkip[]
  /** 是否有任何一项失败到无法继续（用于区分 ok / partial / failed） */
  anySuccess: boolean
}

/**
 * 撤销：把 `toName → fromName` 逐项改回。
 *
 * 两条硬约束（技术方案 §5.5 / PRD §4.5.1）：
 *  1. **倒序执行** —— 批次含 `A→B`、`B→C` 时必须先把 `B→C` 还回去
 *  2. **源不存在即跳过并继续** —— 文件被外部移动 / 改名时不中断整批
 *
 * 撤销只针对 `entries`（只含改名成功的项），所以「试图还原一个从未被改过的
 * 文件」这种边界在数据层就不存在（数据库设计 §4.3）。
 */
export async function undoEntries(
  taskId: string,
  entries: RenameEntry[],
  onProgress: ProgressFn,
): Promise<UndoEntriesResult> {
  let restored = 0
  let anySuccess = false
  const skipped: UndoSkip[] = []

  const emit = makeProgressEmitter(taskId, onProgress)
  emit('to_temp', 0, entries.length, null, true)

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    const from = pathOf(entry.dirPath, entry.toName) // 当前磁盘上的名字
    const to = pathOf(entry.dirPath, entry.fromName) // 要还回去的名字

    try {
      await safeRename(from, to)
      restored++
      anySuccess = true
    } catch (err) {
      const raw = await toMdErrorCode(err, entry.dirPath)
      // 文件已经不在（被外部移走 / 改名）→ 记 E_UNDO_SOURCE_GONE 并跳过，继续其余项
      const code = raw === MD_ERROR.E_SOURCE_MISSING ? MD_ERROR.E_UNDO_SOURCE_GONE : raw
      skipped.push({
        dirPath: entry.dirPath,
        fromName: entry.fromName,
        toName: entry.toName,
        code,
        reason: code === MD_ERROR.E_UNDO_SOURCE_GONE ? errorText(code, 1) : errorText(code),
      })
    }

    emit('to_temp', entries.length - i, entries.length, entry.toName)
  }

  return { restored, skipped, anySuccess }
}
