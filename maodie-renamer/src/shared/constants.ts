/**
 * 全局常量 —— 上限值、前缀、保留字符表。
 *
 * 全部集中在 shared，因为主进程、preload、渲染层、Worker 都要用同一套数字。
 * 任何一处写死字面量都是 bug 的温床。
 */

/* ── 列表与批次 ─────────────────────────────────────────────────────── */

/** EX-13：单批最多 1 万项，超出部分不加入 */
export const MAX_ITEMS_PER_BATCH = 10_000

/** 入列时目录快照的 readdir 并发度（技术方案 §4.2.2） */
export const READDIR_CONCURRENCY = 8

/* ── 存储容量（数据库设计 §4.4 / §10）──────────────────────────────── */

/** DEC-06：常态最多保留 20 条任务 */
export const HISTORY_MAX_TASKS = 20

/** 总明细条数软上限：把极端场景从 36MB 压到约 9MB */
export const HISTORY_MAX_TOTAL_ENTRIES = 50_000

/** 单条 entry 的体积估算（字节），仅用于日志与阈值判断 */
export const ENTRY_SIZE_ESTIMATE = 180

/** 损坏备份最多保留个数（数据库设计 §9） */
export const MAX_CORRUPT_BACKUPS = 3

/** 启动时清理 .tmp 残留的年龄阈值：超过 1 天才删（谨慎删除） */
export const TMP_STALE_MS = 24 * 60 * 60 * 1000

/* ── 改名执行 ───────────────────────────────────────────────────────── */

/** 临时名前缀。两阶段改名的阶段 1 用它，保证不与既有文件冲突 */
export const TMP_PREFIX = '__md_tmp_'

/** 临时名里序号补零到 6 位 */
export const TMP_INDEX_PAD = 6

/** 临时名撞名时的换号重试上限 */
export const TMP_MAX_RETRY = 5

/** 自动加序号（冲突补救）的最大尝试次数（DEC-05） */
export const CONFLICT_MAX_RETRY = 99

/** 进度推送节流：每 50 项 或 距上次 > 100ms（接口文档 §3.4）*/
export const PROGRESS_EVERY_ITEMS = 50
export const PROGRESS_EVERY_MS = 100

/** 超过该项数时，阶段之间让出事件循环，保证 IPC 心跳不被饿死 */
export const YIELD_THRESHOLD = 2_000

/* ── 校验 ───────────────────────────────────────────────────────────── */

/**
 * 路径长度阈值。PRD EX-02 写 259（MAX_PATH − 1），本方案取更保守的 255：
 * Windows 10 1607+ 开启长路径支持后限制变为「每段 255 字符」。
 * **宁可少改一条，不让它在半途失败。**
 */
export const MAX_PATH_SEGMENT_LEN = 255

/** Windows 非法字符（含控制字符另判） */
export const INVALID_CHARS = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'] as const

/** Windows 设备保留名（不区分大小写）。PRD 未覆盖，但会真实发生 */
export const RESERVED_NAMES = [
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
] as const

/* ── 窗口（数据库设计 §5）───────────────────────────────────────────── */

export const WINDOW_DEFAULT = { width: 1080, height: 680 } as const
export const WINDOW_MIN = { width: 900, height: 560 } as const
/** 窗口尺寸/位置异步写的防抖 */
export const WINDOW_SAVE_DEBOUNCE_MS = 500

/* ── 存储文件（数据库设计 §2.1）────────────────────────────────────── */

export const STORE_FILES = {
  history: 'history.json',
  window: 'window.json',
  prefs: 'prefs.json',
} as const

/** userData 目录名主动设成英文，规避中文路径在备份工具/命令行下的兼容问题 */
export const USER_DATA_DIR_NAME = 'MaoDieRenamer'

/* ── 预览 ───────────────────────────────────────────────────────────── */

/** IX-050：规则参数变更后 200ms 防抖重算（原型演示用 120ms，实现必须 200ms）*/
export const PREVIEW_DEBOUNCE_MS = 200

/** 列表行超过该行数启用虚拟滚动（ADR-005） */
export const VIRTUAL_LIST_THRESHOLD = 500

/** 固定行高（设计规范 §5.1 写死） */
export const ROW_HEIGHT = 36

/** problems 明细在 ExecuteResult 里的截断上限（接口文档 §3.4）*/
export const PROBLEMS_MAX = 200

/** 结果弹窗里的成功举例条数 */
export const SUCCESS_EXAMPLES_MAX = 3

/** ST-03 咬名字卡片的队列长度上限（交互说明 §7.3）*/
export const BITE_QUEUE_MAX = 12

/* ── 导入表格（P3-4 / 第 4 批）───────────────────────────────────────── */

/**
 * 单个 XML 部件的**字符**上限（工作表 / 共享字符串）。
 *
 * 超过就直接拒绝（`E_TABLE_TOO_BIG`），不做「先读进来再慢慢解析」：
 * 表大到这个量级已经不属于「批量改名」的用法了（设计 §4 第 4 行 → EX-18）。
 *
 * 行数上限**不在这里** —— 它复用 `MAX_ITEMS_PER_BATCH`（同为 1 万，同一口径）。
 */
export const TABLE_MAX_XML_CHARS = 24 * 1024 * 1024

/* ── 文件夹合并（P3-7 / 第 7 批）───────────────────────────────────────── */

/**
 * 递归摊平的深度上限（DEC-25）。
 *
 * 超过则干跑报 `EX-19` 并拒绝执行 —— 防止把整块盘（甚至 `C:\Windows`）递归复制进来。
 * 同时它是 junction 环的**兜底护栏**：即便没识别到 junction，深度到 20 也必然停下，
 * 不会无限循环（设计 §4 边界 3 / §5③）。
 */
export const FLATTEN_MAX_DEPTH = 20

/**
 * 递归摊平的文件数上限（DEC-25）。
 *
 * 超过则干跑报 `EX-19` 并拒绝执行（设计 §4 边界 3）。与 `MAX_ITEMS_PER_BATCH`
 * 同口径（都是 1 万），但**语义不同**：那是对「改名列表」的上限，这是「一次合并
 * 摊平出来的文件数」上限 —— 两者独立计数。
 */
export const FLATTEN_MAX_FILES = 10_000
