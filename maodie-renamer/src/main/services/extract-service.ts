/**
 * 文件提取执行服务（P3-8 / 第 8 批 · 设计 §3 / §5③）。
 *
 * ★ 本批**唯一真正新增的逻辑是「筛选」**（`shared/extract-filter.ts`）。
 *   搬文件完全复用 P3-7 的运输层：
 *     · 干跑算落点 → `merge-service.planMerge`（内部 `computeMergePlan`，单一目录 `T\<原名>`）
 *     · 真执行     → `merge-service.runMerge`（先全复制再删源的两阶段剪切、
 *                     绝不覆盖、完成后打开目录，全部是 P3-7 既有安全网）
 *
 * 所以这里只做三件事（设计 §0 结论表）：
 *   1. 收口请求（与 merge 同款纪律：不猜字段，缺省即安全默认）。
 *   2. 调 `filterList` 算命中集（干跑与执行**共用同一份**，保证 干跑≡执行）。
 *   3. 把命中集合成一个 `MergeRequest`（mode='same' / 单一目录 / recurse:false），
 *      喂给 P3-7 运输层。
 */

import { errorText, isMdError, MD_ERROR, type MdErrorCode } from '@shared/errors'
import { isAbsoluteWinPath, normalizeSeparators, stripTrailingSep } from '@shared/path-utils'
import { filterList, type FilterResult } from '@shared/extract-filter'
import type {
  ExtractFilter,
  ExtractPlanResult,
  ExtractRequest,
  ExtractSourceFile,
  FileCategory,
  MergeRequest,
  MergeRunResult,
  MergeOperation,
} from '@shared/types'
import { planMerge, runMerge } from './merge-service'

/* ══ 收口 ══════════════════════════════════════════════════════════ */

function basenameOf(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return i >= 0 ? p.slice(i + 1) : p
}

function asItems(v: unknown): ExtractSourceFile[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((it): it is Record<string, unknown> => typeof it === 'object' && it !== null)
    .map((it) => ({
      fullPath: typeof it.fullPath === 'string' ? it.fullPath : '',
      name: typeof it.name === 'string' ? it.name : typeof it.fullPath === 'string' ? basenameOf(it.fullPath) : '',
      ext: typeof it.ext === 'string' ? it.ext : '',
      isDir: it.isDir === true,
    }))
    .filter((it) => isAbsoluteWinPath(it.fullPath))
}

function asCategories(v: unknown): FileCategory[] | undefined {
  if (!Array.isArray(v)) return undefined
  const valid = v.filter((c): c is FileCategory => typeof c === 'string')
  return valid.length > 0 ? valid : undefined
}

function sanitizeExtractRequest(raw: unknown): ExtractRequest {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const operation: MergeOperation = src.operation === 'cut' ? 'cut' : 'copy'

  const filterRaw = (typeof src.filter === 'object' && src.filter !== null ? src.filter : {}) as Record<string, unknown>
  const nameRaw = (typeof filterRaw.name === 'object' && filterRaw.name !== null ? filterRaw.name : {}) as Record<string, unknown>
  const filter: ExtractFilter = {
    categories: asCategories(filterRaw.categories),
    name:
      typeof nameRaw.keyword === 'string'
        ? { keyword: nameRaw.keyword, useRegex: nameRaw.useRegex === true }
        : undefined,
    excelNames: Array.isArray(filterRaw.excelNames)
      ? filterRaw.excelNames.filter((n): n is string => typeof n === 'string')
      : undefined,
  }

  return {
    target: typeof src.target === 'string' ? src.target : '',
    operation,
    items: asItems(src.items),
    filter,
    targetNew: src.targetNew === true,
    openAfter: src.openAfter !== false,
  }
}

/* ══ 命中集 → 运输层请求 ════════════════════════════════════════════ */

function hitPaths(filtered: FilterResult): string[] {
  return filtered.hits.map((h) => h.fullPath)
}

