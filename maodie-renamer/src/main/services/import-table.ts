/**
 * 导入表格（`md:fs:importTable`）。P3-4 / 第 4 批。
 *
 * ── 这一层只做三件事 ─────────────────────────────────────────────────
 * ① 让用户选文件（系统「打开」对话框）；② 把字节读进来；③ 按扩展名分派给
 * `shared/` 里的**纯解析器**。
 * 「认出哪一列是原名 / 哪一行配哪个文件」全在 `shared/table-map.ts` —— 主进程
 * 不认识「原文件名」「新文件名」这些词，也就不可能和渲染层的理解跑偏。
 *
 * ── 为什么解析器放 `shared/` ─────────────────────────────────────────
 * 它们是纯函数、零 IO，放 `shared/` 才能用 `node --test` 直接跑（主进程目录的
 * 代码只能靠冒烟验）。本文件是唯一碰 `fs` / `dialog` 的地方。
 *
 * ── 只读，绝不写 ─────────────────────────────────────────────────────
 * 不 rename、不 unlink、不写任何文件。用户选中的表**原样读走**，不动一个字节。
 */

import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { dialog } from 'electron'
import { MD_ERROR, MdError } from '@shared/errors'
import { readDelimitedTable } from '@shared/table-map'
import type { ImportTableResult } from '@shared/types'
import { readXlsx } from '@shared/xlsx-read'
import { getMainWindow } from '../window'

const FILTERS = [
  { name: '表格文件（Excel / CSV / 文本）', extensions: ['xlsx', 'csv', 'txt'] },
  { name: 'Excel 工作簿', extensions: ['xlsx'] },
  { name: 'CSV 文件', extensions: ['csv'] },
  { name: '文本文件', extensions: ['txt'] },
]

export async function importTable(): Promise<ImportTableResult> {
  const win = getMainWindow()
  if (!win) throw new MdError(MD_ERROR.E_UNKNOWN, '窗口不存在')

  /**
   * ★ 测试专用后门：冒烟脚本**无法操作系统原生「打开」对话框**（不是网页 DOM，
   *   `sendInputEvent` 点不到）。没有它，「选文件 → 读字节 → 解析 → 对照表」这条
   *   真实链路在冒烟里永远走不到，等于本批核心功能从未被端到端验过。
   *   与 P3-2 的 `SMOKE_EXPORT_PATH`、以及更早的 `APP_DATA_DIR` 是同一类做法：
   *   生产环境不会设这个变量，等价于这段分支不存在。
   */
  const injected = process.env.SMOKE_IMPORT_PATH
  let filePath: string
  if (injected !== undefined && injected !== '') {
    filePath = injected
  } else {
    const r = await dialog.showOpenDialog(win, {
      title: '选择要导入的表格',
      properties: ['openFile'],
      filters: FILTERS,
    })
    // 取消不是失败：静默返回，不报错、不提示（与导出的「另存为」同一条纪律）
    if (r.canceled || r.filePaths.length === 0) {
      return { canceled: true, fileName: '', table: null }
    }
    filePath = r.filePaths[0]
  }

  const ext = extname(filePath).toLowerCase()

  /**
   * 只支持这三种，其余**明确拒绝并说清怎么办**（设计 §3.1）。
   * 尤其是老 `.xls`：它是二进制 OLE 容器，与 `.xlsx` 毫无关系 ——
   * 与其写一个没人验过的解析器，不如直接告诉用户「请另存为 .xlsx」。
   */
  if (ext === '.xls') {
    throw new MdError(
      MD_ERROR.E_TABLE_UNREADABLE,
      '这是老版的 .xls 格式，请在 Excel 里「另存为 .xlsx」之后再导入',
    )
  }
  if (ext === '.docx') {
    throw new MdError(
      MD_ERROR.E_TABLE_UNREADABLE,
      '不支持 Word 文档（导出的 Word 是给人打印看的，机器读回来没有意义）',
    )
  }
  if (ext !== '.xlsx' && ext !== '.csv' && ext !== '.txt') {
    throw new MdError(
      MD_ERROR.E_TABLE_UNREADABLE,
      `不支持的文件类型（${ext === '' ? '没有扩展名' : ext}），只支持 .xlsx / .csv / .txt`,
    )
  }

  let bytes: Uint8Array
  try {
    bytes = await readFile(filePath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY') {
      throw new MdError(MD_ERROR.E_PERM, String(code))
    }
    throw new MdError(MD_ERROR.E_TABLE_UNREADABLE, `读文件失败：${String(code ?? err)}`)
  }

  // ★ deflate 解压在这里**注入**进去：`shared/` 不能 import `node:zlib`
  //   （那会破坏「预览 ≡ 执行」的地基，也会让单测跑不起来）
  const table =
    ext === '.xlsx'
      ? readXlsx(bytes, { inflate: inflateRawSync })
      : readDelimitedTable(bytes, ext === '.csv' ? ',' : '\t')

  return { canceled: false, fileName: basename(filePath), table }
}
