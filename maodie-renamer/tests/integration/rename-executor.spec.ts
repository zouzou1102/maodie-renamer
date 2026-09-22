/**
 * 改名执行器集成测试 —— 在**真实临时目录**上验证安全底线。
 *
 * 覆盖技术方案 §9.2 的：
 *   U-01 目标名已存在 → 抛 E_CONFLICT_DISK，且目标文件**字节未变**
 *   U-03 链式改名 A→B、B→C → 两阶段执行成功
 *   U-04 a.txt → A.txt → 成功，目录中只剩 A.txt
 *   U-12 撤销倒序
 *   U-13 撤销时源文件已消失 → 跳过该项，其余继续
 *   U-16 FIFO 淘汰
 * 以及取消回滚、历史写入、TC-15 性能预算。
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { rename } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_RULE, type ExecuteRequest, type RuleConfig } from '@shared/types'
import { execute, localDateString, undoEntries } from '../../src/main/services/rename-executor'
import { runRenameTask } from '../../src/main/services/rename-service'
import { safeRename } from '../../src/main/services/fs-safe'
import { initStorage } from '../../src/main/services/storage'
import {
  appendTask,
  evict,
  listTasks,
  loadHistory,
  undoTask,
} from '../../src/main/services/history-store'
import { setAppVersion } from '../../src/main/services/prefs-store'
import { cleanupAll, ls, makeDir, makeFiles, makeTempDir, readText } from '../fixtures'

setAppVersion('1.0.0')

let dir = ''

beforeEach(async () => {
  dir = await makeTempDir()
  initStorage(await makeTempDir('md-store-'))
  await loadHistory()
})

afterAll(cleanupAll)

/* ── 工具 ───────────────────────────────────────────────────────────── */

function rule(patch: Partial<RuleConfig> = {}, rulePatch: Partial<RuleConfig['rule']> = {}): RuleConfig {
  return { ...DEFAULT_RULE, ...patch, rule: { ...DEFAULT_RULE.rule, ...rulePatch } }
}

const noopProgress = () => {}

const delRule = (text: string) => rule({ mode: 'delete', delete: { text } })
const replaceRule = (find: string, to: string) => rule({ mode: 'replace', replace: { find, to } })
/** 让所有项都改成同一个名字 —— 用来制造真实的批次内撞名 */
const collapseRule = (name: string) => rule({ mode: 'rule' }, { prefix: name, keepOriginal: false })

function req(names: string[], r: RuleConfig, extra: Partial<ExecuteRequest> = {}): ExecuteRequest {
  return {
    taskId: `task-${Math.random().toString(36).slice(2, 10)}`,
    items: names.map((fromName, i) => ({
      id: `id-${i}`,
      dirPath: dir,
      fromName,
      isDir: false,
      attrs: { created: '', modified: '', sizeBytes: null },
    })),
    rule: r,
    date: localDateString(),
    autoResolveConflict: false,
    ...extra,
  }
}

/** 只跑执行器（不写历史）—— 用于纯粹的文件系统行为断言 */
const run = (r: ExecuteRequest, signal = new AbortController().signal) => execute(r, noopProgress, signal)

/**
 * 走完整的改名服务（执行器 + 写历史）。
 * 历史与撤销相关的用例必须用它 —— 「写历史」是 rename-service 的职责，
 * 不在执行器里。
 */
const runTask = (r: ExecuteRequest) => runRenameTask(r, noopProgress)

/* ── U-01 ★ 绝不覆盖 ─────────────────────────────────────────────────── */

