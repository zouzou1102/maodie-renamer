/**
 * 导出清单落盘（`md:fs:exportList`）。P3-2 / 第 2 批。
 *
 * ── 三条落盘安全底线（设计 §1.3，本批的硬规矩）───────────────────────
 * 1. **一律走系统「另存为」对话框**，由用户亲手指定路径 —— 程序绝不自己猜路径。
 * 2. **绝不默认写到列表里那些文件所在的目录**。用户拖进来的多半是素材目录，
 *    凭空多一个清单文件就是污染。所以 `defaultPath` **只给文件名、不给目录**，
 *    落点交给 Windows 自己记住的「上次保存位置」。
 * 3. **绝不静默覆盖**：用户在对话框里选了已存在的文件时，**由系统对话框
 *    自己的「是否替换」去问**（`showSaveDialog` 的原生行为）。用户点「否」
 *    时对话框不会返回，所以走到我们这里的路径**必定是用户确认过的** ——
 *    我们既不需要、也不应该再做一层覆盖询问，更不能做静默覆盖。
 *
 * ── 与 `F16`「绝不覆盖」的关系 ────────────────────────────────────────
 * 这是同一条底线的延伸：**凡是要往硬盘上写东西，决定权必须在用户手里。**
 * 改名那条线是「冲突默认跳过」，导出这条线是「落点与覆盖都问对话框」。
 *
 * ── 本批**不碰**列表里任何文件 ───────────────────────────────────────
 * 只读内存里的表格、只写一个**新文件**。没有 rename / unlink / 移动。
 */

import { open, rename, unlink, type FileHandle } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { dialog } from 'electron'
import { MD_ERROR, MdError } from '@shared/errors'
import { buildExportContent } from '@shared/export-format'
import type { ExportFormat, ExportListRequest, ExportListResult } from '@shared/types'
import { getMainWindow } from '../window'

const FILTERS: Record<ExportFormat, { name: string; extensions: string[] }> = {
  xlsx: { name: 'Excel 工作簿', extensions: ['xlsx'] },
  txt: { name: '文本文件', extensions: ['txt'] },
  csv: { name: 'CSV 文件', extensions: ['csv'] },
  docx: { name: 'Word 文档', extensions: ['docx'] },
}

/**
 * 临时文件名。与 `storage.ts` 的 `tmpPathFor` 同一形态（带 pid + 时间戳）：
 * 固定名在异常退出后会残留，下次写入可能读到上次的残留内容。
 */
function tmpPathFor(file: string): string {
  return join(dirname(file), `.${basename(file)}.tmp-${process.pid}-${Date.now()}`)
}

/**
 * 原子写字节。
 *
 * 与 `storage.ts` 的 `writeJsonAtomic` **同一套做法**（写临时文件 → `fsync` →
 * 改名），但不复用它 —— 那个函数内部写死了 `JSON.stringify`，只能写 JSON。
 *
 * ★ 「不产出半个文件」是这里的存在理由：写盘失败（磁盘满 / 权限 / 被占用）时，
 *   用户看到的应当是**什么都没产生**，而不是一个能打开、内容却截断到一半的清单。
 */
async function writeBytesAtomic(file: string, bytes: Uint8Array): Promise<void> {
  const tmp = tmpPathFor(file)

  let fh: FileHandle | undefined
  try {
    fh = await open(tmp, 'w')
    await fh.writeFile(bytes)
    await fh.sync() // 确保数据真正落盘，而不是留在操作系统写缓存里
  } catch (err) {
    await fh?.close().catch(() => {})
    await unlink(tmp).catch(() => {})
    throw err
  }

  await fh.close()
  try {
    // ★ rename 会覆盖已存在的目标 —— 这正是我们要的：能走到这里，
    //   说明用户已经在系统对话框里确认过「替换」（底线第 3 条）。
    await rename(tmp, file)
  } catch (err) {
    await unlink(tmp).catch(() => {})
    throw err
  }
}

/** 写盘失败 → 复用既有错误码，不新增 `EX`（设计 §8）*/
function mapWriteError(err: unknown): MdError {
  const code = (err as NodeJS.ErrnoException)?.code
  if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY' || code === 'EROFS') {
    return new MdError(MD_ERROR.E_PERM, String(code))
  }
  return new MdError(MD_ERROR.E_UNKNOWN, String(code ?? err))
}

export async function exportList(req: ExportListRequest): Promise<ExportListResult> {
  // ① 空清单直接拒绝 —— **绝不产出一个 0 行的文件**（设计 §4 第 1 行）。
  //    界面上按钮本来就置灰，走不到这里；但被绕过（CLI / 直调）时必须挡住。
  if (req.header.length === 0 || req.rows.length === 0) {
    throw new MdError(MD_ERROR.E_LIST_EMPTY)
  }

  const win = getMainWindow()
  if (!win) throw new MdError(MD_ERROR.E_UNKNOWN, '窗口不存在')

  // ② 内容先在内存里生成好，**再**开对话框 ——
  //    万一是生成环节出错，用户不会先辛辛苦苦选完路径、才被告知「失败了」。
  const bytes = buildExportContent(req.format, [req.header, ...req.rows])

  /**
   * ★ 测试专用后门：冒烟脚本**无法操作系统原生「另存为」对话框**
   *   （它不是网页 DOM，Electron 的 sendInputEvent 点不到它）。
   *   不给个落点的话，「生成 → 写盘」这一段**真实代码在冒烟里永远走不到**，
   *   等于本批的核心功能从未被端到端验过。
   *
   *   `SMOKE_EXPORT_PATH` 由 `tools/smoke.js` 在启动前注入。
   *   生产环境不会设这个变量 —— 等价于这段分支不存在，不影响任何真实行为。
   *   与既有的 `process.env.APP_DATA_DIR`（数据目录注入）是同一类做法。
   */
  const injected = process.env.SMOKE_EXPORT_PATH
  let filePath: string
  if (injected !== undefined && injected !== '') {
    filePath = injected
  } else {
    const r = await dialog.showSaveDialog(win, {
      title: '保存文件名清单',
      // ★ 只有文件名，不带目录（底线第 2 条）
      defaultPath: req.suggestedName,
      filters: [FILTERS[req.format]],
    })

    // ③ 取消不是失败：静默返回，不报错、不提示、不留残留文件（设计 §4 第 3 行）
    if (r.canceled || !r.filePath) return { canceled: true, filePath: '' }
    filePath = r.filePath
  }

  try {
    await writeBytesAtomic(filePath, bytes)
  } catch (err) {
    throw mapWriteError(err)
  }

  return { canceled: false, filePath }
}
