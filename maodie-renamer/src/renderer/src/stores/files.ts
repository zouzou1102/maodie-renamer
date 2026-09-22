/**
 * 列表与预览 store（技术方案 §4.3.2）。
 *
 * ── 两条关键设计 ────────────────────────────────────────────────────
 * 1. **`snapshot` 与列表同生命周期**：放这里，不单独开 store，
 *    避免出现「列表清了、快照还在」的不一致。
 * 2. **过期结果丢弃**：只接受 `reqId` 等于「最新发出的 reqId」的响应。
 *    这是防「用户快速连着改了 5 次，第 2 次的结果后到，覆盖了第 5 次」的经典竞态。
 *
 * ── 依赖方向 ────────────────────────────────────────────────────────
 * files → rule（读规则）、files → task/cat（通知入列结果）
 * rule 不 import files：规则的变更由本 store 内的 `watch` 捕获。
 */

import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { PREVIEW_DEBOUNCE_MS, VIRTUAL_LIST_THRESHOLD } from '@shared/constants'
import { normalizeForCompare } from '@shared/path-utils'
import { toPreviewItemInputs } from '@shared/preview'
import type { FileItem, PreviewItemInput, PreviewStats } from '@shared/types'
import { createPreviewRunner } from '../preview-runner'
import { useCatStore } from './cat'
import { useRuleStore } from './rule'

/** 入列后在状态栏显示 3 秒的临时提示 */
export interface TransientMessage {
  text: string
  at: number
}

/** addPaths 的返回：入列了多少、以及要提示什么 */
export interface AddPathsResult {
  accepted: number
  messages: string[]
}