describe('U-01 ★ 目标名已存在（磁盘冲突）—— 绝不覆盖', () => {
  it('safeRename 直接抛 E_CONFLICT_DISK', async () => {
    await makeFiles(dir, ['a.txt', 'b.txt'])
    await expect(safeRename(join(dir, 'a.txt'), join(dir, 'b.txt'))).rejects.toMatchObject({
      code: 'E_CONFLICT_DISK',
    })
  })

  it('★ 目标文件内容在改名前后逐字节未变，目录内容也完全没变', async () => {
    await makeFiles(dir, ['a.txt', 'b.txt'], (n) => (n === 'b.txt' ? 'IMPORTANT-DO-NOT-LOSE' : 'source'))
    const before = await readText(join(dir, 'b.txt'))
    const beforeNames = await ls(dir)

    const out = await run(req(['a.txt'], replaceRule('a', 'b')))

    expect(out.result.summary.success).toBe(0)
    expect(out.result.summary.skipped).toBe(1)
    expect(out.result.problems[0].code).toBe('E_CONFLICT_DISK')

    expect(await ls(dir)).toEqual(beforeNames)
    expect(await readText(join(dir, 'b.txt'))).toBe(before)
    expect(await readText(join(dir, 'a.txt'))).toBe('source')
  })

  it('大小写不敏感地判定冲突（B.TXT 会挡住 b.txt）', async () => {
    await makeFiles(dir, ['a.txt', 'B.TXT'], () => 'precious')
    const out = await run(req(['a.txt'], replaceRule('a', 'b')))
    expect(out.result.summary.skipped).toBe(1)
    expect(await readText(join(dir, 'B.TXT'))).toBe('precious')
  })

  it('批次内撞名（两项都改成同一个名字）→ 后到者被跳过，两份内容都完好', async () => {
    await makeFiles(dir, ['x1.txt', 'x2.txt'], (n) => `keep-${n}`)
    const out = await run(req(['x1.txt', 'x2.txt'], collapseRule('报告')))

    expect(out.result.summary.success).toBe(1)
    expect(out.result.summary.skipped).toBe(1)
    expect(out.result.problems[0].code).toBe('E_CONFLICT_BATCH')
    expect(await ls(dir)).toEqual(['x2.txt', '报告.txt'])
    expect(await readText(join(dir, 'x2.txt'))).toBe('keep-x2.txt')
    expect(await readText(join(dir, '报告.txt'))).toBe('keep-x1.txt')
  })

  it('★ 目标名被「本次不改的邻居」占用 → 跳过，邻居内容一字未改', async () => {
    // abc广告.txt → abc.txt，而 abc.txt 就在同一目录、且本次不改它
    await makeFiles(dir, ['abc广告.txt', 'abc.txt'], (n) => (n === 'abc.txt' ? 'NEIGHBOR' : 'src'))
    const out = await run(req(['abc广告.txt', 'abc.txt'], delRule('广告')))

    expect(out.result.summary.success).toBe(0)
    expect(out.result.summary.skipped).toBe(1)
    expect(out.result.problems[0].code).toBe('E_CONFLICT_DISK')
    expect(await readText(join(dir, 'abc.txt'))).toBe('NEIGHBOR')
    expect(await ls(dir)).toEqual(['abc.txt', 'abc广告.txt'])
  })
})

/* ── U-03 链式改名（两阶段的核心价值）────────────────────────────────── */

describe('U-03 链式改名 A→B、B→C', () => {
  /**
   * 用「规则化 + 后缀 1」制造一条真实的改名链：
   *   `a.txt`  → `a1.txt`（而 `a1.txt` 此刻就在同一目录里！）
   *   `a1.txt` → `a11.txt`
   *
   * 若不是两阶段，第一步 `a.txt → a1.txt` 会直接撞上尚未处理的 `a1.txt`。
   * 两阶段先全部改成临时名、再改成目标名，链式冲突自然消失。
   * （统一规则无法构造 A↔B 互换这类真环，链式就是本产品能遇到的最强情形。）
   */
  it('★ 两阶段执行成功，结果正确，内容跟着文件走', async () => {
    await makeFiles(dir, ['a.txt', 'a1.txt'], (n) => `chain-${n}`)
    const out = await run(req(['a.txt', 'a1.txt'], rule({ mode: 'rule' }, { suffix: '1' })))

    expect(out.result.summary.success).toBe(2)
    expect(out.result.summary.failed).toBe(0)
    expect(await ls(dir)).toEqual(['a1.txt', 'a11.txt'])
    expect(await readText(join(dir, 'a1.txt'))).toBe('chain-a.txt')
    expect(await readText(join(dir, 'a11.txt'))).toBe('chain-a1.txt')
  })

  it('邻居没被腾空时照样拦：只入列 a.txt 就真的冲突', async () => {
    await makeFiles(dir, ['a.txt', 'a1.txt'])
    const out = await run(req(['a.txt'], rule({ mode: 'rule' }, { suffix: '1' })))
    expect(out.result.summary.skipped).toBe(1)
    expect(out.result.problems[0].code).toBe('E_CONFLICT_DISK')
  })
})

