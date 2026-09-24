/**
 * md:extract:* —— 文件提取（P3-8 / 第 8 批，业务通道，选法 B）。
 *
 * 两个通道：
 *   · `md:extract:plan` —— 干跑：算筛选命中 + 落点计划，**不碰任何文件**。
 *   · `md:extract:run`  —— 执行：先复用 plan 的命中集，再调 P3-7 运输层真正搬文件。
 *
 * 请求不做业务判断（收口在 `extract-service` 的 `sanitizeExtractRequest`），
 * 这里只负责「调服务 + 用 `business` 包成统一返回」（与 merge.ipc 同款）。
 */

import { ipcMain } from 'electron'
import { CH } from '@shared/channels'
import type { ExtractPlanResult, ExtractRunResult } from '@shared/types'
import { planExtract, runExtract } from '../services/extract-service'
import { business } from './result'

export function registerExtractIpc(): void {
  ipcMain.handle(CH.EXTRACT_PLAN, (_e, raw: unknown) =>
    business<ExtractPlanResult>(() => planExtract(raw)),
  )

  ipcMain.handle(CH.EXTRACT_RUN, (_e, raw: unknown) =>
    business<ExtractRunResult>(() => runExtract(raw)),
  )
}
