/**
 * 预定加载 API 的**纯函数构造器**。
 *
 * 为什么把 api 对象的构造与 `contextBridge.exposeInMainWorld` 分成两个文件：
 * 后者需要 `electron` 运行时，而前者只做「把 bridge 包装成 window.maodie 的形状」。
 * 拆开之后，接口文档 §9.4 要求的「断言 window.maodie 的键只有白名单里的命名空间」
 * 才能被单测覆盖 —— 白名单桥一旦被谁顺手加了第 7 个命名空间，测试立刻红。
 * （当前 6 个：app / window / fs / rename / history / merge；P3-7 破例新增 `merge`。）
 */

import { CH } from '@shared/channels'
import type {
  AppInfo,
  CancelResult,
  ClearHistoryResult,
  ExecuteRequest,
  ExecuteResult,
  ExportListRequest,
  ExportListResult,
  ImportTableResult,
  MaoDieAPI,
  MergePlanResult,
  MergeRequest,
  MergeRunResult,
  MdResult,
  Prefs,
  RenameTask,
  ResolvePathsRequest,
  ResolvedBatch,
  StorageWarningPayload,
  UndoAllResult,
  UndoResult,
  WindowState,
} from '@shared/types'

/** 预加载可用的最小能力面。只暴露这三个，**不给 ipcRenderer 本体**（P-06）*/
export interface PreloadBridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  send(channel: string, ...args: unknown[]): void
  /**
   * 注册监听并返回取消函数。
   *
   * 载荷用 `any` 而不是 `unknown`：调用方传进来的是带具体类型的回调
   * （如 `(p: ProgressPayload) => void`），在严格函数类型下 `unknown`
   * 会因为参数逆变而无法赋值。宽进严出，这里放宽最省事。
   */
  on(channel: string, cb: (payload: any) => void): () => void
}

export function buildMaodieApi(bridge: PreloadBridge): MaoDieAPI {
  const api: MaoDieAPI = {
    app: {
      getInfo: () => bridge.invoke(CH.APP_GET_INFO) as Promise<AppInfo>,
      getPrefs: () => bridge.invoke(CH.APP_GET_PREFS) as Promise<Prefs>,
      setPrefs: (patch) => bridge.invoke(CH.APP_SET_PREFS, patch) as Promise<Prefs>,
      onStorageWarning: (cb) => bridge.on(CH.EV_APP_STORAGE_WARNING, cb),
    },

    window: {
      getState: () => bridge.invoke(CH.WINDOW_GET_STATE) as Promise<WindowState>,
      minimize: () => bridge.send(CH.WINDOW_MINIMIZE),
      toggleMaximize: () => bridge.invoke(CH.WINDOW_TOGGLE_MAXIMIZE) as Promise<boolean>,
      close: () => bridge.send(CH.WINDOW_CLOSE),
      onMaximizeChanged: (cb) => bridge.on(CH.EV_WINDOW_MAXIMIZE_CHANGED, cb),
    },

    fs: {
      pickFiles: () =>
        bridge.invoke(CH.FS_PICK_FILES) as Promise<MdResult<{ canceled: boolean; paths: string[] }>>,
      pickDirectory: () =>
        bridge.invoke(CH.FS_PICK_DIRECTORY) as Promise<MdResult<{ canceled: boolean; paths: string[] }>>,
      resolvePaths: (req: ResolvePathsRequest) =>
        bridge.invoke(CH.FS_RESOLVE_PATHS, req) as Promise<MdResult<ResolvedBatch>>,
      // ★ P3-2：导出清单。这里用的是**强转**（`as`），所以 `MaoDieAPI` 里
      //   若漏声明这个方法，typecheck 照样 0 错、编译照过 —— 只有渲染层调用时
      //   才会拿到 `undefined` 并在运行时炸（设计 §7.5 第 2 行）。
      exportList: (req: ExportListRequest) =>
        bridge.invoke(CH.FS_EXPORT_LIST, req) as Promise<MdResult<ExportListResult>>,
      // ★ P3-4：导入表格。**无入参** —— 选哪个文件由系统「打开」对话框决定，
      //   渲染层给不了任何输入（与导出对称）。少一个入参就少一处漏网的收口点。
      importTable: () =>
        bridge.invoke(CH.FS_IMPORT_TABLE) as Promise<MdResult<ImportTableResult>>,
    },

    rename: {
      execute: (req: ExecuteRequest) =>
        bridge.invoke(CH.RENAME_EXECUTE, req) as Promise<MdResult<ExecuteResult>>,
      cancel: (req: { taskId: string }) =>
        bridge.invoke(CH.RENAME_CANCEL, req) as Promise<MdResult<CancelResult>>,
      onProgress: (cb) => bridge.on(CH.EV_RENAME_PROGRESS, cb),
    },

    history: {
      list: () => bridge.invoke(CH.HISTORY_LIST) as Promise<MdResult<RenameTask[]>>,
      undoTask: (req: { taskId: string }) =>
        bridge.invoke(CH.HISTORY_UNDO_TASK, req) as Promise<MdResult<UndoResult>>,
      undoAll: () => bridge.invoke(CH.HISTORY_UNDO_ALL) as Promise<MdResult<UndoAllResult>>,
      // P2-C：清空历史。**不加新命名空间**（仍是 5 个），只是 history 下多一个方法
      clear: () => bridge.invoke(CH.HISTORY_CLEAR) as Promise<MdResult<ClearHistoryResult>>,
    },

    // ★ P3-7：文件夹合并。**破「5 个命名空间」白名单新增的第 6 个**（设计 §0 已说明）。
    //   独立搬文件子系统，与改名完全无关，理应独立命名空间。
    merge: {
      plan: (req: MergeRequest) =>
        bridge.invoke(CH.MERGE_PLAN, req) as Promise<MdResult<MergePlanResult>>,
      run: (req: MergeRequest) =>
        bridge.invoke(CH.MERGE_RUN, req) as Promise<MdResult<MergeRunResult>>,
    },
  }

  return api
}

/** 命名空间白名单 —— 多一个都算越界（P-06）。
 *  ★ P3-7 破例从 5 个加到 6 个（`merge`）：合并是独立搬文件子系统，
 *    与改名无关，硬塞进既有命名空间会糊掉接口语义。该测试数据驱动本常量，
 *   加了 `merge` 后 `tests/unit/preload-api.spec.ts` 自动从 5 跟到 6。 */
export const API_NAMESPACES = ['app', 'window', 'fs', 'rename', 'history', 'merge'] as const

export type { StorageWarningPayload }
