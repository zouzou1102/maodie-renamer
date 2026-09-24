/**
 * md:merge:* —— 文件夹合并（P3-7 / 第 7 批，业务通道）。
 *
 * 两个通道：
 *   · `md:merge:plan` —— 干跑：返回合并计划报告，**不碰任何文件**。
 *   · `md:merge:run`  —— 执行：先用 plan 算出与干跑一致的结果，再真正搬文件。
 *
 * 请求不做业务判断（收口在 `merge-service` 的 `sanitizeMergeRequest`），
 * 这里只负责「调服务 + 用 `business` 包成统一返回」。
 */

import { ipcMain } from 'electron'
import { CH } from '@shared/channels'
import type { MergePlanResult, MergeRunResult } from '@shared/types'
import { planMerge, runMerge } from '../services/merge-service'
import { business } from './result'

export function registerMergeIpc(): void {
  ipcMain.handle(CH.MERGE_PLAN, (_e, raw: unknown) =>
    business<MergePlanResult>(() => planMerge(raw)),
  )

  ipcMain.handle(CH.MERGE_RUN, (_e, raw: unknown) =>
    business<MergeRunResult>(() => runMerge(raw)),
  )
}
