/**
 * 文件夹合并的「算落点」纯函数（P3-7 / 第 7 批 · 设计 §5⑤）。
 *
 * 为什么是纯函数、放在 shared：
 *   · 干跑报告与真执行**共用同一份** → 「预览 ≡ 执行」才有落点（设计 §3 / §7.3 第 3 行），
 *     报告说跳过 3 个、执行就绝不会覆盖那 3 个。
 *   · **不 import `node:fs`** → 可被 `node --test` 直接单测（与 `rename-plan` 同族）。
 *     磁盘存在性检查通过注入的 `destExists` 谓词完成，测试里给它一个假集合即可。
 *
 * 落点规则（设计 §3.1）：记目标根为 `T`，源文件 `S` 的名称为 `name`、扩展名 `ext`：
 *   ① same      → `T\<name>`
 *   ② byExt     → `T\<ext 去点>\<name>`（无扩展名 → `无扩展名`）
 *   ③ byCreated → `T\<创建日 YYYY-MM-DD>\<name>`
 *   ④ byModified→ `T\<修改日 YYYY-MM-DD>\<name>`
 */

import { joinPath, normalizeSeparators, stripTrailingSep } from '@shared/path-utils'
import { errorText, MD_ERROR } from '@shared/errors'
import type { MergeMode, MergeOperation, MergePlanResult } from '@shared/types'

/**
 * 递归摊平后得到的「一个实际文件」的形状（由 `main/services/fs-walk` 产出）。
 *
 * `created` / `modified` 已是本机本地时区的 `YYYY-MM-DD`（来自 `lstat` 的
 * `birthtime` / `mtime`，经 `ymdFromMs` 转好），这里**不碰日期换算**。
 */
export interface MergeSourceItem {
  /** 实际源文件绝对路径（递归摊平后）*/
  srcPath: string
  /** 文件名（含扩展名；文件夹则含其全名、ext 为空串）*/
  name: string
  /** 扩展名，含点；无则空串（来自 `splitName`）*/
  ext: string
  /** 创建日期 `YYYY-MM-DD`（本地时区；不可用为空串）*/
  created: string
  /** 修改日期 `YYYY-MM-DD`（本地时区；不可用为空串）*/
  modified: string
  /** 是否为文件夹（递归摊平关时，文件夹本身会作为一个 item）*/
  isDir: boolean
}

/** `computeMergePlan` 的输入（主进程 `merge-service` / 单测都喂这个形状）*/
export interface MergePlanInput {
  /** 目标根目录 T（绝对路径，反斜杠形式）*/
  target: string
  mode: MergeMode
  operation: MergeOperation
  /** 用户选中的原始源路径（文件 / 文件夹），用于「目标不能落在源内部」的拒绝判断 */
  sourceRoots: string[]
  /** 递归摊平后的实际文件清单 */
  items: MergeSourceItem[]
  /** 注入的「目标路径是否已存在于磁盘」谓词（单测里给假集合；主进程传 `fs.existsSync`）*/
  destExists: (destPath: string) => boolean
}

/** ② 按扩展名时的子文件夹名：`ext` 含点，去点；无扩展名 → `无扩展名` */
function extFolder(ext: string): string {
  return ext === '' ? '无扩展名' : ext.slice(1)
}

/** ③④ 按日期时的子文件夹名：空日期用可读占位，避免建出空名文件夹（会失败）*/
function dateFolder(date: string, which: 'created' | 'modified'): string {
  if (date === '') return which === 'created' ? '未知创建日期' : '未知修改日期'
  return date
}

/** 算单个 item 的落点（不含冲突判断）*/
function destOf(target: string, mode: MergeMode, item: MergeSourceItem): string {
  const parts: string[] = [target]
  switch (mode) {
    case 'same':
      break
    case 'byExt':
      parts.push(extFolder(item.ext))
      break
    case 'byCreated':
      parts.push(dateFolder(item.created, 'created'))
      break
    case 'byModified':
      parts.push(dateFolder(item.modified, 'modified'))
      break
  }
  parts.push(item.name)
  // ★ 用 shared 自己的 joinPath（不能 import node:path —— ADR-001 / 渲染层零 Node 权限）
  return parts.reduce((acc, p) => joinPath(acc, p))
}

