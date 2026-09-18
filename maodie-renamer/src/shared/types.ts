/**
 * 类型全集 —— 主进程、preload、渲染层、Worker **四方共用的唯一类型来源**
 * （接口文档 §5）。
 *
 * 为什么要一处集中：同一个字段名出现在四处，用 JS 时改一处必然漏一两次且只在
 * 运行时炸；集中定义后编译期就红。这也是本项目选 TypeScript 的现实理由。
 *
 * 序列化约束（接口文档 §1.3.2）：
 *   · 不传函数 / Promise / class 实例 / Symbol
 *   · 时间一律用 number（毫秒时间戳）或 'YYYY-MM-DD' 字符串，不传 Date
 *   · 不传 Map / Set，用普通对象或数组
 *   · `undefined` 会丢键，`null` 会保留 —— 需要「明确无值」时用 null
 *   · 路径一律 Windows 绝对路径反斜杠形式
 */

import type { MdErrorCode } from './errors'
import { DEFAULT_THEME, type Theme } from './theme'

/* ══ 通用返回 ══════════════════════════════════════════════════════════ */

/**
 * 业务通道的统一返回。
 *
 * 为什么业务失败要 resolve 而不是 reject：批量改名里「部分失败」是**正常业务
 * 流程**（某个文件被占用），不是异常。用 reject 表达会让调用方到处 try/catch，
 * 漏掉一处就是未捕获的 Promise rejection，最坏情况界面卡在「执行中」出不来。
 */
export type MdResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: MdErrorCode; detail?: string }

/* ══ 列表项 ════════════════════════════════════════════════════════════ */

export type ConflictKind = 'none' | 'batch' | 'disk' | 'self' | 'case-only'

/** 差异高亮区间。半开区间 [start, end)，与 JS 的 slice 语义一致 */
export interface DiffRange {
  oldStart: number
  oldEnd: number
  newStart: number
  newEnd: number
}

export type ItemStatus = 'pending' | 'unchanged' | 'changed' | 'conflict' | 'invalid'

export interface FileItem {
  /** 唯一 id，入列时生成 */
  id: string
  /** 绝对路径（反斜杠形式），如 C:\Users\PC\Desktop\abc.txt */
  fullPath: string
  /** 所在目录的绝对路径 */
  dirPath: string
  /** 当前完整名称（含扩展名） */
  name: string
  /** 规则作用的主体（文件去掉扩展名；文件夹取全名） */
  stem: string
  /** 扩展名（含点，如 '.docx'；无则空串） */
  ext: string
  /** 是否为文件夹（symlink 指向目录时也为 true） */
  isDir: boolean
  /**
   * 是否为符号链接 / junction。仅用于信息展示与审计，
   * 策略统一为「只改链接自身名字」，绝不做 realpath 解引用。
   */
  isSymlink: boolean

  /* ↓↓↓ 以下字段由渲染层的预览 Worker 填充，主进程不关心 ↓↓↓ */

  /** 计算出的新主体 */
  newStem: string
  /** 完整新名 = newStem + ext（冗余字段，方便直接渲染） */
  newName: string
  status: ItemStatus
  /** status 为 conflict 时进一步区分 */
  conflictKind?: ConflictKind
  /** 可直接显示的中文原因（冲突 / 非法时填写） */
  reason?: string
  /** 机器可读的原因码 */
  reasonCode?: MdErrorCode
  /** 差异高亮区间；null 或 undefined 表示无变化 */
  diffRange?: DiffRange | null
  /** 开启「自动加序号」后为该项算出的最终名字（如 报告_1.docx） */
  resolvedName?: string
}

/* ══ 规则配置 ══════════════════════════════════════════════════════════ */

export type RuleMode = 'delete' | 'replace' | 'rule'
/**
 * P3-1：编号类型。
 *
 * ⚠️ 它是**规则化模式内部**的一个参数（跟「位置」「起始」「位数」同级），
 * 不是第四种模式 —— 模式互斥解决的是「算新名走哪条路」，类型解决的是
 * 「序号长什么样」，两件事不该混在同一层。
 */
export type SeqKind = 'number' | 'letter' | 'random' | 'time'
/** P3-1：`'at'` = 插在主体的第 n 个码点之后（扩展名永不参与） */
export type SeqPosition = 'prefix' | 'suffix' | 'at'
export type DateFormat =
  | 'YYYY-MM-DD'
  | 'YYYYMMDD'
  | 'YYYY年MM月DD日'
  | 'MM月DD日'
  | 'YYMMDD'
/** F-11 大小写转换。'capitalize' = 只把主体第一个字符转大写、其余保持原样 */
export type CaseTransform = 'none' | 'lower' | 'upper' | 'capitalize'

