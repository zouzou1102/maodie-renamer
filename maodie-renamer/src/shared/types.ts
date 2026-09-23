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

  /**
   * P3-3：入列那一刻的属性快照（创建 / 修改 / 大小）。
   *
   * ★ 跟着列表走，**不落盘** —— 列表本来就不持久化（`DEC-07`），所以零新增持久化字段。
   */
  attrs: ItemAttrs

  /**
   * ★ P3-4：本项的「新名主体」由导入的表格给定 —— **有它就不走规则**。
   *
   * 与 `attrs` 同理：跟着列表走、**不落盘**（列表本来就不持久化，`DEC-07`）。
   * 「清除导入」= 把它置回 `undefined`，该项立刻回到按规则算。
   */
  override?: ItemOverride
}

/* ══ P3-3（第 3 批）：文件属性快照 ═════════════════════════════════ */

/**
 * `{大小}` 的单位，5 档。默认 `'auto'` = 选**第一个让数值 ≥ 1** 的单位（设计 §3.4）。
 *
 * 换算基数 **1024**（1 KB = 1024 B）。小数位固定 1 位，`B` 那档例外（整数）。
 */
export type SizeUnit = 'auto' | 'B' | 'KB' | 'MB' | 'GB'

/**
 * 一个文件在「**加入列表那一刻**」的属性快照 —— 之后**不再刷新**（设计 §1.3）。
 *
 * ★ 为什么要冻结：`fs-scan` 入列时本来就调了 `lstat`，三个值顺手就能拿到
 *   （**零额外磁盘 IO**）。冻结之后预览与执行**用同一份**，否则
 *   「预览时文件是 10:00 改的、执行前又被改成 11:00」会让两边算出不同的名字。
 *   与 P3-1「时间起点冻结进规则」是同一条纪律。
 */
export interface ItemAttrs {
  /**
   * 创建日期 `YYYY-MM-DD`（**本机本地时区**，来自 `birthtime`）。
   * 不可用时空串。
   *
   * ⚠️ 来自 `birthtime` **不是** `ctime`：`ctime` 是「元数据变更时间」，
   *   改名 / 改权限都会刷新它 —— 而这个产品干的就是改名，用错会让用户看到
   *   「上一次改名那一刻」，且**界面上毫无异常**（设计 §3.2）。
   */
  created: string
  /** 修改日期 `YYYY-MM-DD`（本地时区，来自 `mtime`）。不可用时空串 */
  modified: string
  /**
   * 字节数。
   *
   * ★ **文件夹为 `null`（不可用），0 字节文件为 `0`（真的空）** ——
   *   两者**必须分开**：文件夹的 `lstat().size` 不代表里面内容的总和，
   *   要算总和得递归，而本项目铁律是「绝不递归」（`DEC-01`）。
   *   若把文件夹也算成 `0B`，用户会以为自己的文件夹是空的（设计 §1.4）。
   */
  sizeBytes: number | null
}

/* ══ 规则配置 ══════════════════════════════════════════════════════════ */

/**
 * 模式（当前 5 个，互斥；DEC-02 的结论不变，只是分支从 3 个变成 5 个）。
 *
 * ⚠️ **`'rule'` 这个值刻意不改名**：界面上叫「自定义」，代码里仍是 `rule`。
 *    改枚举值要动 `history.json` 里的旧摘要、CLI 的 `--rule` 语义、模板库、
 *    以及所有老单测 —— 纯风险、零收益（设计 §5.①）。映射写在这里就够了。
 *
 * ★ 加新模式时**不要写兜底式代码**（`A || B ? x : y`）—— 新值会静默掉进
 *  兜底分支，界面正常、行为全错。一律用正面判断或穷尽 switch + `never`（设计 §1.2）。
 */
export type RuleMode = 'delete' | 'replace' | 'rule' | 'insert' | 'import'

/**
 * ★ P3-5：扩展名处理（默认 `'keep'`）。
 *
 * 与 `caseTransform` **同级**：不是第六个模式，而是「作用在结果上的开关」——
 * 先按模式算出主体，最后再决定拼回什么扩展名。做成模式就互斥了，
 * 没法「先改主体、再改扩展名」一起用（设计 §1.6）。
 */