/**
 * 目标是否落在某个源文件夹**内部**（设计 §4 边界 8 / §7.3 第 10 行）。
 *
 * 不拦 → 尝试把源复制进自己里面 → 无限增长 / 失败。纯字符串判断，不需 fs。
 */
function isTargetInsideSource(target: string, sourceRoots: string[]): boolean {
  const t = stripTrailingSep(normalizeSeparators(target)).toLowerCase()
  for (const raw of sourceRoots) {
    const root = stripTrailingSep(normalizeSeparators(raw)).toLowerCase()
    if (root === '') continue
    if (t === root) return true
    if (t.startsWith(root + '\\')) return true
  }
  return false
}

/**
 * 算整批合并计划（纯函数）。
 *
 * 不抛异常：结构性错误（目标在源内、空源）放进 `rejected`，调用方据此禁用「确认执行」。
 * 冲突（磁盘已存在 / 源内重名）逐条标成 `skip`，绝不覆盖（设计 §1.3）。
 */
export function computeMergePlan(input: MergePlanInput): MergePlanResult {
  const target = stripTrailingSep(normalizeSeparators(input.target))
  const base: MergePlanResult = {
    target,
    fileCount: input.items.length,
    entries: [],
    summary: { ready: 0, skip: 0, error: 0 },
  }

  // ★ 结构性拒绝 1：目标落在源内部（设计 §4 边界 8）
  if (isTargetInsideSource(target, input.sourceRoots)) {
    return {
      ...base,
      rejected: { code: MD_ERROR.E_TARGET_INSIDE_SOURCE, reason: errorText(MD_ERROR.E_TARGET_INSIDE_SOURCE) },
    }
  }

  // ★ 结构性拒绝 2：空源（设计 §4 边界 10）
  if (input.items.length === 0) {
    return {
      ...base,
      rejected: { code: MD_ERROR.E_LIST_EMPTY, reason: errorText(MD_ERROR.E_LIST_EMPTY) || '没有可合并的文件' },
    }
  }

  const seen = new Map<string, number>()
  let ready = 0
  let skip = 0
  let error = 0

  input.items.forEach((item, i) => {
    if (item.name === '') {
      // 极端兜底：空名文件无法落盘
      error++
      base.entries.push({
        srcPath: item.srcPath,
        destPath: target,
        outcome: 'error',
        code: MD_ERROR.E_EMPTY_NAME,
        reason: errorText(MD_ERROR.E_EMPTY_NAME),
      })
      return
    }

    const destPath = destOf(target, input.mode, item)

    // ① 磁盘冲突：目标已存在同名 → 跳过 + 标红（绝不覆盖，设计 §1.3 / §4 边界 1）
    if (input.destExists(destPath)) {
      skip++
      base.entries.push({
        srcPath: item.srcPath,
        destPath,
        outcome: 'skip',
        code: MD_ERROR.E_CONFLICT_DISK,
        reason: errorText(MD_ERROR.E_CONFLICT_DISK),
      })
      return
    }

    // ② 批量冲突：两个源文件算出同一个落点 → 后者跳过（设计 §4 边界 1）
    if (seen.has(destPath)) {
      skip++
      base.entries.push({
        srcPath: item.srcPath,
        destPath,
        outcome: 'skip',
        code: MD_ERROR.E_CONFLICT_BATCH,
        reason: '源里还有另一个同名文件，会撞名，已跳过',
      })
      return
    }

    seen.set(destPath, i)
    ready++
    base.entries.push({ srcPath: item.srcPath, destPath, outcome: 'ready' })
  })

  base.summary = { ready, skip, error }
  return base
}
