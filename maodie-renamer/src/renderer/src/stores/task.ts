/**
 * 执行任务与弹窗编排 store（技术方案 §4.3.2）。
 *
 * 它把「点开始改名」之后的全部分支收在一处（IX-060）：
 *   置灰 → 无动作；有冲突 → SCR-04；待改 ≥ 阈值 → SCR-05；否则直接执行
 *
 * 状态机的**唯一入口也在这里**：进度事件由本 store 接收，再由它调 cat.trigger()。
 * 理由（技术方案 §4.4.2）：让「谁能改形象」只有一处，避免多个监听器争抢状态。
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ExecuteItem, ExecuteResult, ProgressPayload, UndoAllResult, UndoResult } from '@shared/types'
import { useCatStore } from './cat'
import { useFilesStore } from './files'
import { useHistoryStore } from './history'
import { usePrefsStore } from './prefs'
import { useRuleStore } from './rule'
import { playFailure, playSuccess } from '../utils/sound'

export type ModalKind = 'none' | 'result' | 'conflict' | 'confirm' | 'settings' | 'cliGuide'

export type ConfirmKind = 'rename' | 'undoOne' | 'undoAll' | 'clear' | 'clearHistory'

export interface ConfirmContext {
  kind: ConfirmKind
  title: string
  body: string
  /** 确认后要执行的动作参数（撤销单条时是 taskId）*/
  taskId?: string
  /** 清空列表时的项数 */
  count?: number
  /** P2-C：危险操作（清空历史）用 danger 主按钮（`on-danger` 字，对比 4.58:1）*/
  danger?: boolean
  /** P2-C：红色警告块文案（EX-17）*/
  warning?: string
  /** P2-C：覆盖默认主按钮文案（「清空」/「仍然清空」）*/
  confirmLabel?: string
}