/**
 * 合成 P3-7 的 `MergeRequest`（单一目录、不递归、直接落 `T\<原名>`）。
 *
 * ★ 关键：plan 与 run 都调本函数、喂**同一份命中集** → 两个通道拿到完全相同的
 *   运输请求 → 落点逐字节一致（TC-95）。
 */
function toMergeRequest(req: ExtractRequest, paths: string[]): MergeRequest {
  return {
    target: req.target,
    mode: 'same',
    operation: req.operation,
    sourcePaths: paths,
    recurse: false,
    targetNew: req.targetNew,
    openAfter: req.openAfter,
  }
}

function emptyPlan(target: string, sourceCount: number): ExtractPlanResult {
  return {
    target,
    sourceCount,
    hitCount: 0,
    fileCount: 0,
    entries: [],
    summary: { ready: 0, skip: 0, error: 0 },
    unmatched: [],
  }
}

function rejectedPlan(target: string, sourceCount: number, code: MdErrorCode, reason: string): ExtractPlanResult {
  return { ...emptyPlan(target, sourceCount), rejected: { code, reason } }
}

/* ══ 干跑（plan）══════════════════════════════════════════════════ */

export async function planExtract(raw: unknown): Promise<ExtractPlanResult> {
  const req = sanitizeExtractRequest(raw)
  const sourceCount = req.items.length

  // 结构性拒绝 1：空列表（设计 §4 边界 11）
  if (sourceCount === 0) {
    return rejectedPlan(
      normalizeSeparators(stripTrailingSep(req.target || '')),
      sourceCount,
      MD_ERROR.E_LIST_EMPTY,
      errorText(MD_ERROR.E_LIST_EMPTY) || '列表为空，请先添加文件',
    )
  }

  // 算命中集；正则非法（EX-22）在计划阶段拦截 → 拒绝干跑
  let filtered: FilterResult
  try {
    filtered = filterList(req.items, req.filter)
  } catch (e) {
    if (isMdError(e)) {
      return rejectedPlan(req.target, sourceCount, e.code, errorText(e.code) || e.detail || '筛选条件不合法')
    }
    throw e
  }

  // 筛选结果为空（设计 §4 边界 2）：不打开执行，给友好提示（非 rejected，UI 按 hitCount 禁用）
  if (filtered.hits.length === 0) {
    return { ...emptyPlan(req.target, sourceCount), note: '没有符合条件的文件', unmatched: filtered.unmatched }
  }

  // 复用 P3-7 运输层算落点（单一目录、冲突检测、绝不覆盖）
  const plan = await planMerge(toMergeRequest(req, hitPaths(filtered)))

  return {
    target: plan.target,
    sourceCount,
    hitCount: filtered.hits.length,
    fileCount: plan.fileCount,
    entries: plan.entries,
    summary: plan.summary,
    unmatched: filtered.unmatched,
    rejected: plan.rejected,
  }
}

/* ══ 执行（run）══════════════════════════════════════════════════ */

function emptyRun(target: string): MergeRunResult {
  return {
    target,
    summary: { copied: 0, skipped: 0, errored: 0, deleted: 0 },
    entries: [],
    halfMoved: false,
    openAfter: false,
    revealed: false,
    elapsedMs: 0,
  }
}

export async function runExtract(raw: unknown): Promise<MergeRunResult> {
  const req = sanitizeExtractRequest(raw)

  let filtered: FilterResult
  try {
    filtered = filterList(req.items, req.filter)
  } catch (e) {
    if (isMdError(e)) {
      // 正则非法等：返回一个「什么都不动」的结果，避免半途而废
      return emptyRun(req.target)
    }
    throw e
  }

  // 没有命中 → 一个都不动（与干跑一致）
  if (filtered.hits.length === 0) return emptyRun(req.target)

  // ★ 复用 P3-7 执行器（内部重跑 planMerge，落点逐字节一致）→ 真搬文件
  return runMerge(toMergeRequest(req, hitPaths(filtered)))
}