/* ── U-04 case-only ──────────────────────────────────────────────────── */

describe('U-04 大小写不同 a.txt → A.txt', () => {
  it('成功，且目录中只剩 A.txt，内容不变', async () => {
    await makeFiles(dir, ['a.txt'], () => 'case-content')
    const out = await run(req(['a.txt'], replaceRule('a', 'A')))

    expect(out.result.summary.success).toBe(1)
    expect(out.result.summary.failed).toBe(0)
    expect(out.result.problems).toHaveLength(0)
    expect(await ls(dir)).toEqual(['A.txt'])
    expect(await readText(join(dir, 'A.txt'))).toBe('case-content')
  })
})

/* ── 自动加序号 ──────────────────────────────────────────────────────── */

describe('自动加序号（DEC-05 的可选开关）', () => {
  it('开启后冲突项自动让位，既有文件一字未改', async () => {
    await makeFiles(dir, ['a.txt', 'report.txt'], (n) => (n === 'report.txt' ? 'KEEP-ME' : 'src'))
    const out = await run(req(['a.txt'], replaceRule('a', 'report'), { autoResolveConflict: true }))

    expect(out.result.summary.success).toBe(1)
    expect(out.result.successExamples[0].toName).toBe('report_1.txt')
    expect(await readText(join(dir, 'report.txt'))).toBe('KEEP-ME')
    expect(await ls(dir)).toEqual(['report.txt', 'report_1.txt'])
  })
})

/* ── 扩展名保护 + 文件夹 ─────────────────────────────────────────────── */

describe('扩展名保护与文件夹改名（EX-07 / DEC-01）', () => {
  it('规则只作用于主体，扩展名原样保留（含大小写）', async () => {
    await makeFiles(dir, ['【广告】报告.JPG'])
    const out = await run(req(['【广告】报告.JPG'], delRule('【广告】')))
    expect(out.result.summary.success).toBe(1)
    expect(await ls(dir)).toEqual(['报告.JPG'])
  })

  it('文件夹改名：整名参与规则，不做扩展名拆分', async () => {
    const d = await makeTempDir()
    await makeDir(d, '我的文件夹.2026')
    const out = await execute(
      {
        taskId: 't-dir',
        items: [{ id: '1', dirPath: d, fromName: '我的文件夹.2026', isDir: true, attrs: { created: '', modified: '', sizeBytes: null } }],
        rule: delRule('.2026'),
        date: localDateString(),
        autoResolveConflict: false,
      },
      noopProgress,
      new AbortController().signal,
    )
    expect(out.result.summary.success).toBe(1)
    expect(await ls(d)).toEqual(['我的文件夹'])
  })

  it('文件夹名里带点也照样能被规则处理（整名主体）', async () => {
    const d = await makeTempDir()
    await makeDir(d, 'v1.2.3')
    const out = await execute(
      {
        taskId: 't-dir2',
        items: [{ id: '1', dirPath: d, fromName: 'v1.2.3', isDir: true, attrs: { created: '', modified: '', sizeBytes: null } }],
        rule: delRule('.'),
        date: localDateString(),
        autoResolveConflict: false,
      },
      noopProgress,
      new AbortController().signal,
    )
    expect(out.result.summary.success).toBe(1)
    expect(await ls(d)).toEqual(['v123'])
  })
})

/* ── 历史写入 ────────────────────────────────────────────────────────── */