export interface RuleConfig {
  mode: RuleMode
  /** 默认 false（不区分大小写） */
  caseSensitive: boolean
  /** 对应 EL-055。默认 false = 冲突跳过（DEC-05） */
  autoResolveConflict: boolean
  /** F-10：正则匹配（仅删除 / 替换模式生效）。默认 false —— 关闭时与 P0 逐字节一致 */
  regexEnabled: boolean
  /** F-11：大小写转换。默认 'none' —— 只作用于新名主体，扩展名永不动 */
  caseTransform: CaseTransform
  delete: { text: string }
  replace: { find: string; to: string }
  rule: {
    prefix: string
    suffix: string
    seqEnabled: boolean
    /** 默认 1，≥ 0 */
    seqStart: number
    /** 默认 1，≥ 1（MVP 仅支持递增） */
    seqStep: number
    /** 默认 3，范围 0–6 */
    seqPad: number
    /** 默认 'suffix' */
    seqPosition: SeqPosition
    dateEnabled: boolean
    /** 默认 'YYYY-MM-DD' */
    dateFormat: DateFormat
    /** 默认 true；false = 丢弃原主体 */
    keepOriginal: boolean

    /* ── P3-1（第 1 批）新增 6 个字段 ──────────────────────────────────
       每个都有默认值，且默认值下的输出与 P0/P1 **逐字节一致**
       （`seqKind: 'number'` 时 `seqText` 走的就是原来那段函数体）。
       这是本批能免掉迁移的地基：规则从来不落盘，`StoreName` 只有
       history / window / prefs（见 P3-1 设计 §1.2）。 */
    /** 编号类型，默认 'number' */
    seqKind: SeqKind
    /** 默认 1，范围 1–200；仅 `seqPosition === 'at'` 时生效 */
    seqAt: number
    /** 默认 6，范围 1–16；仅 `seqKind === 'random'` 时生效。
     *  ⚠️ 刻意与 `seqPad` 分开：复用 `seqPad` 要把它的上限 6 改成 16，
     *  那等于动一条既有断言（`seqPad: 99 → '000001'`）。 */
    seqRandomLen: number
    /** 默认 0，≥ 0；「换一批」把种子 +1，整批随机串随之改变 */
    seqRandomSeed: number
    /** 默认 ''；格式 YYYY-MM-DD。为空且类型是时间时，引擎回落到调用方传入的目标日期 */
    seqTimeStart: string
    /** 时间类型的样式，默认 'YYYY年MM月DD日'；与「启用日期」共用同一张样式表 */
    seqTimeFormat: DateFormat
  }
}

/** 默认值（新建任务 / 重置规则时使用） */
export const DEFAULT_RULE: RuleConfig = {
  mode: 'delete',
  caseSensitive: false,
  autoResolveConflict: false,
  regexEnabled: false,
  caseTransform: 'none',
  delete: { text: '' },
  replace: { find: '', to: '' },
  rule: {
    prefix: '',
    suffix: '',
    seqEnabled: false,
    seqStart: 1,
    seqStep: 1,
    seqPad: 3,
    seqPosition: 'suffix',
    dateEnabled: false,
    dateFormat: 'YYYY-MM-DD',
    keepOriginal: true,
    /* P3-1 的 6 个默认值 —— 这一组值 = 「行为与 P0/P1 完全相同」 */
    seqKind: 'number',
    seqAt: 1,
    seqRandomLen: 6,
    seqRandomSeed: 0,
    seqTimeStart: '',
    seqTimeFormat: 'YYYY年MM月DD日',
  },
}

/* ══ 入列（md:fs:resolvePaths）═════════════════════════════════════════ */

export interface ResolvePathsRequest {
  /** 本次新加入的原始路径（来自对话框或拖拽） */
  paths: string[]
  /** 已在列表中的路径，用于去重（不区分大小写） */
  existingPaths: string[]
}

export interface ResolvedBatch {
  /** 新入列的项，已填好 id / stem / ext / isDir 等 */
  items: FileItem[]
  /** 目录快照：dirPath → 该目录下的现存名称清单（供预览 Worker 判磁盘冲突） */
  snapshot: Record<string, string[]>
  stats: {
    /** 实际入列数 */
    accepted: number
    /** EX-09 重复项 */
    ignoredDuplicates: number
    /** EX-13 超限被丢弃数 */
    overflow: number
    /** EX-08 非文件对象 */
    rejected: number
    /** 扫描时已不存在（含断链 symlink） */
    vanished: number
  }
}

/* ══ 改名执行（md:rename:execute）══════════════════════════════════════ */

export interface ExecuteItem {
  id: string
  dirPath: string
  /** 当前名称（含扩展名） */
  fromName: string
  isDir: boolean
}