export const useFilesStore = defineStore('files', () => {
  const items = ref<FileItem[]>([])
  const snapshot = ref<Record<string, string[]>>({})
  const previewPending = ref(false)
  const lastElapsedMs = ref(0)
  const stats = ref<PreviewStats>({ changed: 0, unchanged: 0, conflict: 0, invalid: 0 })
  /** 全选状态存在 id 集合里，**不依赖 DOM**（虚拟化下 DOM 里只有可视行）*/
  const selectedIds = ref<Set<string>>(new Set())
  const transient = ref<TransientMessage | null>(null)

  const runner = createPreviewRunner()
  let reqSeq = 0
  let latestReqId = 0
  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  /** 规则 store：既用来算预览，也用它暴露的 regexError 做门控（故先于 canExecute 声明）*/
  const ruleStore = useRuleStore()

  const total = computed(() => items.value.length)
  const canExecute = computed(
    () =>
      !previewPending.value &&
      // ★ 正则非法时不允许执行（设计 §3.3：复用 P0 的置灰机制，不新增交互）
      !ruleStore.regexError &&
      items.value.some((i) => i.status === 'changed' || i.status === 'conflict'),
  )
  const needsVirtualList = computed(() => items.value.length > VIRTUAL_LIST_THRESHOLD)
  const executableCount = computed(
    () => items.value.filter((i) => i.status === 'changed' || i.status === 'conflict').length,
  )
  const allSelected = computed(
    () => items.value.length > 0 && items.value.every((i) => selectedIds.value.has(i.id)),
  )

  /** 当前机器日期（YYYY-MM-DD，本地时区）—— DEC-03：日期取执行当天 */
  function todayString(d = new Date()): string {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }

  /** 200ms 防抖后重算全量预览（IX-050）*/
  function requestPreview(): void {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => void runPreview(), PREVIEW_DEBOUNCE_MS)
  }

  async function runPreview(): Promise<void> {
    debounceTimer = undefined
    // ★ 正则非法时**不重算**：保留上一次的合法结果（设计 §3.3），
    //   否则会把列表刷成一片「无变化」，既闪动又误导用户。
    if (ruleStore.regexError) return
    // ★ 压成预览请求的形状 —— 嵌套对象在 `toPreviewItemInputs` 里摊平成普通对象。
    //   ⚠️ 千万别在这里手写一遍：漏了摊平就会让 Worker 每次 `DataCloneError` 静默退化
    //   （P3-3 引入 `attrs` 时埋下、P3-4 加 `override` 时继续，2026-09-22 才抓到）。
    const req: PreviewItemInput[] = toPreviewItemInputs(items.value)

    if (req.length === 0) {
      stats.value = { changed: 0, unchanged: 0, conflict: 0, invalid: 0 }
      lastElapsedMs.value = 0
      return
    }

    previewPending.value = true
    const reqId = ++reqSeq
    latestReqId = reqId

    const res = await runner.run({
      reqId,
      items: req,
      rule: JSON.parse(JSON.stringify(ruleStore.rule)),
      date: todayString(),
      autoResolveConflict: ruleStore.rule.autoResolveConflict,
      // ★ 必须传「普通对象」：snapshot.value 是 Vue 响应式代理，postMessage 的
      //   结构化克隆无法克隆 Proxy（会同步抛 DataCloneError）。一旦抛出，这次预览
      //   就永远回不来，previewPending 卡在 true → 主按钮永久置灰、状态栏一直「计算中」。
      //   与上面的 rule 一样，过一遍 JSON 拿到纯数据。
      snapshot: JSON.parse(JSON.stringify(snapshot.value)) as Record<string, string[]>,
    })

    // ★ 过期结果直接丢弃
    if (res.reqId !== latestReqId) return

    const byId = new Map(res.items.map((o) => [o.id, o]))
    for (const item of items.value) {
      const out = byId.get(item.id)
      if (!out) continue
      item.newStem = out.newStem
      item.newName = out.newName
      item.status = out.status
      item.conflictKind = out.conflictKind
      item.reason = out.reason
      item.reasonCode = out.reasonCode
      item.diffRange = out.diffRange
      item.resolvedName = out.resolvedName
    }
    stats.value = res.stats
    lastElapsedMs.value = res.elapsedMs
    previewPending.value = false
  }

  /* ── 入列 ────────────────────────────────────────────────────────── */

  async function addPaths(paths: string[]): Promise<AddPathsResult> {
    if (paths.length === 0) return { accepted: 0, messages: [] }

    const res = await window.maodie.fs.resolvePaths({
      paths,
      existingPaths: items.value.map((i) => i.fullPath),
    })
    if (!res.ok) return { accepted: 0, messages: [] }

    const batch = res.data
    if (batch.items.length > 0) {
      // 新项追加到末尾，保持原顺序（PRD §4.1.2）
      items.value = [...items.value, ...batch.items]
      // 合并目录快照：新快照覆盖同名目录，其余保留
      snapshot.value = { ...snapshot.value, ...batch.snapshot }
      requestPreview()
    }

    const messages: string[] = []
    if (batch.stats.ignoredDuplicates > 0) messages.push(`已忽略 ${batch.stats.ignoredDuplicates} 个重复项`)
    if (batch.stats.overflow > 0) messages.push('单批最多 1 万个，超出部分未加入')
    if (batch.stats.rejected > 0) messages.push('只能拖入文件或文件夹哦')
    if (batch.stats.vanished > 0) messages.push(`有 ${batch.stats.vanished} 个文件找不到了，已跳过`)

    if (batch.stats.rejected > 0) {
      showTransient('只能拖入文件或文件夹哦')
    } else if (messages.length > 0) {
      // 多项同时命中时依次追加，最多显示 2 条（避免状态栏溢出）
      showTransient(messages.slice(0, 2).join(' · '))
    }

    if (batch.items.length > 0) {
      useCatStore().trigger('ST-02', { n: batch.items.length })
    }

    return { accepted: batch.items.length, messages }
  }

  function showTransient(text: string): void {
    transient.value = { text, at: Date.now() }
    setTimeout(() => {
      if (transient.value && Date.now() - transient.value.at >= 2900) transient.value = null
    }, 3000)
  }

  /* ── 移除 / 清空 ─────────────────────────────────────────────────── */

  function removeItem(id: string): void {
    // ★ 必须按 id 而不是 DOM 索引 —— 虚拟滚动会让「第 3 行」在滚动后变成别的文件
    items.value = items.value.filter((i) => i.id !== id)
    selectedIds.value.delete(id)
    requestPreview()
  }

  function clear(): void {
    items.value = []
    selectedIds.value = new Set()
    snapshot.value = {}
    stats.value = { changed: 0, unchanged: 0, conflict: 0, invalid: 0 }
    useCatStore().backToIdle()
    requestPreview()
  }

  /* ── 选择 ────────────────────────────────────────────────────────── */

  function toggleSelect(id: string): void {
    const next = new Set(selectedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds.value = next
  }

  function toggleSelectAll(): void {
    selectedIds.value = allSelected.value ? new Set() : new Set(items.value.map((i) => i.id))
  }

  /* ── 与执行结果的联动 ───────────────────────────────────────────── */

  /** 撤销后：把仍在列表里的文件名字同步改回去，并重算预览 */
  function applyRenamedBack(entries: Array<{ dirPath: string; fromName: string; toName: string }>): void {
    let touched = false
    for (const e of entries) {
      const target = items.value.find(
        (i) => normalizeForCompare(i.dirPath) === normalizeForCompare(e.dirPath) && i.name === e.toName,
      )
      if (target) {
        target.name = e.fromName
        const dot = e.fromName.lastIndexOf('.')
        const isDir = target.isDir
        target.stem = isDir || dot <= 0 ? e.fromName : e.fromName.slice(0, dot)
        target.ext = isDir || dot <= 0 ? '' : e.fromName.slice(dot)
        target.fullPath = `${e.dirPath}\\${e.fromName}`
        target.status = 'pending'
        touched = true
      }
    }
    if (touched) requestPreview()
  }

  /** 执行成功后：列表中的项已被改名，同步名字（否则用户会看到过期的旧名）*/
  function applyRenamed(entries: Array<{ dirPath: string; fromName: string; toName: string }>): void {
    let touched = false
    for (const e of entries) {
      const target = items.value.find(
        (i) => normalizeForCompare(i.dirPath) === normalizeForCompare(e.dirPath) && i.name === e.fromName,
      )
      if (target) {
        target.name = e.toName
        const isDir = target.isDir
        const dot = e.toName.lastIndexOf('.')
        target.stem = isDir || dot <= 0 ? e.toName : e.toName.slice(0, dot)
        target.ext = isDir || dot <= 0 ? '' : e.toName.slice(dot)
        target.fullPath = `${e.dirPath}\\${e.toName}`
        touched = true
      }
    }
    if (touched) requestPreview()
  }

  /* ── 导入表格（P3-4 / 第 4 批）─────────────────────────────────── */

  /**
   * 把表里的对应关系装到列表项上。
   *
   * ★ 只动 `override`，**不动** `status` / `newName` —— 那些仍然由预览算。
   *   导入不是「另开一条路」，只是换了个「名字从哪来」，所以合法性校验、
   *   冲突检测、预览 ≡ 执行这条线一点都没被绕开。
   *
   * @returns 实际装上去的项数（弹窗与状态栏用它报数）
   */
  function applyImport(list: Array<{ id: string; stem: string }>, sourceTable: string): number {
    if (list.length === 0) return 0
    const stemById = new Map(list.map((a) => [a.id, a.stem]))
    let count = 0
    for (const item of items.value) {
      const stem = stemById.get(item.id)
      if (stem === undefined) continue
      item.override = { stem, sourceTable }
      count++
    }
    if (count > 0) requestPreview()
    return count
  }

  /**
   * 「清除导入」：去掉全部 `override`，那些项**立刻回到按规则算**。
   *
   * ⚠️ 只清「名字的来源」，**列表里的文件一个都不删** —— 所以不需要二次确认
   *   （与「清空列表」是完全不同的两件事）。
   */
  function clearOverride(): number {
    let count = 0
    for (const item of items.value) {
      if (item.override !== undefined) {
        item.override = undefined
        count++
      }
    }
    if (count > 0) requestPreview()
    return count
  }

  /** 当前有多少项的名字来自表格（规则区顶部那条提示用它）*/
  const overrideCount = computed(() => items.value.filter((i) => i.override !== undefined).length)

  /** 来源表格的显示名（同一时刻只会导入一张表，取第一项即可）*/
  const overrideSource = computed(
    () => items.value.find((i) => i.override !== undefined)?.override?.sourceTable ?? '',
  )

  /* ── 监听规则变化 → 自动重算预览 ────────────────────────────────── */

  watch(() => ruleStore.rule, () => requestPreview(), { deep: true })

  function dispose(): void {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer)
    runner.dispose()
  }

  return {
    items,
    snapshot,
    previewPending,
    lastElapsedMs,
    stats,
    selectedIds,
    transient,
    total,
    canExecute,
    needsVirtualList,
    executableCount,
    allSelected,
    usingWorker: computed(() => runner.usingWorker),
    addPaths,
    removeItem,
    clear,
    toggleSelect,
    toggleSelectAll,
    requestPreview,
    runPreview,
    applyRenamed,
    applyRenamedBack,
    applyImport,
    clearOverride,
    overrideCount,
    overrideSource,
    showTransient,
    dispose,
  }
})
