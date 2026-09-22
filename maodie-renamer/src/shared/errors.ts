/**
 * 错误码 —— 直接对应 PRD 的 EX 编号，不另造一套语义。
 *
 * 这样界面文案、结果弹窗、验收用例三处天然对齐。
 * 定义位置按《接口文档》§6。
 */

export const MD_ERROR = {
  // —— 校验类（预览阶段即可发现）——
  E_INVALID_CHAR: 'E_INVALID_CHAR',
  E_PATH_TOO_LONG: 'E_PATH_TOO_LONG',
  E_EMPTY_NAME: 'E_EMPTY_NAME',

  // —— 冲突类 ——
  E_CONFLICT_BATCH: 'E_CONFLICT_BATCH',
  E_CONFLICT_DISK: 'E_CONFLICT_DISK',

  // —— 执行类 ——
  E_BUSY: 'E_BUSY',
  E_PERM: 'E_PERM',
  E_SOURCE_MISSING: 'E_SOURCE_MISSING',

  // —— 撤销类 ——
  E_UNDO_ALREADY: 'E_UNDO_ALREADY',
  E_UNDO_SOURCE_GONE: 'E_UNDO_SOURCE_GONE',

  // —— 流程 / 参数类 ——
  E_LIST_EMPTY: 'E_LIST_EMPTY',
  E_NO_CHANGE: 'E_NO_CHANGE',
  E_OVERFLOW: 'E_OVERFLOW',
  E_TASK_RUNNING: 'E_TASK_RUNNING',
  E_TASK_NOT_FOUND: 'E_TASK_NOT_FOUND',

  /**
   * ★ P3-4：导入的表格读不出来。
   *
   * ⚠️ **两个码共用一个 EX 编号（EX-18）** —— 设计 §4 把「加密/损坏」与
   * 「表太大」都归到 EX-18，但两者给用户看的话**不能是同一句**：
   * 一个是「你这文件有问题」，另一个是「这文件没错、是这个功能读不动」。
   * 所以这里拆成两个错误码，文档里仍然记在同一行 EX-18 下。
   */
  E_TABLE_UNREADABLE: 'E_TABLE_UNREADABLE',
  E_TABLE_TOO_BIG: 'E_TABLE_TOO_BIG',

  E_UNKNOWN: 'E_UNKNOWN',
} as const

export type MdErrorCode = (typeof MD_ERROR)[keyof typeof MD_ERROR]

/**
 * 界面文案的唯一来源（接口文档 §6.2）。
 * 组件里**禁止**硬编码错误字符串 —— 同一条错误会出现在「列表行原因徽标」
 * 「结果弹窗明细」「状态栏提示」三处，硬编码必然出现措辞不一致。
 *
 * `{n}` 是占位符，由调用方替换为实际数量。
 */
export const MD_ERROR_TEXT: Record<MdErrorCode, string> = {
  E_INVALID_CHAR: '名称里不能包含 \\ / : * ? " < > |',
  E_PATH_TOO_LONG: '名字太长了，系统放不下',
  E_EMPTY_NAME: '改完名字就空了，检查一下规则',
  E_CONFLICT_BATCH: '有 {n} 项改完会撞名',
  E_CONFLICT_DISK: '已经有同名文件了',
  E_BUSY: '文件被占用',
  E_PERM: '无写入权限',
  E_SOURCE_MISSING: '文件找不到了',
  E_UNDO_SOURCE_GONE: '有 {n} 个文件找不到了，已跳过',
  E_UNDO_ALREADY: '这条已经撤销过啦',
  E_LIST_EMPTY: '',
  E_NO_CHANGE: '当前规则不会改变任何名字',
  E_OVERFLOW: '单批最多 1 万个，超出部分未加入',
  E_TASK_RUNNING: '正在改名中，等一下再试',
  E_TASK_NOT_FOUND: '这个任务已经结束了',
  // EX-18（两个码共用这一个编号）
  E_TABLE_UNREADABLE: '表格读不出来，可能是加密或损坏的',
  E_TABLE_TOO_BIG: '这张表太大了，读不动（只支持单表 1 万行以内）',
  E_UNKNOWN: '出了点小意外，稍后再试试',
}

/** 取界面文案，可替换 `{n}` 占位符 */
export function errorText(code: MdErrorCode, n?: number): string {
  const t = MD_ERROR_TEXT[code] ?? MD_ERROR_TEXT.E_UNKNOWN
  return n === undefined ? t : t.replace('{n}', String(n))
}

/** 业务错误对象。只在主进程内部流转，不跨 IPC 序列化 */
export class MdError extends Error {
  readonly code: MdErrorCode
  readonly detail?: string

  constructor(code: MdErrorCode, detail?: string) {
    super(`${code}${detail ? `: ${detail}` : ''}`)
    this.name = 'MdError'
    this.code = code
    this.detail = detail
  }
}

/** 判断是否是 MdError */
export function isMdError(e: unknown): e is MdError {
  return e instanceof MdError
}
