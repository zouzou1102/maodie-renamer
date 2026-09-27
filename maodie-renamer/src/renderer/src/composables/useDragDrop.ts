/**
 * 拖拽入列（IX-022 / IX-023 / IX-024）。
 *
 * ★ 实现要点（交互文档 §IX-022 明确写在文档里的那一条）：
 * `dragenter` 会因**嵌套元素**而重复触发，所以必须**计数**；
 * 只有 `dragleave` 把计数减到 0 才隐藏蒙层；`drop` 后**必须把计数重置为 0**。
 * 不这么做就会出现「蒙层闪一下就消失」或「蒙层永远不消失」。
 */

import { computed, onUnmounted, ref } from 'vue'

export interface DragDropOptions {
  onPaths: (paths: string[]) => void
}

/**
 * 从 DataTransfer 里挑出真正的文件系统路径。
 *
 * ★ 2026-09-25 修正：不再读 `file.path`。
 *   `File.path` 是 Electron 的非标准扩展，**Electron 32.0 已移除**，
 *   替代品是 `webUtils.getPathForFile`（只有预加载进程拿得到 electron 模块，
 *   所以由 `window.maodie.fs.pathForFile` 代劳）。
 *   改之前这里恒返回 `undefined` → 拖进来的文件一条都入不了列，界面却毫无报错。
 *
 * 目录在 Windows 上也走 'Files'，与文件同一条路。
 */
function extractPaths(dt: DataTransfer | null): string[] {
  if (!dt) return []
  const out: string[] = []
  const push = (p: string): void => {
    if (p !== '' && !out.includes(p)) out.push(p)
  }
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file) push(window.maodie.fs.pathForFile(file))
  }
  if (out.length > 0) return out
  // 兜底：某些环境只有 files
  for (const file of Array.from(dt.files ?? [])) {
    push(window.maodie.fs.pathForFile(file))
  }
  return out
}

/** 拖入的内容里有没有「文件系统对象」——没有就是网页链接 / 纯文本（EX-08）*/
function hasFileSystemObject(dt: DataTransfer | null): boolean {
  const types = Array.from(dt?.types ?? [])
  return types.includes('Files')
}

export function useDragDrop(options: DragDropOptions) {
  const depth = ref(0)
  const dragging = ref(false)
  const rejected = ref(false)
  const lastCount = ref(0)

  const visible = computed(() => dragging.value)

  function onDragEnter(e: DragEvent): void {
    e.preventDefault()
    depth.value++
    rejected.value = !hasFileSystemObject(e.dataTransfer)
    dragging.value = true
  }

  function onDragOver(e: DragEvent): void {
    // 必须 preventDefault，否则浏览器不会触发 drop
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = hasFileSystemObject(e.dataTransfer) ? 'copy' : 'none'
    rejected.value = !hasFileSystemObject(e.dataTransfer)
  }

  function onDragLeave(e: DragEvent): void {
    e.preventDefault()
    depth.value = Math.max(0, depth.value - 1)
    if (depth.value === 0) {
      dragging.value = false
      rejected.value = false
    }
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault()
    // ★ 必须重置计数，否则嵌套元素留下的计数会让蒙层再也关不掉
    depth.value = 0
    dragging.value = false
    const wasRejected = !hasFileSystemObject(e.dataTransfer)
    rejected.value = false

    const paths = extractPaths(e.dataTransfer)
    if (wasRejected || paths.length === 0) {
      // EX-08：拖入网页链接 / 纯文本 → 不接收
      options.onPaths([])
      return
    }
    lastCount.value = paths.length
    options.onPaths(paths)
  }

  onUnmounted(() => {
    depth.value = 0
    dragging.value = false
  })

  return { dragging, visible, rejected, lastCount, onDragEnter, onDragOver, onDragLeave, onDrop }
}
