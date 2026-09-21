/**
 * md:fs:* —— 文件系统与系统对话框。
 *
 * 关于 DEC-01 的实现保证：`md:fs:pickDirectory` **只返回用户在对话框里选中的那几个路径**，
 * 不做任何子项枚举 —— 递归能力从接口形状上就不存在（界面拿到的是一串路径）。
 *
 * 多选 ≠ 递归：选中 3 个文件夹，得到的是**这 3 个文件夹本身**，不是它们里面的东西。
 * 所以 `multiSelections` 与 DEC-01 不冲突。
 */

import { dirname } from 'node:path'
import { dialog, ipcMain } from 'electron'
import { CH } from '@shared/channels'
import { MD_ERROR, MdError } from '@shared/errors'
import { sanitizeExport } from '@shared/sanitize-export'
import type { ExportListResult, ResolvePathsRequest, ResolvedBatch } from '@shared/types'
import { exportList } from '../services/export-list'
import { resolvePaths } from '../services/fs-scan'
import { getMainWindow } from '../window'
import { business } from './result'

function sanitize(req: unknown): ResolvePathsRequest {
  const src = (typeof req === 'object' && req !== null ? req : {}) as Record<string, unknown>
  const asArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  return { paths: asArray(src.paths), existingPaths: asArray(src.existingPaths) }
}

export function registerFsIpc(): void {
  ipcMain.handle(CH.FS_PICK_FILES, () =>
    business(async () => {
      const win = getMainWindow()
      if (!win) throw new MdError(MD_ERROR.E_UNKNOWN, '窗口不存在')
      const r = await dialog.showOpenDialog(win, {
        title: '选择要改名的文件',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '所有文件', extensions: ['*'] }],
      })
      return { canceled: r.canceled, paths: r.filePaths }
    }),
  )

  /**
   * 上次选过文件夹的那一层目录。
   * 只活在本次运行里（不落盘 —— 为这点小事动 prefs 的 schema 不值得）。
   * 用途：批量连续添加时，不用每次从「此电脑」一路点回去。
   */
  let lastDir: string | undefined

  ipcMain.handle(CH.FS_PICK_DIRECTORY, () =>
    business(async () => {
      const win = getMainWindow()
      if (!win) throw new MdError(MD_ERROR.E_UNKNOWN, '窗口不存在')
      const r = await dialog.showOpenDialog(win, {
        title: '选择要改名的文件夹（可多选）',
        // ★ multiSelections 只是「一次能选中几个」，仍然绝无递归 / 展开相关的属性（DEC-01）
        properties: ['openDirectory', 'multiSelections'],
        // 打开时的落点：上次那批的**父目录**（传父目录才会停在那层看得到它们）
        ...(lastDir === undefined ? {} : { defaultPath: lastDir }),
      })
      if (!r.canceled && r.filePaths.length > 0) {
        lastDir = dirname(r.filePaths[r.filePaths.length - 1])
      }
      return { canceled: r.canceled, paths: r.filePaths }
    }),
  )

  ipcMain.handle(CH.FS_RESOLVE_PATHS, (_e, req: unknown) =>
    business<ResolvedBatch>(() => resolvePaths(sanitize(req))),
  )

  /**
   * ★ P3-2（DEC-17）：导出文件名清单 —— 本批**唯一**新增的通道。
   *
   * 为什么非得破例开通道：「另存为」对话框只能在主进程调，落盘也必须在主进程
   * （渲染层没有 fs 能力）。两者绑在一起，无法复用任何既有通道。
   *
   * 注意这里**只做一次收口**（`sanitizeExport`）、不写业务逻辑 ——
   * 表头文案与列的取舍全在渲染层完成（`shared/export-rows.ts`），
   * 主进程不认识「序号 / 原名 / 新名」这些词。
   */
  ipcMain.handle(CH.FS_EXPORT_LIST, (_e, req: unknown) =>
    business<ExportListResult>(() => exportList(sanitizeExport(req))),
  )
}