describe('执行后写历史（数据库设计 §4.4.5）', () => {
  it('只记录成功项，counts 完整，recordSaved 为 true', async () => {
    await makeFiles(dir, ['a广告.txt', 'b广告.txt'])
    const out = await runTask(req(['a广告.txt', 'b广告.txt'], delRule('广告')))

    expect(out.summary.success).toBe(2)
    expect(out.recordSaved).toBe(true)
    const tasks = listTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0].entries.map((e) => e.toName)).toEqual(['a.txt', 'b.txt'])
    expect(tasks[0].counts).toEqual({ total: 2, success: 2, skipped: 0, invalid: 0, failed: 0 })
    expect(tasks[0].ruleSummary).toBe('删除「广告」')
    expect(tasks[0].status).toBe('active')
    expect(tasks[0].undoneAt).toBeNull()
  })

  it('失败 / 跳过 / 非法的项不进 entries（撤销因此绝对安全）', async () => {
    await makeFiles(dir, ['a广告.txt', 'b.txt', '广告.txt'])
    const out = await runTask(req(['a广告.txt', 'b.txt', '广告.txt'], delRule('广告')))

    expect(out.summary.invalid).toBe(1)
    expect(out.recordSaved).toBe(true)
    const task = listTasks()[0]
    // b.txt 无变化、广告.txt 空名 → 都不进 entries
    expect(task.entries.map((e) => e.fromName)).toEqual(['a广告.txt'])
    expect(task.counts.invalid).toBe(1)
  })

  it('全无变化的批次不写历史（没有产生任何磁盘变更）', async () => {
    await makeFiles(dir, ['abc.txt'])
    const out = await runTask(req(['abc.txt'], delRule('广告')))
    expect(out.summary.success).toBe(0)
    expect(out.recordSaved).toBe(true)
    expect(listTasks()).toHaveLength(0)
  })
})

/* ── 取消与回滚 ──────────────────────────────────────────────────────── */

describe('取消与回滚（IX-061）', () => {
  it('执行中取消 → 已改的项全部改回原名，且不写历史', async () => {
    const names = Array.from({ length: 60 }, (_, i) => `f${String(i).padStart(3, '0')}广告.txt`)
    await makeFiles(dir, names)
    const before = await ls(dir)

    const controller = new AbortController()
    // 进度节流是「每 50 项」或「距上次 > 100ms」；用 done=50 这个确定会触发的点来取消
    const out = await execute(
      req(names, delRule('广告')),
      (p) => {
        if (p.phase === 'to_temp' && p.done >= 50) controller.abort()
      },
      controller.signal,
    )

    expect(out.result.canceled).toBe(true)
    expect(out.rolledBack).toBeGreaterThan(0)
    expect(await ls(dir)).toEqual(before)
    // 取消的批次什么都没改 → 不留历史
    expect(listTasks()).toHaveLength(0)
  })
})

/* ── U-12 / U-13 撤销 ────────────────────────────────────────────────── */

describe('U-12 撤销倒序', () => {
  it('两批改名逐批撤销后，文件名完整还原', async () => {
    await makeFiles(dir, ['a广告.txt', 'b广告.txt'], (n) => `v-${n}`)
    const first = await runTask(req(['a广告.txt', 'b广告.txt'], delRule('广告')))
    expect(first.summary.success).toBe(2)
    expect(await ls(dir)).toEqual(['a.txt', 'b.txt'])

    // 第二批：b.txt → c.txt（a.txt 无变化，被跳过）
    const second = await runTask(req(['a.txt', 'b.txt'], replaceRule('b', 'c')))
    expect(second.summary.success).toBe(1)
    expect(await ls(dir)).toEqual(['a.txt', 'c.txt'])

    const tasks = listTasks()
    expect(tasks).toHaveLength(2)

    // 撤销第二批
    const u2 = await undoTask(tasks[0].id, noopProgress)
    expect(u2.status).toBe('ok')
    expect(await ls(dir)).toEqual(['a.txt', 'b.txt'])

    // 撤销第一批
    const u1 = await undoTask(tasks[1].id, noopProgress)
    expect(u1.status).toBe('ok')
    expect(await ls(dir)).toEqual(['a广告.txt', 'b广告.txt'])
    expect(await readText(join(dir, 'a广告.txt'))).toBe('v-a广告.txt')
  })

  it('撤销是终态：二次撤销返回 E_UNDO_ALREADY，且不会再改名、不产生新记录', async () => {
    await makeFiles(dir, ['a广告.txt'])
    await runTask(req(['a广告.txt'], delRule('广告')))
    const id = listTasks()[0].id

    await undoTask(id, noopProgress)
    expect(listTasks()[0].status).toBe('undone')
    expect(listTasks()[0].undoneAt).toBeTypeOf('number')

    await expect(undoTask(id, noopProgress)).rejects.toMatchObject({ code: 'E_UNDO_ALREADY' })
    expect(listTasks()).toHaveLength(1)
    expect(await ls(dir)).toEqual(['a广告.txt'])
  })

  it('撤销 case-only 改名（a.txt → A.txt）也能正确还原', async () => {
    await makeFiles(dir, ['a.txt'], () => 'case-undo')
    await runTask(req(['a.txt'], replaceRule('a', 'A')))
    expect(await ls(dir)).toEqual(['A.txt'])

    const u = await undoTask(listTasks()[0].id, noopProgress)
    expect(u.status).toBe('ok')
    expect(await ls(dir)).toEqual(['a.txt'])
    expect(await readText(join(dir, 'a.txt'))).toBe('case-undo')
  })
})

