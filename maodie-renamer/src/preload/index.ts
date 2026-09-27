/**
 * 预加载 —— **唯一的门**（技术方案 §1.1 / 接口文档 §2）。
 *
 * 这里只做三件事：把 ipcRenderer 的三项能力包装成 bridge、构造 window.maodie、
 * 冻结后挂到 window 上。**不含任何业务逻辑** —— 业务逻辑要放进 shared 或主进程
 * services，那样它才可单测。
 *
 * 明确不做的（P-06）：不暴露 ipcRenderer 本体、不暴露 require / process /
 * Buffer / __dirname、不暴露 shell.openExternal。
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { buildMaodieApi, type PreloadBridge } from './api'

/**
 * `webUtils.getPathForFile` 的入参类型。
 *
 * 这里不直接写 `File`：本文件属于 `tsconfig.node`，`lib` 里没有 DOM，
 * 直接引用 `File` 只能靠 electron.d.ts 的全局声明兜着 —— 太脆。
 * 用 `Parameters<…>` 从函数签名反推，既准确又不依赖 DOM lib。
 */
type FileArg = Parameters<typeof webUtils.getPathForFile>[0]

const bridge: PreloadBridge = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, cb) => {
    // 统一包装成「返回取消函数」的形式，避免界面侧忘记 off
    const handler = (_e: unknown, payload: unknown): void => cb(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
  /**
   * ★ P3-7 修复：Electron 32 移除了 `File.path`，取路径的唯一正路是
   * `webUtils.getPathForFile`。拿不到就返回**空串**（调用方丢弃），
   * 绝不用文件名拼一个假路径出来 —— 假路径会让后续 fs 操作落到错误位置。
   */
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file as FileArg)
    } catch {
      return ''
    }
  },
}

/**
 * `Object.freeze` 不是装饰：它防止界面代码（或被注入的脚本）
 * 替换掉 api.rename.execute。成本为零。
 */
contextBridge.exposeInMainWorld('maodie', Object.freeze(buildMaodieApi(bridge)))