export interface ExecuteRequest {
  /** 本次任务的唯一 id，由渲染层生成（UUID），用于临时名与进度关联 */
  taskId: string
  /** 待处理清单：只传算新名所需的最小信息（ADR-004） */
  items: ExecuteItem[]
  rule: RuleConfig
  /** 执行当天的日期，格式 YYYY-MM-DD。主进程会校验它等于本机今天 */
  date: string
  /** 冲突策略：false = 跳过（默认，DEC-05）；true = 自动加序号 */
  autoResolveConflict: boolean
}

export type ProblemResult = 'skipped' | 'failed' | 'invalid'

export interface ExecuteProblem {
  id: string
  dirPath: string
  fromName: string
  /** 尝试的目标名 */
  attemptedName: string
  result: ProblemResult
  code: MdErrorCode
  /** 可直接显示的中文文案 */
  reason: string
}

export interface ExecuteResult {
  taskId: string
  canceled: boolean
  summary: {
    /** 入参 items 总数 */
    total: number
    success: number
    skipped: number
    invalid: number
    failed: number
  }
  /** 成功示例，最多 3 条（对应 SCR-03 的「成功举例」折叠区） */
  successExamples: Array<{ dirPath: string; fromName: string; toName: string }>
  /** 失败明细（含被跳过项），最多 200 条 */
  problems: ExecuteProblem[]
  /** problems 被截断时的总数，用于显示「共 N 项，显示前 200 项」 */
  problemsTotal: number
  problemsTruncated: boolean
  /** 是否成功写入历史记录（false 时界面需提示「本次改名无法撤销」） */
  recordSaved: boolean
  elapsedMs: number
}

export interface CancelResult {
  /** 是否真的中断了（任务已完成时返回 false） */
  canceled: boolean
  /** 被回滚的项数（界面文案：「改了 N 项已全部改回去」） */
  rolledBack: number
}

export type ProgressPhase = 'planning' | 'to_temp' | 'to_target' | 'rolling_back'

export interface ProgressPayload {
  taskId: string
  phase: ProgressPhase
  done: number
  total: number
  /** 当前正在处理的名称，供 ST-03 卡片与状态栏展示 */
  currentName: string | null
}

/* ══ 历史与撤销 ════════════════════════════════════════════════════════ */

export interface RenameEntry {
  dirPath: string
  /** 改名前的名称 */
  fromName: string
  /** 改名后的名称 */
  toName: string
}

export interface RenameTask {
  id: string
  /** 执行时间，毫秒时间戳 */
  createdAt: number
  /** 执行当天日期，YYYY-MM-DD */
  date: string
  /** 规则摘要文案，用于历史页展示 */
  ruleSummary: string
  /** active = 可撤销；undone = 已撤销（终态） */
  status: 'active' | 'undone'
  /** 撤销完成时间（毫秒时间戳），未撤销时为 null */
  undoneAt: number | null
  /** ★ 只记录「改名成功」的明细（撤销只针对改成功的项） */
  entries: RenameEntry[]
  /** 本次任务的统计计数（含未成功的项，供历史页显示） */
  counts: {
    total: number
    success: number
    skipped: number
    invalid: number
    failed: number
  }
}

export interface UndoSkip {
  dirPath: string
  fromName: string
  toName: string
  code: MdErrorCode
  reason: string
}

export interface UndoResult {
  taskId: string
  status: 'ok' | 'partial' | 'failed' | 'already_undone'
  /** 成功还原的项数 */
  restored: number
  skipped: UndoSkip[]
  elapsedMs: number
}

export interface UndoAllResult {
  /** 参与撤销的任务数（原本 status === 'active' 的） */
  taskCount: number
  undoneTasks: number
  restoredFiles: number
  skippedTotal: number
  perTask: Array<{
    taskId: string
    status: UndoResult['status']
    restored: number
  }>
}

/* ══ 应用 / 窗口 / 偏好 ════════════════════════════════════════════════ */

export interface AppInfo {
  version: string
  electronVersion: string
  chromeVersion: string
  platform: 'win32'
  arch: 'x64' | 'arm64'
  userDataPath: string
  isDev: boolean
  /**
   * ★ P2-C：可执行文件路径（`process.execPath`），供设置里「复制程序路径」用。
   *
   * 加字段比加通道轻（P2-C §4）。⚠️ 未打包时它是 Electron 引擎的路径而不是
   * `maodie.exe` —— 那正是「复制程序路径」要解决的问题，但**该命令只有打包后才可直接用**。
   */
  execPath: string
}

/* ══ 清空历史（md:history:clear · P2-C / DEC-12）══════════════════════ */

export interface ClearHistoryResult {
  /** 被清掉的记录条数（供状态栏文案「已清空全部 N 条历史记录」）*/
  cleared: number
}