export const useTaskStore = defineStore('task', () => {
  const running = ref(false)
  const progress = ref<{ phase: ProgressPayload['phase']; done: number; total: number; currentName: string | null }>({
    phase: 'planning',
    done: 0,
    total: 0,
    currentName: null,
  })
  const lastResult = ref<ExecuteResult | null>(null)
  const lastUndo = ref<UndoResult | null>(null)
  const modal = ref<ModalKind>('none')
  const confirmContext = ref<ConfirmContext | null>(null)
  const statusOverride = ref<string | null>(null)
  let currentTaskId: string | null = null
  let offProgress: (() => void) | null = null

  const files = useFilesStore()
  const rule = useRuleStore()
  const cat = useCatStore()
  const prefs = usePrefsStore()
  const history = useHistoryStore()

  /** 整体进度：阶段序号 × 0.5 + 阶段内进度 × 0.5（接口文档 §3.4）*/
  const overallPercent = computed(() => {
    const p = progress.value
    if (p.total === 0) return 0
    const inner = Math.min(1, p.done / p.total)
    switch (p.phase) {
      case 'planning':
        return 0
      case 'to_temp':
        return Math.round(inner * 50)
      case 'to_target':
        return Math.round(50 + inner * 50)
      default:
        return Math.round(inner * 100)
    }
  })

  const statusText = computed(() => {
    if (statusOverride.value) return statusOverride.value
    if (!running.value) return null
    const p = progress.value
    switch (p.phase) {
      case 'planning':
        return '正在准备…'
      case 'to_temp':
        return `已处理 ${p.done} / ${p.total}`
      case 'to_target':
        return `已处理 ${p.done} / ${p.total}`
      case 'rolling_back':
        return '正在撤销已完成的改名…'
      default:
        return null
    }
  })

  function setStatusOverride(text: string | null, revertAfterMs = 3000): void {
    statusOverride.value = text
    if (text && revertAfterMs > 0) {
      const snapshot = text
      setTimeout(() => {
        if (statusOverride.value === snapshot) statusOverride.value = null
      }, revertAfterMs)
    }
  }

  /* ── IX-060：点「开始改名」的全部分支 ───────────────────────────── */

  async function start(): Promise<void> {
    if (running.value) {
      await cancel()
      return
    }
    if (!files.canExecute) return

    // 有冲突项 → 先弹 SCR-04（默认按钮是「先不改」）
    if (files.stats.conflict > 0 && !rule.rule.autoResolveConflict) {
      modal.value = 'conflict'
      return
    }

    await continueAfterConflictDecision()
  }

  /** 冲突弹窗两分支（IX-091 / IX-092）与二次确认共用这段 */
  async function continueAfterConflictDecision(): Promise<void> {
    const threshold = prefs.prefs.confirmThreshold
    const count = files.executableCount

    if (count >= threshold) {
      confirmContext.value = {
        kind: 'rename',
        title: '确认改名',
        body: `即将修改 ${count} 个文件 / 文件夹的名称，是否继续？`,
      }
      modal.value = 'confirm'
      return
    }

    await doExecute()
  }

  /** SCR-04：EL-101「先不改（推荐）」 */
  function keepNoChange(): void {
    modal.value = 'none'
    setStatusOverride('已取消，冲突项未改动')
  }

  /** SCR-04：EL-102「自动加序号后继续」 */
  async function autoResolveAndContinue(): Promise<void> {
    modal.value = 'none'
    rule.patch({ autoResolveConflict: true })
    // 立即重算（不走 200ms 防抖），否则会拿着过期的冲突统计继续
    await files.runPreview()
    await continueAfterConflictDecision()
  }

  /* ── 真正执行 ───────────────────────────────────────────────────── */

  async function doExecute(): Promise<void> {
    modal.value = 'none'
    confirmContext.value = null

    // 只把「会发生变化」的项交给主进程（无变化的项不需要改名，
    // 也让执行结果里的 total 与 problems 更有意义）
    const items: ExecuteItem[] = files.items
      .filter((i) => i.status === 'changed' || i.status === 'conflict')
      // ★ P3-3：`attrs` 一起传 —— 不传的话，主进程算新名时 `{大小}` 展开成空串，
      //   而预览那边是对的 → 「预览对、执行错」。
      .map((i) => ({
        id: i.id,
        dirPath: i.dirPath,
        fromName: i.name,
        isDir: i.isDir,
        attrs: i.attrs,
        // ★ P3-4：不传 → 主进程按规则重算、**表里的名字被完全忽略**，
        //   而界面预览是对的 → 「预览对、执行错」（设计 §7.5 第 3 行）
        override: i.override,
      }))

    if (items.length === 0) return

    const taskId = crypto.randomUUID()
    currentTaskId = taskId
    running.value = true
    progress.value = { phase: 'planning', done: 0, total: items.length, currentName: null }
    cat.trigger('ST-03', { n: 0, m: items.length })

    // 先订阅进度再发起调用，避免漏掉最早的几条
    offProgress = window.maodie.rename.onProgress((p) => {
      if (p.taskId !== taskId) return
      progress.value = { phase: p.phase, done: p.done, total: p.total, currentName: p.currentName }
      cat.setProgress(p.done, p.total)
    })

    try {
      const res = await window.maodie.rename.execute({
        taskId,
        items,
        rule: JSON.parse(JSON.stringify(rule.rule)),
        date: todayOf(),
        autoResolveConflict: rule.rule.autoResolveConflict,
      })

      if (!res.ok) {
        setStatusOverride('改名没能开始，稍后再试试')
        cat.backToIdle()
        return
      }

      const result = res.data
      lastResult.value = result

      // 列表里的名字同步成新名（否则用户看到的是过期旧名）
      if (result.successExamples.length > 0) {
        const succeeded = items.filter((i) => !result.problems.some((p) => p.id === i.id))
        files.applyRenamed(
          succeeded.map((i) => ({ dirPath: i.dirPath, fromName: i.fromName, toName: findNewName(result, i) })),
        )
      }

      if (result.canceled) {
        // 用户取消 → 回 ST-01，**不判为失败**（交互说明 §7.2）
        cat.backToIdle()
        setStatusOverride(
          result.problems.length === 0
            ? '已取消，改动的项已全部改回去'
            : `已取消，但有 ${result.problems.length} 项没能回滚`,
        )
        return
      }

      await history.load()
      const hasProblem = result.summary.skipped + result.summary.failed > 0
      if (hasProblem) {
        cat.trigger('ST-05', { n: result.summary.skipped + result.summary.failed })
        playFailure(prefs.prefs.soundEnabled)
      } else {
        cat.trigger('ST-04')
        playSuccess(prefs.prefs.soundEnabled)
      }

      if (!result.recordSaved) {
        setStatusOverride('改名记录未能保存，本次改名无法撤销', 0)
      }
      modal.value = 'result'
    } finally {
      offProgress?.()
      offProgress = null
      running.value = false
      currentTaskId = null
    }
  }

  function findNewName(result: ExecuteResult, item: ExecuteItem): string {
    const ok = result.successExamples.find((e) => e.dirPath === item.dirPath && e.fromName === item.fromName)
    return ok ? ok.toName : item.fromName
  }

  /* ── 取消（IX-061）───────────────────────────────────────────────── */

  async function cancel(): Promise<void> {
    if (!running.value || !currentTaskId) return
    setStatusOverride('正在取消…', 0)
    const res = await window.maodie.rename.cancel({ taskId: currentTaskId })
    if (res.ok) {
      setStatusOverride(
        res.data.canceled ? `已取消，改了 ${res.data.rolledBack} 项已全部改回去` : '已经改完了',
      )
    } else {
      setStatusOverride(null)
    }
  }

  /* ── 二次确认（SCR-05）───────────────────────────────────────────── */

  async function confirmYes(): Promise<void> {
    const ctx = confirmContext.value
    modal.value = 'none'
    confirmContext.value = null
    if (!ctx) return

    switch (ctx.kind) {
      case 'rename':
        await doExecute()
        break
      case 'undoOne':
        if (ctx.taskId) await runUndoTask(ctx.taskId)
        break
      case 'undoAll':
        await runUndoAll()
        break
      case 'clear':
        files.clear()
        setStatusOverride('列表已清空（文件本身没有被删除）')
        break
      case 'clearHistory':
        await runClearHistory()
        break
    }
  }

  function confirmNo(): void {
    modal.value = 'none'
    confirmContext.value = null
  }

  /* ── 撤销（IX-071 / IX-072 / IX-090）────────────────────────────── */

  function askUndoTask(taskId: string): void {
    const t = history.tasks.find((x) => x.id === taskId)
    if (!t) return
    confirmContext.value = {
      kind: 'undoOne',
      title: '撤销上一次改名',
      body: `将把 ${t.entries.length} 个文件的名字改回去（${t.ruleSummary}），确定吗？`,
      taskId,
    }
    modal.value = 'confirm'
  }

  function askUndoAll(): void {
    const stat = history.undoableSummary
    if (stat.taskCount === 0) {
      setStatusOverride('还没有可以撤销的改名记录')
      return
    }
    confirmContext.value = {
      kind: 'undoAll',
      title: '全部撤销',
      body: `将把 ${stat.taskCount} 个任务、共 ${stat.fileCount} 个文件的名字全部改回去，确定吗？`,
    }
    modal.value = 'confirm'
  }

  function askClear(): void {
    if (files.items.length === 0) return
    confirmContext.value = {
      kind: 'clear',
      title: '清空列表',
      body: `将移除列表中的 ${files.items.length} 项。文件本身不会被删除。`,
      count: files.items.length,
    }
    modal.value = 'confirm'
  }

  /* ── 清空历史（IX-101 / EX-17 · P2-C）────────────────────────────── */

  /**
   * 点「清空历史记录」（EL-113）。
   *
   * ★ 必须**分两支**：有「可撤销」任务时要额外警告 ——
   *   清空 = 删掉撤销记录 → 那些改名再也撤不回来。
   *   不做这支会让用户经历「改错了名 → 想撤销 → 发现历史被自己清了」→ 永久丢数据。
   */
  function askClearHistory(): void {
    const n = history.tasks.length
    if (n === 0) return
    const undoable = history.undoableSummary.taskCount
    confirmContext.value = {
      kind: 'clearHistory',
      title: '清空历史记录',
      body: `将删除全部 ${n} 条改名记录。\n文件本身不会被删除，也不会被改名。`,
      warning:
        undoable > 0
          ? `其中 ${undoable} 条改名记录仍然可以撤销。清空后这 ${undoable} 条将无法再还原 —— 只能手动把文件名改回去。`
          : undefined,
      danger: true,
      confirmLabel: undoable > 0 ? '仍然清空' : '清空',
    }
    modal.value = 'confirm'
  }

  async function runClearHistory(): Promise<void> {
    const res = await window.maodie.history.clear()
    if (!res.ok) {
      setStatusOverride('清空没成功，稍后再试试')
      return
    }
    // ★ 先重置淘汰基准再刷新列表：否则「用户主动清空」会被判成系统淘汰，
    //   状态栏假报「为保证性能，较旧的记录已被清理」（P2-C §2.6）
    history.resetEvictionBaseline()
    setStatusOverride(`已清空全部 ${res.data.cleared} 条历史记录，文件未被改动`)
  }

  async function runUndoTask(taskId: string): Promise<void> {
    const entriesBefore = history.tasks.find((t) => t.id === taskId)?.entries ?? []
    const res = await window.maodie.history.undoTask({ taskId })
    await history.load()

    if (!res.ok) {
      setStatusOverride(res.code === 'E_UNDO_ALREADY' ? '这条已经撤销过啦' : '撤销没成功，稍后再试试')
      return
    }

    lastUndo.value = res.data
    // 与主列表联动：被撤销的文件若还在列表里，名字同步改回并重算预览
    const restored = entriesBefore.filter(
      (e) => !res.data.skipped.some((s) => s.dirPath === e.dirPath && s.toName === e.toName),
    )
    files.applyRenamedBack(restored)

    if (res.data.skipped.length > 0) {
      setStatusOverride(`已撤销 ${res.data.restored} 项，有 ${res.data.skipped.length} 个文件找不到了`)
      cat.trigger('ST-05', { n: res.data.skipped.length })
    } else {
      setStatusOverride(`已撤销 ${res.data.restored} 项，名字都改回去啦`)
      cat.trigger('ST-04')
    }
  }

  async function runUndoAll(): Promise<void> {
    const allEntries = history.tasks.filter((t) => t.status === 'active').flatMap((t) => t.entries)
    const res = await window.maodie.history.undoAll()
    await history.load()

    if (!res.ok) {
      setStatusOverride('撤销没成功，稍后再试试')
      return
    }

    const data: UndoAllResult = res.data
    files.applyRenamedBack(allEntries)
    setStatusOverride(
      data.skippedTotal > 0
        ? `已撤销 ${data.undoneTasks} 个任务、${data.restoredFiles} 项（${data.skippedTotal} 个文件找不到了）`
        : `已全部撤销（${data.undoneTasks} 个任务、${data.restoredFiles} 项）`,
    )
    cat.trigger('ST-04')
  }

  /** SCR-03 的 EL-093「撤销本次」*/
  async function undoLast(): Promise<void> {
    const r = lastResult.value
    modal.value = 'none'
    if (!r) return
    await runUndoTask(r.taskId)
  }

  function closeModal(): void {
    modal.value = 'none'
  }

  /** P2-A：打开设置（SCR-07）。走同一个 modal 状态机，保证「同时只有一个弹窗」，
   *  并且 Esc / 点遮罩的关闭逻辑可以原样复用，不需要另写一套。*/
  function openSettings(): void {
    modal.value = 'settings'
  }

  /** P2-C 增量：打开「命令行怎么用」教程（SCR-08）。
   *
   * ★ 注意这里**不是** `settings` 的子状态 —— 教程占用同一个 modal 状态机，
   *   意味着从设置跳进教程时设置会关掉。这是刻意的：
   *   ① 两个弹窗叠在一起，遮罩会叠两层，视觉上会「越叠越暗」
   *   ② Esc 该关哪一个会变得含糊（Esc 在 AppModal 里是常驻监听）
   *   ③ 用户看完教程真正的下一步是「回去复制命令」，而不是同时看两个窗
   *   所以：进教程 = 设置关掉；关教程 = 回主界面（命令随时能在设置里再拿一次）。*/
  function openCliGuide(): void {
    modal.value = 'cliGuide'
  }

  function todayOf(): string {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }

  return {
    running,
    progress,
    overallPercent,
    statusText,
    lastResult,
    lastUndo,
    modal,
    confirmContext,
    start,
    cancel,
    confirmYes,
    confirmNo,
    keepNoChange,
    autoResolveAndContinue,
    askUndoTask,
    askUndoAll,
    askClear,
    askClearHistory,
    undoLast,
    closeModal,
    openSettings,
    openCliGuide,
    setStatusOverride,
  }
})
