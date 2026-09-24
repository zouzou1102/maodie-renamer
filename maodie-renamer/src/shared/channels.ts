/**
 * IPC 通道名常量（接口文档 §1.2）。
 *
 * 全部通道名集中在这里，**主进程与 preload 都从这里 import** ——
 * 杜绝「一边写 `md:fs:pickFiles`、另一边写 `md:fs:pickfiles`」这类拼写事故。
 *
 * 命名规范：`md:<域>:<动作>`；事件通道用过去式 / 名词表示「已发生」。
 * 合计 **22** 个请求响应通道 + 3 个事件通道。
 *
 * ⚠️ 这个数字曾经滞后：P2-C 加 `HISTORY_CLEAR` 之后实际是 16 个，
 *    但文件头一直写着 15。P3-2 加 `FS_EXPORT_LIST` 时校正为 17，
 *    P3-4 加 `FS_IMPORT_TABLE` 时校正为 18。P3-7 加 `MERGE_PLAN` / `MERGE_RUN`
 *    （文件夹合并，破轻量化新增的两条）时校正为 20。P3-8 加 `EXTRACT_PLAN` /
 *     `EXTRACT_RUN`（文件提取，复用运输层、独立通道，破轻量化再 +2）时校正为
 *     **22**。**加通道必须同时改这个数** —— 本项目就靠它做通道数对账。
 */

export const CH = {
  /* ── md:app:* ── 应用信息与偏好（简单通道：失败即 reject）── */
  APP_GET_INFO: 'md:app:getInfo',
  APP_GET_PREFS: 'md:app:getPrefs',
  APP_SET_PREFS: 'md:app:setPrefs',

  /* ── md:window:* ── 无边框窗口控制（简单通道）── */
  WINDOW_GET_STATE: 'md:window:getState',
  WINDOW_MINIMIZE: 'md:window:minimize',
  WINDOW_TOGGLE_MAXIMIZE: 'md:window:toggleMaximize',
  WINDOW_CLOSE: 'md:window:close',

  /* ── md:fs:* ── 文件系统与系统对话框（业务通道：返回 MdResult）── */
  FS_PICK_FILES: 'md:fs:pickFiles',
  FS_PICK_DIRECTORY: 'md:fs:pickDirectory',
  FS_RESOLVE_PATHS: 'md:fs:resolvePaths',
  // P3-2（DEC-17）：导出文件名清单 —— **本批唯一新增的通道，也是唯一的破例**。
  // 理由：「另存为」对话框只能在主进程调，落盘也必须在主进程，两者绑在一起，
  // 无法复用任何既有通道。请求响应通道 16 → 17。
  FS_EXPORT_LIST: 'md:fs:exportList',
  // P3-4（DEC-19）：导入表格（.xlsx / .csv / .txt）。
  // 为什么又必须开通道：系统「打开」对话框只能在主进程调，读文件字节也必须在主进程。
  // ⚠️ 与 exportList 不同：这一条**没有请求参数需要收口** —— 选哪个文件完全由
  //    对话框决定，渲染层传不进来任何东西（少一处收口点就少一处漏网）。17 → 18。
  FS_IMPORT_TABLE: 'md:fs:importTable',

  /* ── md:rename:* ── 改名执行（业务通道）── */
  RENAME_EXECUTE: 'md:rename:execute',
  RENAME_CANCEL: 'md:rename:cancel',

  /* ── md:history:* ── 撤销与历史（业务通道）── */
  HISTORY_LIST: 'md:history:list',
  HISTORY_UNDO_TASK: 'md:history:undoTask',
  HISTORY_UNDO_ALL: 'md:history:undoAll',
  // P2-C（DEC-12）：清空历史记录。**不复用撤销通道** —— 「清空」不是「撤销」，
  // 硬塞进现有通道会把语义搞乱（P2-C §4）。请求响应通道 15 → 16，事件通道仍 3 个。
  HISTORY_CLEAR: 'md:history:clear',

  /* ── md:merge:* ── 文件夹合并（P3-7 / 第 7 批，业务通道）──
   * ★ 本批破「轻量化」新增的两条通道（设计 §0）：合并是**独立搬文件子系统**，
   *   渲染层对话框要驱动主进程去复制 / 移动文件，必须新增 `merge:plan`（干跑）
   *   与 `merge:run`（执行）。18 → 20。 */
  MERGE_PLAN: 'md:merge:plan',
  MERGE_RUN: 'md:merge:run',

  /* ── md:extract:* ── 文件提取（P3-8 / 第 8 批，业务通道）──
   * ★ 复用 P3-7 运输层（`merge-plan` / `merge-service`），本批只新增筛选器。
   *   选法 B：新增 `extract:plan`（干跑）/ `extract:run`（执行）两个独立通道
   *   （设计 §0 / §7）。20 → 22。 */
  EXTRACT_PLAN: 'md:extract:plan',
  EXTRACT_RUN: 'md:extract:run',

  /* ── 事件通道（main → renderer）── */
  EV_RENAME_PROGRESS: 'md:rename:progress',
  EV_WINDOW_MAXIMIZE_CHANGED: 'md:window:maximizeChanged',
  EV_APP_STORAGE_WARNING: 'md:app:storageWarning',
} as const

export type ChannelName = (typeof CH)[keyof typeof CH]

/** 允许用 send（单向、发了就不管）的通道白名单 —— 只有这两个 */
export const SEND_ONLY_CHANNELS = new Set<string>([CH.WINDOW_MINIMIZE, CH.WINDOW_CLOSE])
