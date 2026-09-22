/**
 * 改名服务 —— 把「执行器」与「历史存储」串起来，并管住「同时只能跑一个任务」。
 *
 * 为什么单独成模块（而不是写进 ipc handler 或塞进执行器里）：
 *  · ipc handler 不可单测（接口文档 §1.1 的硬规则：handler 不含业务逻辑）
 *  · 执行器不该知道「历史记录」这件事；历史存储又要调用执行器的撤销能力，
 *    两者互相 import 会成环。放在这里，依赖方向保持单向：
 *        rename-service ──→ rename-executor ──→ fs-safe
 *              └──────────→ history-store ────┘
 */

import { MD_ERROR, MdError } from '@shared/errors'
import { buildRuleSummary, type ImportedSummaryInfo } from '@shared/rule-summary'
import type {
  CancelResult,
  ExecuteItem,
  ExecuteRequest,
  ExecuteResult,
  StorageWarningPayload,
} from '@shared/types'
import { execute, localDateString, type ExecuteOutcome, type ProgressFn } from './rename-executor'
import { appendTask, buildTask } from './history-store'
import { setStorageWarningSink } from './storage'

/* ── 单任务闸门 ─────────────────────────────────────────────────────── */

interface RunningTask {
  taskId: string
  controller: AbortController
  promise: Promise<ExecuteOutcome> | null
  rolledBack: number
}

let running: RunningTask | null = null

export function getRunningTaskId(): string | null {
  return running?.taskId ?? null
}

/* ── 执行 ───────────────────────────────────────────────────────────── */

/** P3-4：数出「名字来自表格」的项，顺带取来源表名（没有则返回 undefined）*/
function countOverrides(items: ExecuteItem[]): ImportedSummaryInfo | undefined {
  let count = 0
  let source = ''
  for (const it of items) {
    if (it.override === undefined) continue
    count++
    if (source === '') source = it.override.sourceTable
  }
  return count > 0 ? { count, source } : undefined
}

export async function runRenameTask(req: ExecuteRequest, onProgress: ProgressFn): Promise<ExecuteResult> {
  // 已有任务在跑 → 不做排队、不做抢占（接口文档 §1.3.3）
  if (running) throw new MdError(MD_ERROR.E_TASK_RUNNING, running.taskId)

  if (req.items.length === 0) throw new MdError(MD_ERROR.E_LIST_EMPTY)

  const controller = new AbortController()
  const slot: RunningTask = { taskId: req.taskId, controller, promise: null, rolledBack: 0 }
  running = slot

  try {
    slot.promise = execute(req, onProgress, controller.signal)
    const outcome = await slot.promise
    slot.rolledBack = outcome.rolledBack

    const { result, successEntries } = outcome

    /**
     * 写历史的时机（数据库设计 §4.4.5）：**必须在返回结果之前**。
     * 否则用户看到「改好啦」后立刻点撤销，历史可能还没落盘 → 撤销失败。
     *
     * 什么时候需要写：只要有项真的被改了名。正常完成时就是成功项；
     * 取消时若回滚失败仍有项处于改名后状态，同样要写 —— 否则用户
     * 再也无法把它改回去。
     */
    if (successEntries.length > 0) {
      // ★ P3-4：导入的项名字来自表格、**不受规则影响** —— 摘要里必须说出来，
      //   否则撤销之后没人知道当初是怎么算出来的（设计 §7.5 第 8 行）。
      //   信息直接从清单上数：`override` 是跟着 items 一起传进来的，零新增字段。
      const imported = countOverrides(req.items)
      const task = buildTask(
        req.taskId,
        localDateString(),
        buildRuleSummary(req.rule, imported),
        result,
        successEntries,
      )
      result.recordSaved = await appendTask(task)
      if (!result.recordSaved) {
        notify({
          file: 'history',
          kind: 'write_failed',
          message: '改名记录未能保存，本次改名无法撤销',
        })
      }
    } else {
      // 没有产生任何磁盘变更 → 无需记录（也就无所谓「无法撤销」）
      result.recordSaved = true
    }

    return result
  } finally {
    running = null
  }
}

/* ── 取消 ───────────────────────────────────────────────────────────── */

/**
 * 取消执行（IX-061）。
 *
 * 语义要点：当前正在进行的那个 `rename` 让它跑完（不中断单个原子操作），
 * 然后按 `tmp` / `done` 的**逆序**回滚。
 *
 * 任务已完成时返回 `{ canceled: false }` —— 这是正常的竞态，不是错误。
 */
export async function cancelRenameTask(taskId: string): Promise<CancelResult> {
  const slot = running

  if (!slot || slot.taskId !== taskId) {
    // 任务已经结束（或从未存在）→ 不当作错误
    if (!slot) return { canceled: false, rolledBack: 0 }
    throw new MdError(MD_ERROR.E_TASK_NOT_FOUND, taskId)
  }

  slot.controller.abort()
  // 等 execute 走完回滚流程，才能回报真实的 rolledBack
  await slot.promise?.catch(() => {})
  return { canceled: true, rolledBack: slot.rolledBack }
}

/* ── 存储告警通道 ───────────────────────────────────────────────────── */

let outboundWarning: (w: StorageWarningPayload) => void = () => {}

export function setStorageWarningOutbound(fn: (w: StorageWarningPayload) => void): void {
  outboundWarning = fn
  // 同时挂到 storage 的 sink 上（存储层读坏文件时也会走这里）
  setStorageWarningSink(fn)
}

function notify(w: StorageWarningPayload): void {
  outboundWarning(w)
}
