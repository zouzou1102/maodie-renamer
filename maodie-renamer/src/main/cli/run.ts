/**
 * 命令行模式核心（P2-C · F-15）。
 *
 * ★ 本文件**不 import electron** —— 所以 `node --test` 能直接跑它，
 *   不需要启动界面就能验「命令行的安全底线」。这是把它从 `cli/index.ts`
 *   拆出来的唯一理由。
 *
 * ## 安全底线（与界面**完全一致**，逐条对应）
 * 1. 不传 `--yes` 一律 dry-run，**不碰任何文件** —— 命令行没有预览界面，
 *    所以默认必须是只读的（与界面里「先预览、再执行」同一条原则）。
 * 2. 真执行**复用主进程的 `execute()`** → 两阶段改名 / 扩展名保护 / 冲突跳过
 *    / 绝不覆盖，与界面走的是同一套代码，不是另写一份。
 * 3. 改名**写入历史记录** → 能在界面的历史页里撤销。
 *    ⚠️ 所以 `userDataDir` 必须与界面版**完全一致**（同一个 `MaoDieRenamer` 目录），
 *       否则命令行改完的文件在界面里撤不回来。
 *
 * ## 退出码
 *   0 = 成功（含 dry-run）；1 = 执行时有失败项；2 = 参数错 / 读不到目录
 */
import { promises as fsp } from 'node:fs'
import type { Dirent } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { CLI_USAGE, parseCliArgs, type CliOptions } from '@shared/cli-args'
import { buildPreview, resolveItems, type ResolveInput } from '@shared/preview'
import { buildRuleSummary } from '@shared/rule-summary'
import { assignmentsOf, buildMapping, detectColumns, readDelimitedTable } from '@shared/table-map'
import type { RuleConfig } from '@shared/types'
import { readXlsx } from '@shared/xlsx-read'
import { resolvePaths } from '../services/fs-scan'
import { execute, localDateString } from '../services/rename-executor'
import { appendTask, buildTask, loadHistory } from '../services/history-store'
import { initStorage } from '../services/storage'

export interface CliDeps {
  /** 正常输出（可注入，便于单测抓取） */
  out: (line: string) => void
  /** 错误输出 */
  err: (line: string) => void
  /** 数据目录 —— 与界面版同一个，否则历史对不上 */
  userDataDir: string
}

const STATUS_LABEL: Record<string, string> = {
  pending: '待处理',
  unchanged: '无变化',
  changed: '将变化',
  conflict: '重名冲突',
  invalid: '非法',
}

/** 按显示宽度粗略对齐（中文按 2 列算）—— 同 `scripts/cli-verify.ts` 的做法 */
function pad(text: string, width: number): string {
  const w = [...text].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e7f ? 2 : 1), 0)
  const clipped = w > width ? `${[...text].slice(0, width - 1).join('')}…` : text
  const cw = [...clipped].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e7f ? 2 : 1), 0)
  return clipped + ' '.repeat(Math.max(1, width - cw + 2))
}

/**
 * 模式的一句话描述。★ P3-5：五模式**各自成文** —— 不再用 `else` 兜底
 * （从前那个 `else` 会把任意非删除/替换的模式都说成「前后缀」，选「插入」也看不出来）。
 */
function modeText(r: RuleConfig, table: string): string {
  switch (r.mode) {
    case 'delete':
      return `删除「${r.delete.text}」`
    case 'replace':
      return `替换「${r.replace.find}」→「${r.replace.to}」`
    case 'insert':
      return `在第 ${Math.max(0, r.insert.at)} 个字后插入「${r.insert.text}」`
    case 'import':
      return `按表格改（${table === '' ? '未指定表格' : table}）`
    case 'rule':
      return `前后缀「${r.rule.prefix}…${r.rule.suffix}」`
    default: {
      // ★ 穷尽兜底：加模式时「忘了写」变编译期错误，而不是静默说成别的东西
      const never: never = r.mode
      return never
    }
  }
}

function describeRule(o: CliOptions): string {
  const r = o.rule
  const parts: string[] = [modeText(r, o.table)]
  if (r.regexEnabled) parts.push('正则')
  if (r.caseTransform !== 'none') parts.push(`大小写:${r.caseTransform}`)
  parts.push(o.autoSeq ? '自动加序号' : '冲突跳过（绝不覆盖）')
  return parts.join(' · ')
}

/**
 * ★ P3-5：导入模式 —— 读表格、按表头自动识别列、把匹配上的项挂上 `override`。
 *
 * 与界面走**同一套纯逻辑**（`shared/table-map.ts` 的 `detectColumns` / `buildMapping`），
 * 所以命令行与界面的「怎么读表」不可能跑偏（设计 §13.④：命令行与界面完全一致）。
 * 匹配不上的项不挂 override → 引擎那边保持原名不动（设计 §1.5）。
 */