describe('U-13 撤销时源文件已消失', () => {
  it('跳过该项、其余继续，并报告 E_UNDO_SOURCE_GONE', async () => {
    await makeFiles(dir, ['a广告.txt', 'b广告.txt', 'c广告.txt'])
    await runTask(req(['a广告.txt', 'b广告.txt', 'c广告.txt'], delRule('广告')))
    expect(await ls(dir)).toEqual(['a.txt', 'b.txt', 'c.txt'])

    // 模拟「文件被外部移走」—— 用改名模拟移动，绝不删除文件
    const elsewhere = await makeTempDir()
    await rename(join(dir, 'b.txt'), join(elsewhere, 'b.txt'))

    const res = await undoTask(listTasks()[0].id, noopProgress)

    expect(res.status).toBe('partial')
    expect(res.restored).toBe(2)
    expect(res.skipped).toHaveLength(1)
    expect(res.skipped[0].code).toBe('E_UNDO_SOURCE_GONE')
    expect(await ls(dir)).toEqual(['a广告.txt', 'c广告.txt'])
    // 仍然标记为已撤销：重新标回 active 会让用户反复看到同一批失败
    expect(listTasks()[0].status).toBe('undone')
  })
})

describe('undoEntries（执行器层的撤销原语）', () => {
  it('倒序还原并逐项报告结果', async () => {
    await makeFiles(dir, ['A广告.txt', 'B广告.txt'])
    const out = await run(req(['A广告.txt', 'B广告.txt'], delRule('广告')))
    expect(out.successEntries).toHaveLength(2)

    const res = await undoEntries('t', out.successEntries, noopProgress)
    expect(res.restored).toBe(2)
    expect(res.skipped).toHaveLength(0)
    expect(await ls(dir)).toEqual(['A广告.txt', 'B广告.txt'])
  })
})

/* ── TC-15 性能 ──────────────────────────────────────────────────────── */

describe('TC-15 性能预算', () => {
  it('1000 项改名总耗时 < 10 秒', async () => {
    const names = Array.from({ length: 1000 }, (_, i) => `【某某公众号】第${i}课.pdf`)
    await makeFiles(dir, names)

    const t0 = Date.now()
    const out = await run(req(names, delRule('【某某公众号】')))
    const elapsed = Date.now() - t0

    expect(out.result.summary.success).toBe(1000)
    expect(elapsed).toBeLessThan(10_000)
    console.log(`[TC-15] 1000 项改名耗时 ${elapsed}ms（预算 10000ms）`)
  }, 60_000)
})

/* ── 参数与边界 ──────────────────────────────────────────────────────── */