export interface WindowState {
  width: number
  height: number
  x: number
  y: number
  maximized: boolean
}

export interface Prefs {
  version: number
  /** 音效开关（默认 true） */
  soundEnabled: boolean
  /** 「减少动画」无障碍开关（默认 false） */
  reduceMotion: boolean
  /** 超过多少项弹二次确认（默认 10） */
  confirmThreshold: number
  /** 主题三态（P2-A）：system 跟随系统 / light 始终浅色 / dark 始终深色 */
  theme: Theme
}

export const DEFAULT_PREFS: Prefs = {
  version: 1,
  soundEnabled: true,
  reduceMotion: false,
  confirmThreshold: 10,
  theme: DEFAULT_THEME,
}

export interface StorageWarningPayload {
  file: 'history' | 'window' | 'prefs'
  kind: 'corrupted' | 'write_failed'
  /** corrupted 时，坏文件被备份到哪里 */
  backupPath?: string
  /** 可直接显示给用户的中文文案 */
  message: string
}

/* ══ 存储层（数据库设计 §10，与上面的运行时类型区分）═══════════════════ */

export interface Envelope<T> {
  schemaVersion: number
  appVersion: string
  payload: T
}

export type StoreName = 'history' | 'window' | 'prefs'

export type HistoryFile = Envelope<{ tasks: RenameTask[] }>

export type WindowFile = Envelope<{
  width: number
  height: number
  x: number
  y: number
  maximized: boolean
  savedAt: number
}>

export type PrefsFile = Envelope<{
  soundEnabled: boolean
  reduceMotion: boolean
  confirmThreshold: number
  theme: Theme
}>

/* ══ preload 暴露面（window.maodie）════════════════════════════════════ */

export interface MaoDieAPI {
  app: {
    getInfo(): Promise<AppInfo>
    getPrefs(): Promise<Prefs>
    setPrefs(patch: Partial<Prefs>): Promise<Prefs>
    /** 返回取消函数 */
    onStorageWarning(cb: (p: StorageWarningPayload) => void): () => void
  }
  window: {
    getState(): Promise<WindowState>
    minimize(): void
    /** 返回切换后的最大化状态 */
    toggleMaximize(): Promise<boolean>
    close(): void
    /** 返回取消函数 */
    onMaximizeChanged(cb: (p: { maximized: boolean }) => void): () => void
  }
  fs: {
    pickFiles(): Promise<MdResult<{ canceled: boolean; paths: string[] }>>
    /** 可多选；返回的是「选中的那几个文件夹本身」，绝不展开它们内部（DEC-01） */
    pickDirectory(): Promise<MdResult<{ canceled: boolean; paths: string[] }>>
    resolvePaths(req: ResolvePathsRequest): Promise<MdResult<ResolvedBatch>>
  }
  rename: {
    execute(req: ExecuteRequest): Promise<MdResult<ExecuteResult>>
    cancel(req: { taskId: string }): Promise<MdResult<CancelResult>>
    /** 返回取消函数 */
    onProgress(cb: (p: ProgressPayload) => void): () => void
  }
  history: {
    list(): Promise<MdResult<RenameTask[]>>
    undoTask(req: { taskId: string }): Promise<MdResult<UndoResult>>
    undoAll(): Promise<MdResult<UndoAllResult>>
    /** ★ P2-C：清空全部历史记录。**只删记录，绝不触碰任何文件** */
    clear(): Promise<MdResult<ClearHistoryResult>>
  }
}

/* ══ 预览（Worker 协议，接口文档 §4.3.3）═══════════════════════════════ */

export type PreviewItemInput = Pick<FileItem, 'id' | 'dirPath' | 'stem' | 'ext' | 'isDir'>

export interface PreviewRequest {
  /** 递增，用于丢弃过期结果 */
  reqId: number
  items: PreviewItemInput[]
  rule: RuleConfig
  date: string
  autoResolveConflict: boolean
  /** 目录快照（入列时由主进程带回） */
  snapshot: Record<string, string[]>
}

export type PreviewItemOutput = Pick<
  FileItem,
  'id' | 'newStem' | 'newName' | 'status' | 'conflictKind' | 'reason' | 'reasonCode' | 'diffRange' | 'resolvedName'
>

export interface PreviewStats {
  changed: number
  unchanged: number
  conflict: number
  invalid: number
}

export interface PreviewResponse {
  reqId: number
  items: PreviewItemOutput[]
  stats: PreviewStats
  elapsedMs: number
}

/** 预览组装与计划构建共用的结果形状（rename-plan 复用） */
export interface PlanEntry {
  id: string
  dirPath: string
  fromName: string
  toName: string
  isDir: boolean
  outcome: 'ready' | 'skipped' | 'invalid'
  code?: MdErrorCode
}
