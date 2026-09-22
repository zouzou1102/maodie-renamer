/**
 * 文件系统扫描服务（技术方案 §4.2.2 / 接口文档 §3.3）。
 *
 * 职责：把用户给的一堆「路径」变成可用的 `FileItem[]` + 目录快照。
 *
 * ── 符号链接处理政策（PRD 未覆盖，本方案定义）─────────────────────────
 *   · symlink **文件**：按普通文件处理（改名只改链接自身的名字，不影响目标）
 *   · symlink **文件夹** / junction / 挂载点：**不递归**，但**允许改名**
 *   · 一律**不做 `realpath` 解引用** —— 解引用会把「改链接名」变成
 *     「改目标名」，是危险行为
 *
 * 最后一条必须写进代码：这是「不递归」之外，第二个防止
 * 「C 盘分析脚本 junction 死循环」类事故的护栏。
 */

import { promises as fs } from 'node:fs'
import { basename, resolve } from 'node:path'
import { MAX_ITEMS_PER_BATCH, READDIR_CONCURRENCY } from '@shared/constants'
import { splitName } from '@shared/name-split'
import { dirKey, isAbsoluteWinPath, normalizeSeparators, stripTrailingSep } from '@shared/path-utils'
import { ymdFromMs } from '@shared/today'
/**
 * ★ P3-3：从 `lstat` / `stat` 结果里取出属性快照（**零额外磁盘 IO**）。
 *
 * ⚠️ 创建日期用 **`birthtime`** 而不是 `ctime`：`ctime` 是「元数据变更时间」，
 *    改名 / 改权限都会刷新它 —— 而**这个产品干的就是改名**。用错会让用户看到
 *    「上一次改名那一刻」，且**界面上毫无异常**（设计 §3.2）。
 *
 * ⚠️ 文件夹的 `sizeBytes` 给 **`null`**：`lstat().size` 对目录来说不代表里面内容的
 *    总和，要算总和得递归，而本项目的铁律是「**绝不递归**」（`DEC-01`）。
 *    `null`（不可用）与 `0`（真的空文件）**必须分开**（设计 §1.4）。
 */
function attrsOf(st: {
  birthtimeMs: number
  mtimeMs: number
  size: number
  isDirectory(): boolean
}): ItemAttrs {
  return {
    created: ymdFromMs(st.birthtimeMs),
    modified: ymdFromMs(st.mtimeMs),
    sizeBytes: st.isDirectory() ? null : st.size,
  }
}

import type { FileItem, ItemAttrs, ResolvePathsRequest, ResolvedBatch } from '@shared/types'

/** 并发执行一个映射（限流），保持输入顺序 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return out
}

/** 生成 FileItem 的 id */
function newId(): string {
  return globalThis.crypto.randomUUID()
}

export async function resolvePaths(req: ResolvePathsRequest): Promise<ResolvedBatch> {
  const stats = { accepted: 0, ignoredDuplicates: 0, overflow: 0, rejected: 0, vanished: 0 }

  /* 1. 过滤非文件系统对象（EX-08）─────────────────────────────────────
     拖入网页链接 / 纯文本时，浏览器给我们的是一段字符串。
     判据：必须是 Windows 绝对路径。这一条同时挡掉了 URL、相对路径与纯文本。 */
  const seen = new Set<string>()
  const acceptedPaths: string[] = []

  /* 2. 路径归一化 + 4. 与「已在列表的路径」去重（EX-09）────────────── */
  for (const p of req.existingPaths ?? []) {
    const k = normalizeForCompareSafe(p)
    if (k) seen.add(k)
  }

  for (const raw of req.paths ?? []) {
    if (typeof raw !== 'string' || !isAbsoluteWinPath(raw)) {
      stats.rejected++
      continue
    }
    // 统一分隔符 + 规范化 + 去末尾分隔符（不接受外部输入直接使用，必须先规范化）
    const normalized = stripTrailingSep(normalizeSeparators(resolve(raw)))
    const k = normalized.toLowerCase()
    if (seen.has(k)) {
      stats.ignoredDuplicates++
      continue
    }
    seen.add(k)
    acceptedPaths.push(normalized)
  }

  /* 3. 逐项 lstat 判类型 / 过滤已消失 ──────────────────────────────── */
  const probed = await mapLimit(acceptedPaths, 16, async (fullPath) => {
    try {
      const st = await fs.lstat(fullPath)
      if (st.isSymbolicLink()) {
        // ★ 只判断「链接指向什么」，绝不做 realpath 解引用
        const target = await fs.stat(fullPath).catch(() => null)
        if (target === null) return { fullPath, kind: 'vanished' as const }
        // P3-3：符号链接取**目标**的属性 —— 上一行已经 `stat` 过了，零额外 IO；
        //   而链接自身的 size 只是“目标路径的长度”，对用户没意义
        return {
          fullPath,
          kind: 'ok' as const,
          isDir: target.isDirectory(),
          isSymlink: true,
          attrs: attrsOf(target),
        }
      }
      return {
        fullPath,
        kind: 'ok' as const,
        isDir: st.isDirectory(),
        isSymlink: false,
        attrs: attrsOf(st),
      }
    } catch {
      return { fullPath, kind: 'vanished' as const }
    }
  })

  const items: FileItem[] = []
  const dirPaths = new Set<string>()

  /* 5. 上限裁剪（EX-13）────────────────────────────────────────────── */
  const room = Math.max(0, MAX_ITEMS_PER_BATCH - (req.existingPaths?.length ?? 0))

  for (const p of probed) {
    if (p.kind === 'vanished') {
      stats.vanished++
      continue
    }
    if (items.length >= room) {
      stats.overflow++
      continue
    }

    const dirPath = stripTrailingSep(normalizeSeparators(resolve(p.fullPath, '..')))
    const name = basename(normalizeSeparators(p.fullPath))
    // 7. 拆分名称（EX-07）—— 文件夹不拆分
    const { stem, ext } = splitName(name, p.isDir)

    items.push({
      id: newId(),
      fullPath: stripTrailingSep(normalizeSeparators(resolve(p.fullPath))),
      dirPath,
      name,
      stem,
      ext,
      isDir: p.isDir,
      isSymlink: p.isSymlink,
      // P3-3：入列那一刻的属性快照（之后不再刷新）
      attrs: p.attrs,
      newStem: stem,
      newName: name,
      status: 'pending',
    })
    dirPaths.add(dirPath)
    stats.accepted++
  }

  /* 6. 目录快照：去重后并发 readdir（跳错不中断）──────────────────── */
  const snapshot: Record<string, string[]> = {}
  const dirs = [...dirPaths]
  await mapLimit(dirs, READDIR_CONCURRENCY, async (dir) => {
    try {
      snapshot[dirKey(dir)] = await fs.readdir(dir)
    } catch {
      // 读不出来就当没有现存文件：真正的安全闸门在 safeRename
      snapshot[dirKey(dir)] = []
    }
  })

  return { items, snapshot, stats }
}

function normalizeForCompareSafe(p: string): string {
  if (typeof p !== 'string' || p.trim() === '') return ''
  return stripTrailingSep(normalizeSeparators(p)).toLowerCase()
}