export type ExtMode = 'keep' | 'set' | 'remove' | 'append'
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
  /**
   * ★ P3-5：扩展名处理。默认 'keep' = 现在的行为，一个字都不变。
   * ⚠️ 它放宽的是 P0 铁律「EX-07 扩展名保护」→ 所以**默认关**，
   *    用户显式打开后，改出的名字照样过 `validateNewName` 与冲突检测。
   */
  extMode: ExtMode
  /** `set` / `append` 用得到；`keep` / `remove` 忽略。默认 '' */
  extValue: string
  delete: { text: string }
  replace: { find: string; to: string }
  /**
   * ★ P3-5：插入模式的参数 —— **单独一组**（产品负责人 2026-09-23 定）。
   * 一组对应一个模式：`delete` / `replace` / `rule` / `insert` 各一组，
   * `import` 没有参数所以不需要组（设计 §7.1）。
   */
  insert: {
    /** 在第几个**码点**后插；默认 0。越界落到末尾，负数当 0 */
    at: number
    /** 插什么；默认 ''。为空 = 规则不生效 */
    text: string
  }
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

    /* ── P3-3（第 3 批）新增 ───────────────────────────────────
       属性变量（`{创建}` `{修改}` `{大小}`）**没有启用开关** ——
       它们只有「用户写了才出现」，不像序号 / 日期那样还有一个自动位置。
       加一个勾只会让人以为「勾上就会自动加进名字」（设计 §1.2 / §5.①）。 */

    /** `{大小}` 的单位，默认 'auto' */
    sizeUnit: SizeUnit
  }
}