async function applyTable(
  tablePath: string,
  items: ResolveInput[],
  err: (line: string) => void,
): Promise<{ ok: boolean; items: ResolveInput[] }> {
  let bytes: Uint8Array
  try {
    bytes = await fsp.readFile(tablePath)
  } catch (e) {
    err(`读不到表格：${tablePath}\n  ${e instanceof Error ? e.message : String(e)}`)
    return { ok: false, items }
  }
  const ext = extname(tablePath).toLowerCase()
  let rows
  try {
    rows =
      ext === '.xlsx'
        ? readXlsx(bytes, { inflate: inflateRawSync }).rows
        : readDelimitedTable(bytes, ext === '.csv' ? ',' : '\t').rows
  } catch (e) {
    err(`表格读不动（${ext === '' ? '没有扩展名' : ext}）：${e instanceof Error ? e.message : String(e)}`)
    return { ok: false, items }
  }

  const guess = detectColumns(rows)
  const files = items.map((i) => ({ id: i.id, name: i.fromName, isDir: i.isDir }))
  const mapping = buildMapping(
    rows,
    { nameCol: guess.nameCol, newCol: guess.newCol, headerRow: guess.headerRow },
    files,
  )
  // 整体拒绝（如没指定「原文件名」列）→ 明确报错，**不猜**（与界面同一条纪律）
  if (mapping.rejected !== '') {
    err(`表格用不了：${mapping.rejected}`)
    return { ok: false, items }
  }

  const sourceTable = basename(tablePath)
  const byId = new Map(assignmentsOf(mapping).map((a) => [a.id, a.stem]))
  return {
    ok: true,
    items: items.map((i) =>
      byId.has(i.id) ? { ...i, override: { stem: byId.get(i.id) as string, sourceTable } } : i,
    ),
  }
}

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  if (argv.includes('--help')) {
    deps.out(CLI_USAGE)
    return 0
  }

  const parsed = parseCliArgs(argv)
  if (!parsed.ok) {
    deps.err(`参数有问题：${parsed.error}\n\n${CLI_USAGE}`)
    return 2
  }
  const o = parsed.options
  const abs = resolve(o.dir)

  /* ── 入列：只取该目录下的直接子项，**不递归**（DEC-01）────────────── */
  let dirents: Dirent[]
  try {
    dirents = await fsp.readdir(abs, { withFileTypes: true })
  } catch (err) {
    deps.err(`读不到目录：${abs}\n  ${err instanceof Error ? err.message : String(err)}`)
    return 2
  }
  const batch = await resolvePaths({
    paths: dirents.map((e) => resolve(abs, e.name)),
    existingPaths: [],
  })
  let items: ResolveInput[] = batch.items.map((i) => ({
    id: i.id,
    dirPath: i.dirPath,
    fromName: i.name,
    isDir: i.isDir,
    attrs: i.attrs,
  }))

  // ★ P3-5：导入模式 —— 先读表格、把匹配上的项挂上 override（其余保持原名不动）。
  if (o.rule.mode === 'import') {
    const t = await applyTable(o.table, items, deps.err)
    if (!t.ok) return 2
    items = t.items
  }

  const date = localDateString() // DEC-03：日期取执行当天
  const preview = buildPreview(items, o.rule, date, batch.snapshot, o.autoSeq)
  const resolved = resolveItems(items, o.rule, date, batch.snapshot, o.autoSeq)

  deps.out('')
  deps.out(`目录：${abs}`)
  deps.out(`规则：${describeRule(o)}`)
  deps.out(`日期：${date}`)
  deps.out('')
  const line = '─'.repeat(84)
  deps.out(line)
  deps.out(pad('原名', 34) + pad('新名', 34) + pad('状态', 10) + '原因')
  deps.out(line)
  const shown = resolved.slice(0, o.limit)
  for (const r of shown) {
    deps.out(
      pad(r.fromName, 34) +
        pad(r.toName || '—', 34) +
        pad(STATUS_LABEL[r.status] ?? r.status, 10) +
        (r.reason ?? ''),
    )
  }
  if (resolved.length > shown.length) {
    deps.out(`… 其余 ${resolved.length - shown.length} 项未显示（用 --limit 调整）`)
  }
  deps.out(line)
  const s = preview.stats
  deps.out(
    `统计：共 ${items.length} 项 · 将变化 ${s.changed} · 无变化 ${s.unchanged} · 冲突 ${s.conflict} · 非法 ${s.invalid}`,
  )
  deps.out('')

  const ready = resolved.filter((r) => r.outcome === 'ready')

  /* ── 安全底线 1：不传 --yes 就到此为止 ───────────────────────────── */
  if (!o.yes) {
    deps.out('[dry-run] 不会改动任何文件。确认无误后加 --yes 真正执行。') 
    return 0
  }

  if (ready.length === 0) {
    deps.out('没有可执行项，未做任何改动。')
    return 0
  }

  /* ── 安全底线 2 + 3：复用界面同一套执行器，并把结果写进历史 ────────── */
  // ★ 必须先 loadHistory()：appendTask 是在内存列表前面插一条再整体落盘，
  //   不先读一遍就会把用户已有的历史**整体覆盖掉**。
  initStorage(deps.userDataDir)
  await loadHistory()

  const taskId = `cli-${Date.now()}`
  const outcome = await execute(
    {
      taskId,
      items: ready.map((r) => ({
        id: r.id,
        dirPath: r.dirPath,
        fromName: r.fromName,
        isDir: r.isDir,
        attrs: items.find((x) => x.id === r.id)?.attrs ?? { created: '', modified: '', sizeBytes: null },
      })),
      rule: o.rule,
      date,
      autoResolveConflict: o.autoSeq,
    },
    () => {},
    new AbortController().signal,
  )

  if (outcome.successEntries.length > 0) {
    const task = buildTask(taskId, date, buildRuleSummary(o.rule), outcome.result, outcome.successEntries)
    const saved = await appendTask(task)
    if (!saved) deps.err('⚠️ 改名记录未能保存，本次改名无法在界面里撤销')
  }

  const sum = outcome.result.summary
  deps.out(
    `执行完成：成功 ${sum.success} · 跳过 ${sum.skipped} · 非法 ${sum.invalid} · 失败 ${sum.failed}（${outcome.result.elapsedMs}ms）`,
  )
  for (const p of outcome.result.problems.slice(0, 10)) {
    deps.err(`  ✗ ${p.fromName} → ${p.attemptedName}｜${p.reason}`)
  }
  if (sum.success > 0) {
    deps.out('（本次改名已写入历史记录，可在界面的「撤销 / 历史记录」里撤销）')
  }
  return sum.failed > 0 ? 1 : 0
}
