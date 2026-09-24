/**
 * preload 暴露面测试（接口文档 §9.4 / P-06）。
 *
 * 断言 window.maodie 的形状是**白名单**：多一个命名空间、多一个方法都算越界。
 * 这条测试的价值在于：任何人（或任何一次 AI 辅助改动）顺手往桥上加东西时，
 * 会立刻被拦下来。
 */

import { describe, expect, it, vi } from 'vitest'
import { API_NAMESPACES, buildMaodieApi } from '../../src/preload/api'
import { CH } from '@shared/channels'

function makeBridge() {
  const invoke = vi.fn(async (..._args: unknown[]) => ({ ok: true, data: null }))
  const send = vi.fn((..._args: unknown[]) => undefined)
  const listeners = new Map<string, Set<(p: unknown) => void>>()

  return {
    invoke,
    send,
    on: (channel: string, cb: (p: unknown) => void) => {
      let set = listeners.get(channel)
      if (!set) {
        set = new Set()
        listeners.set(channel, set)
      }
      set.add(cb)
      return () => set!.delete(cb)
    },
    /** 测试用：模拟主进程推事件 */
    emit: (channel: string, payload: unknown) => {
      for (const cb of listeners.get(channel) ?? []) cb(payload)
    },
  }
}

describe('preload · window.maodie 的键只有白名单里的命名空间（P-06）', () => {
  it('顶层键恰好是 app / window / fs / rename / history', () => {
    const api = buildMaodieApi(makeBridge())
    expect(Object.keys(api).sort()).toEqual([...API_NAMESPACES].sort())
    expect(Object.keys(api)).toHaveLength(6)
  })

  it('不暴露 ipcRenderer / require / process / Buffer / shell 等危险能力', () => {
    const api = buildMaodieApi(makeBridge())
    const flat = JSON.stringify(Object.keys(api))
    for (const banned of ['ipcRenderer', 'require', 'process', 'Buffer', 'shell', 'openExternal']) {
      expect(flat).not.toContain(banned)
    }
  })

  it('每个命名空间的方法集合是白名单', () => {
    const api = buildMaodieApi(makeBridge())
    expect(Object.keys(api.app).sort()).toEqual(['getInfo', 'getPrefs', 'onStorageWarning', 'setPrefs'])
    expect(Object.keys(api.window).sort()).toEqual([
      'close',
      'getState',
      'minimize',
      'onMaximizeChanged',
      'toggleMaximize',
    ])
    expect(Object.keys(api.fs).sort()).toEqual(['pickDirectory', 'pickFiles', 'resolvePaths'])
    expect(Object.keys(api.rename).sort()).toEqual(['cancel', 'execute', 'onProgress'])
    expect(Object.keys(api.history).sort()).toEqual(['list', 'undoAll', 'undoTask'])
    // ★ P3-7：新增的 merge 命名空间，方法集合也必须是白名单（plan / run）
    expect(Object.keys(api.merge).sort()).toEqual(['plan', 'run'])
  })
})

describe('preload · 通道名与调用方式', () => {
  it('invoke 型通道用 invoke，send 型通道用 send（只有最小化/关闭两个）', async () => {
    const bridge = makeBridge()
    const api = buildMaodieApi(bridge)

    await api.app.getInfo()
    await api.window.getState()
    await api.window.toggleMaximize()
    await api.fs.pickFiles()
    await api.fs.pickDirectory()
    await api.fs.resolvePaths({ paths: [], existingPaths: [] })
    await api.rename.execute({} as never)
    await api.rename.cancel({ taskId: 't' })
    await api.history.list()
    await api.history.undoTask({ taskId: 't' })
    await api.history.undoAll()

    const invoked = bridge.invoke.mock.calls.map((c) => c[0])
    expect(invoked).toEqual([
      CH.APP_GET_INFO,
      CH.WINDOW_GET_STATE,
      CH.WINDOW_TOGGLE_MAXIMIZE,
      CH.FS_PICK_FILES,
      CH.FS_PICK_DIRECTORY,
      CH.FS_RESOLVE_PATHS,
      CH.RENAME_EXECUTE,
      CH.RENAME_CANCEL,
      CH.HISTORY_LIST,
      CH.HISTORY_UNDO_TASK,
      CH.HISTORY_UNDO_ALL,
    ])

    api.window.minimize()
    api.window.close()
    expect(bridge.send.mock.calls.map((c) => c[0])).toEqual([CH.WINDOW_MINIMIZE, CH.WINDOW_CLOSE])
  })

  it('入参被原样透传（preload 不做业务判断）', async () => {
    const bridge = makeBridge()
    const api = buildMaodieApi(bridge)
    const req = { paths: ['C:\\a.txt'], existingPaths: [] }
    await api.fs.resolvePaths(req)
    expect(bridge.invoke).toHaveBeenCalledWith(CH.FS_RESOLVE_PATHS, req)
  })
})

describe('preload · 三个 onXxx 都返回「取消函数」', () => {
  it('取消函数生效：取消后不再收到回调', () => {
    const bridge = makeBridge()
    const api = buildMaodieApi(bridge)

    const seen: unknown[] = []
    const off = api.rename.onProgress((p) => seen.push(p))
    expect(typeof off).toBe('function')

    bridge.emit(CH.EV_RENAME_PROGRESS, { done: 1 })
    expect(seen).toHaveLength(1)

    off()
    bridge.emit(CH.EV_RENAME_PROGRESS, { done: 2 })
    expect(seen).toHaveLength(1)
  })

  it('storageWarning 与 maximizeChanged 同样返回取消函数', () => {
    const bridge = makeBridge()
    const api = buildMaodieApi(bridge)

    const off1 = api.app.onStorageWarning(() => {})
    const off2 = api.window.onMaximizeChanged(() => {})
    expect(typeof off1).toBe('function')
    expect(typeof off2).toBe('function')
    expect(() => {
      off1()
      off2()
    }).not.toThrow()
  })
})