/** 默认值（新建任务 / 重置规则时使用） */
export const DEFAULT_RULE: RuleConfig = {
  // ★ P3-5：默认停在「自定义」（= `rule`）—— 产品负责人 2026-09-23 定（原默认是
  //   `delete`；这次五模式改版把默认页签换成更常用的「自定义」）。
  mode: 'rule',
  caseSensitive: false,
  autoResolveConflict: false,
  regexEnabled: false,
  caseTransform: 'none',
  /* P3-5 的 3 个默认值 —— 'keep' + '' = 行为与「不用扩展名处理」完全相同 */
  extMode: 'keep',
  extValue: '',
  delete: { text: '' },
  replace: { find: '', to: '' },
  insert: { at: 0, text: '' },
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
    /* P3-3 的 1 个默认值 —— `'auto'` = 行为与「不用属性变量」完全相同 */
    sizeUnit: 'auto',
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

/* ══ 导出清单（md:fs:exportList · P3-2 / DEC-17）═══════════════════ */

export type ExportFormat = 'xlsx' | 'txt' | 'csv' | 'docx'

/**
 * 导出请求。
 *
 * ★ `header` / `rows` 由**渲染层组装**（只有它拿着 items、勾选状态与列的取舍），
 *   主进程只做「转格式 + 写盘」——**不重算、不判断、也不认识表头文案**。
 *
 * ⚠️ 这与设计文档 §7.1 初稿的形状（`rows: ExportRow[]`）不同，是刻意的：
 *   若让主进程按 `ExportRow` 的字段去拼表头与列序，那么「表头文案」「列的顺序」
 *   「哪几列启用」这些**业务知识就跑到主进程**了 —— 改一次文案要改两处，
 *   而漏改只表现为「导出文件里的表头与界面勾选框不一致」。
 *   现在的形状让这些只有一处真源（`export-rows.ts`）。
 */
export interface ExportListRequest {
  format: ExportFormat
  /** 表头行（渲染层按勾选的列生成；「序号」列恒有、不可取消）*/
  header: string[]
  /** 数据行的单元格文本，每行长度与 header 一致 */
  rows: string[][]
  /** 建议文件名（**不含目录**），由主进程丢进「另存为」对话框当 defaultPath */
  suggestedName: string
}

/** 与既有 `pickFiles` 同形：取消时 `canceled = true` 且 `filePath` 为空串 */
export interface ExportListResult {
  canceled: boolean
  filePath: string
}

/* ══ P3-4（第 4 批）：导入表格 ════════════════════════════════════════ */

/**
 * 表格里的一个单元格 —— **必须带列号**。
 *
 * ⚠️ 列号只能来自 xlsx 里 `<c r="C5">` 的 `r` 属性，**不能按出现顺序数格子**：
 *   Excel **不写空的 `<c>`**，所以「第 3 列的内容」会被数成第 2 列，
 *   整张表从那一行起**错位**，而界面上「看着挺整齐」（设计 §7.5 第 5 行）。
 */
export interface TableCell {
  /** 列号，从 **1** 开始（1 = A 列） */
  col: number
  /** 文本值；空串 = 这一格是空的（与「没有这个单元格」同义） */
  text: string
}

export interface TableRow {
  /** 行号，从 **1** 开始（直接来自 `r` 属性，**可能跳号**） */
  rowNumber: number
  /** 该行**有内容**的单元格（稀疏）—— 位置的真源是 `col`，不是数组下标 */
  cells: TableCell[]
}

/** 读进来的一张表（`.xlsx` / `.csv` / `.txt` 共用这一个形状） */
export interface ImportedTable {
  /** 工作表名（**只读第一张**）；纯文本表为空串 */
  sheetName: string
  /** 数据行 */
  rows: TableRow[]
  /** 总行数 —— 被截断时这里仍是**截断前**的真实值（设计 §4 第 3 行） */
  totalRows: number
  /** 是否被截断（超过单批 1 万行的口径） */
  truncated: boolean
}

/**
 * 表格给定的「新名**主体**」（不含扩展名）。
 *
 * ★ 存主体而不是全名 —— 扩展名仍取**原文件的**，于是 `EX-07 扩展名保护`
 *   不用为本批写任何新逻辑就自动成立（设计 §1.3）。
 */
export interface ItemOverride {
  /** 表格给定的新名主体 */
  stem: string
  /** 来源表格的显示名（文件名），用于规则区顶部那条提示
   *  （「本批有 N 个名字来自《xxx.xlsx》」） */
  sourceTable: string
}

/** `md:fs:importTable` 的返回 */
export interface ImportTableResult {
  /** 用户在对话框里点了取消 → true（不是失败，静默返回） */
  canceled: boolean
  /** 用户选中的文件名（**只有文件名**，不含目录，显示用） */
  fileName: string
  /** 读出来的表；`canceled` 时为 null */
  table: ImportedTable | null
}

/* ══ 改名执行（md:rename:execute）══════════════════════════════════════ */

export interface ExecuteItem {
  id: string
  dirPath: string
  /** 当前名称（含扩展名） */
  fromName: string
  isDir: boolean
  /**
   * ★ P3-3：入列时的属性快照。
   *
   * 不补这一行 → 主进程算新名时拿不到属性 → `{大小}` 展开成空串，
   * 而**预览那边是对的** → 「预览对、执行错」（与 P3-1 `sanitizeRule` 漏字段同一类）。
   * 见设计 §7.5 第 3 行。
   */
  attrs: ItemAttrs

  /**
   * ★ P3-4：表里给的新名主体（有它就不按规则重算）。
   *
   * 不补这一行 → 主进程按规则重算 → **表里的名字被完全忽略**，
   * 而界面预览是对的 → 「预览对、执行错」（与 P3-1 同一类形态，设计 §7.5 第 3 行）。
   */
  override?: ItemOverride
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
    /**
     * ★ P3-2：导出文件名清单（原名 / 新名对照表）。
     *
     * ⚠️ 这一行是**本批最易漏的一处**：`preload/api.ts` 里是强转
     * （`as MaoDieAPI`），所以接口声明漏了它**照样编译过、typecheck 也是 0 错**，
     * 但渲染层调用时拿到 `undefined` —— 运行时才炸。见设计 §7.5 第 2 行。
     */
    exportList(req: ExportListRequest): Promise<MdResult<ExportListResult>>
    /**
     * ★ P3-4：导入表格（`.xlsx` / `.csv` / `.txt`）。
     *
     * ⚠️ 与 `exportList` 同一处陷阱：`preload/api.ts` 是**强转**，
     *   接口声明漏了这行**照样编译过、typecheck 0 错**，运行时才炸。
     *   无入参 —— 选哪个文件由系统「打开」对话框决定（与导出对称）。
     */
    importTable(): Promise<MdResult<ImportTableResult>>
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

export type PreviewItemInput = Pick<
  FileItem,
  | 'id'
  | 'dirPath'
  | 'stem'
  | 'ext'
  | 'isDir'
  // ★★ P3-3：不加进这个联合，Worker 就**永远拿不到属性** ——
  //   `{大小}` 在预览里展开成空串，而**界面完全正常**。
  //   ⚠️ `Pick` 是**合法子集**，所以漏了这一行 **typecheck 不会报错**。
  //   这是本批最阴的一处（设计 §7.5 第 1 行）。
  | 'attrs'
  // ★★ P3-4：**同一个坑的第二次**（P3-3 刚踩过）。不加进这个联合，
  //   Worker 就永远拿不到 `override` → 预览显示的是「按规则算的名字」，
  //   而执行时用的是「表里的名字」→ **预览 ≠ 执行**（方向还反了：执行对、预览错）。
  //   ⚠️ `Pick` 是**合法子集**，所以漏了这一行 **typecheck 不会报错**。
  | 'override'
>

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
