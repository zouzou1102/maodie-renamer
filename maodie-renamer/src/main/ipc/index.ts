/**
 * 注册全部 IPC 通道（22 个请求响应通道 + 3 个事件通道）。
 *
 * 事件通道的推送点是各 service 的回调，不在这里单独注册。
 */

import { registerAppIpc } from './app.ipc'
import { registerWindowIpc } from './window.ipc'
import { registerFsIpc } from './fs.ipc'
import { registerRenameIpc } from './rename.ipc'
import { registerHistoryIpc } from './history.ipc'
import { registerMergeIpc } from './merge.ipc'
import { registerExtractIpc } from './extract.ipc'

export function registerAllIpc(): void {
  registerAppIpc()
  registerWindowIpc()
  registerFsIpc()
  registerRenameIpc()
  registerHistoryIpc()
  registerMergeIpc()
  registerExtractIpc()
}
