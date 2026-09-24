/**
 * 文件夹合并执行服务（P3-7 / 第 7 批 · 设计 §3 / §4 / §5）。
 *
 * 两个入口：
 *   · `planMerge` —— 干跑：递归摊平 + 算落点 + 冲突检测，**不碰任何文件**。
 *     返回报告，渲染层展示「将复制 N / 跳过 M」并让用户确认。
 *   · `runMerge`  —— 执行：复用 `planMerge` 拿到与干跑**逐字节一致**的计划
 *     （TC-87：干跑 ≡ 执行），再真正复制 / 剪切。
 *
 * 安全铁律（设计 §1.3 / §4）：
 *   · ★ 绝不覆盖：冲突项跳过 + 标红；执行时再判一次磁盘，仍不覆盖。
 *   · 剪切两阶段：先确保**全部**复制成功，再统一删源；删源失败 → 半移动态标红，
 *     已复制项**不回滚**（设计 §4 边界 4 / §5⑥）。
 *   · 完成后打开目标目录：用 `shell.openPath`，异常静默吞掉、不影响主结果（§4 边界 12）。
 */

import { promises as fs, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { shell } from 'electron'
import { MD_ERROR, errorText } from '@shared/errors'
import { normalizeSeparators, stripTrailingSep, isAbsoluteWinPath } from '@shared/path-utils'
import { computeMergePlan } from '@shared/merge-plan'
import type {
  MergeMode,
  MergeOperation,
  MergePlanEntry,
  MergePlanResult,
  MergeRequest,
  MergeRunResult,
} from '@shared/types'
import { walkSources } from './fs-walk'

/**
 * 收口请求（与改名通道同款纪律）：默认值下的输出与「什么都不传」也安全，
 * 绝不猜字段。任何一处漏收口 → 静默变成默认值，而不是崩。
 */
function sanitizeMergeRequest(raw: unknown): MergeRequest {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const asArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

  const mode: MergeMode =
    src.mode === 'same' || src.mode === 'byExt' || src.mode === 'byCreated' || src.mode === 'byModified'
      ? src.mode
      : 'same'
  const operation: MergeOperation = src.operation === 'cut' ? 'cut' : 'copy'

  return {
    target: typeof src.target === 'string' ? src.target : '',
    mode,
    operation,
    // 源路径只收绝对路径；非绝对的直接丢弃（绝不拿相对路径去动文件）
    sourcePaths: asArray(src.sourcePaths).filter((p) => isAbsoluteWinPath(p)),
    // 递归摊平默认开（拍板第 6 条）
    recurse: src.recurse !== false,
    // 目标「新建」模式
    targetNew: src.targetNew === true,
    // 完成后打开目录默认勾（拍板第 9 条）
    openAfter: src.openAfter !== false,
  }
}

/** 归一化目标根 + 处理「新建目标已存在」的结构性拒绝 */
function normalizeTarget(req: MergeRequest): { target: string; rejected?: MergePlanResult['rejected'] } {
  const target = stripTrailingSep(normalizeSeparators(resolve(req.target || '')))
  if (!isAbsoluteWinPath(target)) {
    return { target, rejected: { code: MD_ERROR.E_UNKNOWN, reason: '目标文件夹路径无效' } }
  }
  if (req.targetNew && existsSync(target)) {
    // 设计 §3.3：新建模式下目标已存在 → 拒绝并要求改名
    return { target, rejected: { code: MD_ERROR.E_TARGET_EXISTS, reason: errorText(MD_ERROR.E_TARGET_EXISTS) } }
  }
  return { target }
}

/** 干跑：算计划、不碰文件 */
export async function planMerge(raw: unknown): Promise<MergePlanResult> {
  const req = sanitizeMergeRequest(raw)
  const { target, rejected } = normalizeTarget(req)
  if (rejected) {
    return {
      target,
      fileCount: 0,
      entries: [],
      summary: { ready: 0, skip: 0, error: 0 },
      rejected,
    }
  }

  const walk = await walkSources(req.sourcePaths, req.recurse)
  if (walk.error) {
    return { target, fileCount: 0, entries: [], summary: { ready: 0, skip: 0, error: 0 }, rejected: walk.error }
  }
  if (walk.files.length === 0) {
    return {
      target,
      fileCount: 0,
      entries: [],
      summary: { ready: 0, skip: 0, error: 0 },
      rejected: { code: MD_ERROR.E_LIST_EMPTY, reason: errorText(MD_ERROR.E_LIST_EMPTY) || '没有可合并的文件' },
    }
  }

  // ★ 干跑与执行共用 computeMergePlan（设计 §7.3 第 3 行）
  return computeMergePlan({
    target,
    mode: req.mode,
    operation: req.operation,
    sourceRoots: req.sourcePaths,
    items: walk.files,
    destExists: (p) => existsSync(p),
  })
}

/** 执行：先复用 planMerge 的计划，再真正搬文件 */
export async function runMerge(raw: unknown): Promise<MergeRunResult> {
  const started = Date.now()
  const req = sanitizeMergeRequest(raw)
  const { target } = normalizeTarget(req)

  const plan = await planMerge(raw)
  const base: MergeRunResult = {
    target,
    summary: { copied: 0, skipped: 0, errored: 0, deleted: 0 },
    entries: [],
    halfMoved: false,
    openAfter: req.openAfter,
    revealed: false,
    elapsedMs: Date.now() - started,
  }

  // 结构性拒绝 → 一个都不动
  if (plan.rejected) {
    return { ...base, entries: plan.entries }
  }

  const copiedSrc: string[] = []
  let skipped = 0
  let errored = 0
  const entries: MergePlanEntry[] = []

  for (const e of plan.entries) {
    if (e.outcome !== 'ready') {
      if (e.outcome === 'skip') skipped++
      else errored++
      entries.push(e)
      continue
    }
    try {
      // 确保目标目录（含 ②③ 的子文件夹）存在
      await fs.mkdir(dirname(e.destPath), { recursive: true })
      // ★ 计划之后磁盘可能变了：再判一次冲突，绝不覆盖
      if (existsSync(e.destPath)) {
        skipped++
        entries.push({
          ...e,
          outcome: 'skip',
          code: MD_ERROR.E_CONFLICT_DISK,
          reason: errorText(MD_ERROR.E_CONFLICT_DISK),
        })
        continue
      }
      // recursive:true → 文件夹 item 也会整目录复制
      await fs.cp(e.srcPath, e.destPath, { recursive: true })
      copiedSrc.push(e.srcPath)
      entries.push(e)
    } catch {
      errored++
      entries.push({ ...e, outcome: 'error', code: MD_ERROR.E_UNKNOWN, reason: errorText(MD_ERROR.E_UNKNOWN) })
    }
  }

  // ★ 剪切两阶段：全部复制成功后，才统一删源（设计 §4 边界 4）
  let halfMoved = false
  let deleted = 0
  if (req.operation === 'cut') {
    for (const src of copiedSrc) {
      try {
        await fs.rm(src, { recursive: true, force: true })
        deleted++
      } catch {
        // 删不掉 → 半移动态标红（EX-20）；已复制项不回滚
        halfMoved = true
      }
    }
  }

  // 完成后打开目标目录（静默失败不影响主结果，设计 §4 边界 12）
  let revealed = false
  if (req.openAfter) {
    try {
      await shell.openPath(target)
      revealed = true
    } catch {
      revealed = false
    }
  }

  return {
    target,
    summary: { copied: copiedSrc.length, skipped, errored, deleted },
    entries,
    halfMoved,
    openAfter: req.openAfter,
    revealed,
    elapsedMs: Date.now() - started,
  }
}
