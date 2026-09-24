/**
 * 递归摊平 walker（P3-7 / 第 7 批 · 设计 §1.2 / §5③）。
 *
 * ★ 本项目**第一次主动写递归**（之前 `fs-scan` 是「一项对一项」，绝不递归）。
 *   所以 DEC-01 护栏在这里**显式化**：`symlink` / `junction` / 挂载点**不递归**，
 *   否则会死循环或把 `C:\Windows` 整块复制进来。
 *
 * 护栏（DEC-25）：
 *   · 深度上限 `FLATTEN_MAX_DEPTH`（20）—— junction 环的兜底，到顶必停。
 *   · 文件数上限 `FLATTEN_MAX_FILES`（1 万）—— 超限直接整体拒绝（EX-19）。
 *
 * 复用现有能力：`splitName` 取扩展名、`ymdFromMs` 取本地日期、`path-utils` 归一化。
 */

import { promises as fs } from 'node:fs'
import { basename, resolve } from 'node:path'
import { FLATTEN_MAX_DEPTH, FLATTEN_MAX_FILES } from '@shared/constants'
import { splitName } from '@shared/name-split'
import { ymdFromMs } from '@shared/today'
import { normalizeSeparators, stripTrailingSep } from '@shared/path-utils'
import { errorText, MD_ERROR, type MdErrorCode } from '@shared/errors'
import type { MergeSourceItem } from '@shared/merge-plan'

export interface WalkResult {
  /** 摊平后的实际文件清单（文件夹展开成文件；不递归的文件夹自身作为 item）*/
  files: MergeSourceItem[]
  /** 超限等结构化错误（有它时 files 为空）*/
  error?: { code: MdErrorCode; reason: string }
}

export async function walkSources(sourcePaths: string[], recurse: boolean): Promise<WalkResult> {
  const files: MergeSourceItem[] = []
  /** 超限后整体拒绝：一旦置位，后续递归直接返回 */
  let overflow: { code: MdErrorCode; reason: string } | undefined

  async function walkOne(fullPath: string, depth: number): Promise<void> {
    if (overflow) return
    let st
    try {
      // ★ lstat 而非 stat：绝不 realpath 解引用（与 `fs-scan` 同一条纪律）
      st = await fs.lstat(fullPath)
    } catch {
      // 路径已消失 / 读不出 → 这一项跳过，不中断整批（设计 §4 边界 11）
      return
    }

    const isSymlink = st.isSymbolicLink()
    const isDir = st.isDirectory()
    const name = basename(normalizeSeparators(fullPath))
    const { ext } = splitName(name, isDir)
    const item: MergeSourceItem = {
      srcPath: stripTrailingSep(normalizeSeparators(resolve(fullPath))),
      name,
      ext,
      created: ymdFromMs(st.birthtimeMs),
      modified: ymdFromMs(st.mtimeMs),
      isDir,
    }

    // ★ 普通目录：递归摊平（受深度上限约束）
    if (isDir && !isSymlink) {
      if (recurse && depth < FLATTEN_MAX_DEPTH) {
        let entries: string[] = []
        try {
          entries = await fs.readdir(fullPath)
        } catch {
          entries = []
        }
        for (const e of entries) {
          if (overflow) return
          await walkOne(resolve(fullPath, e), depth + 1)
        }
        return
      }
      // 不递归（recurse 关，或已到深度上限）→ 文件夹**本身**作为一个 item
      files.push(item)
      checkOverflow()
      return
    }

    // 文件，或 symlink / junction（文件或目录链接）→ 作为 item。
    // ★ 关键：symlink / junction **绝不递归**（DEC-01），但链接自身可以复制走。
    files.push(item)
    checkOverflow()
  }

  function checkOverflow(): void {
    if (files.length > FLATTEN_MAX_FILES && !overflow) {
      overflow = {
        code: MD_ERROR.E_FLATTEN_OVERFLOW,
        reason: errorText(MD_ERROR.E_FLATTEN_OVERFLOW, FLATTEN_MAX_FILES),
      }
    }
  }

  for (const p of sourcePaths) {
    if (overflow) break
    await walkOne(p, 0)
  }

  if (overflow) return { files: [], error: overflow }
  return { files }
}