describe('执行参数与边界', () => {
  it('日期与本机不一致时改用本机当天（不阻断执行）', async () => {
    await makeFiles(dir, ['a广告.txt'])
    const out = await run(req(['a广告.txt'], delRule('广告'), { date: '2000-01-01' }))
    expect(out.result.summary.success).toBe(1)
  })

  it('非法项不进待执行清单（列在 problems 里，result = invalid）', async () => {
    await makeFiles(dir, ['广告.txt'])
    const out = await run(req(['广告.txt'], delRule('广告')))
    expect(out.result.summary.invalid).toBe(1)
    expect(out.result.summary.success).toBe(0)
    expect(out.result.problems[0].result).toBe('invalid')
    expect(out.result.problems[0].code).toBe('E_EMPTY_NAME')
    expect(await ls(dir)).toEqual(['广告.txt'])
  })

  it('源文件已被移走时该项失败，其余照常（失败不中断整批）', async () => {
    await makeFiles(dir, ['a广告.txt', 'b广告.txt'])
    const elsewhere = await makeTempDir()
    await rename(join(dir, 'a广告.txt'), join(elsewhere, 'a广告.txt'))

    const out = await run(req(['a广告.txt', 'b广告.txt'], delRule('广告')))
    expect(out.result.summary.success).toBe(1)
    expect(out.result.summary.failed).toBe(1)
    const problem = out.result.problems.find((p) => p.fromName === 'a广告.txt')
    expect(problem?.code).toBe('E_SOURCE_MISSING')
    expect(await ls(dir)).toEqual(['b.txt'])
  })

  it('problems 超过 200 条时被截断，problemsTotal 是真实总数', async () => {
    const names = Array.from({ length: 300 }, (_, i) => `q${i}.txt`)
    await makeFiles(dir, names)
    const out = await run(req(names, collapseRule('same')))

    expect(out.result.summary.success).toBe(1)
    expect(out.result.problemsTotal).toBe(299)
    expect(out.result.problems).toHaveLength(200)
    expect(out.result.problemsTruncated).toBe(true)
  })
})

/* ── U-16 容量治理 ───────────────────────────────────────────────────── */

describe('U-16 FIFO 淘汰', () => {
  it('21 次改名后只留 20 条，最旧的被淘汰、最新的还在', async () => {
    for (let i = 0; i < 21; i++) {
      const d = await makeTempDir()
      await makeFiles(d, [`x${i}广告.txt`])
      await runRenameTask(
        {
          taskId: `t-${i}`,
          items: [{ id: '1', dirPath: d, fromName: `x${i}广告.txt`, isDir: false, attrs: { created: '', modified: '', sizeBytes: null } }],
          rule: delRule('广告'),
          date: localDateString(),
          autoResolveConflict: false,
        },
        noopProgress,
      )
    }

    const tasks = listTasks()
    expect(tasks).toHaveLength(20)
    expect(tasks.some((t) => t.id === 't-0')).toBe(false) // 最旧的被淘汰
    expect(tasks[0].id).toBe('t-20') // 最新的仍在最前
  })

  it('★ 最新任务永不淘汰（即使它一个人就超了总明细上限）', async () => {
    const big = {
      id: 't-big',
      createdAt: Date.now(),
      date: '2026-09-12',
      ruleSummary: '测试',
      status: 'active' as const,
      undoneAt: null,
      entries: Array.from({ length: 60_000 }, () => ({ dirPath: 'C:\\d', fromName: 'a', toName: 'b' })),
      counts: { total: 60_000, success: 60_000, skipped: 0, invalid: 0, failed: 0 },
    }
    await appendTask(big)

    const after = listTasks()
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe('t-big')
    // evict 幂等：再跑一次也不会把它淘汰掉
    expect(evict()).toBe(0)
  })

  it('总明细超限时从最旧整条淘汰（不切半条）', async () => {
    // 5 条 × 12000 条明细 = 60000 > 50000 → 至少淘汰 1 条
    for (let i = 0; i < 5; i++) {
      await appendTask({
        id: `t-${i}`,
        createdAt: 1_000_000 + i,
        date: '2026-09-12',
        ruleSummary: '测试',
        status: 'active',
        undoneAt: null,
        entries: Array.from({ length: 12_000 }, (_, k) => ({ dirPath: 'C:\\d', fromName: `a${k}`, toName: `b${k}` })),
        counts: { total: 12_000, success: 12_000, skipped: 0, invalid: 0, failed: 0 },
      })
    }
    const tasks = listTasks()
    const total = tasks.reduce((n, t) => n + t.entries.length, 0)

    expect(total).toBeLessThanOrEqual(50_000)
    // 每一条要么完整保留、要么整条消失 —— 不存在「被截断的半条」
    for (const t of tasks) expect(t.entries.length).toBe(12_000)
    // 最新的那条一定还在
    expect(tasks[0].id).toBe('t-4')
  })
})
