/**
 * md:rename:* —— 改名执行与取消（业务通道）。
 *
 * 进度事件用 `webContents.send` 推送，节流由执行器负责（每 50 项 / 每 100ms）。
 * 10000 项若每项推一次就是 10000 次 IPC + 10000 次 Vue 更新，界面必然卡死。
 */

import { ipcMain } from 'electron'
import { CH } from '@shared/channels'
import { MD_ERROR, MdError } from '@shared/errors'
import { sanitizeAttrs, sanitizeRule } from '@shared/sanitize-rule'
import type { ExecuteRequest } from '@shared/types'
import { cancelRenameTask, runRenameTask } from '../services/rename-service'
import { getMainWindow } from '../window'
import { business } from './result'

/* P3-1：`sanitizeRule` 本体已挪到 `@shared/sanitize-rule.ts`。
   它是纯函数，而住在 main/ 里时 `node --test` 根本 import 不动这个模块
   （顶层 `import { ipcMain } from 'electron'`），于是本项目**最容易出错的一处**
   反而一条单测都写不了。挪到共享层后 `tests/p3-1-seq.test.ts` 能直接盯住它，
   用的是「喂进去 → 取出来」这种最直接的形状。
   它的钳制范围必须与 `stores/rule.ts` 的 `clamp()` **完全一致**。 */

function sanitizeExecute(raw: unknown): ExecuteRequest {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const items = Array.isArray(src.items) ? src.items : []

  return {
    taskId: typeof src.taskId === 'string' && src.taskId !== '' ? src.taskId : `task-${Date.now()}`,
    items: items
      .filter((it): it is Record<string, unknown> => typeof it === 'object' && it !== null)
      .map((it, i) => ({
        id: typeof it.id === 'string' ? it.id : `id-${i}`,
        dirPath: typeof it.dirPath === 'string' ? it.dirPath : '',
        fromName: typeof it.fromName === 'string' ? it.fromName : '',
        isDir: it.isDir === true,
        // ★ P3-3：属性也要收口 —— 漏了就是「预览对、执行错」
        attrs: sanitizeAttrs(it.attrs),
      }))
      // 目录与名称是必需项；缺一个就直接拒绝，绝不猜
      .filter((it) => it.dirPath !== '' && it.fromName !== ''),
    rule: sanitizeRule(src.rule),
    date: typeof src.date === 'string' ? src.date : '',
    autoResolveConflict: src.autoResolveConflict === true,
  }
}

export function registerRenameIpc(): void {
  ipcMain.handle(CH.RENAME_EXECUTE, (_e, raw: unknown) =>
    business(async () => {
      const req = sanitizeExecute(raw)
      if (req.items.length === 0) throw new MdError(MD_ERROR.E_LIST_EMPTY)
      return runRenameTask(req, (progress) => {
        getMainWindow()?.webContents.send(CH.EV_RENAME_PROGRESS, progress)
      })
    }),
  )

  ipcMain.handle(CH.RENAME_CANCEL, (_e, raw: unknown) =>
    business(async () => {
      const taskId = (raw as { taskId?: unknown } | null)?.taskId
      if (typeof taskId !== 'string' || taskId === '') {
        throw new MdError(MD_ERROR.E_TASK_NOT_FOUND)
      }
      return cancelRenameTask(taskId)
    }),
  )
}
