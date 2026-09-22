/**
 * 命令行验证入口（技术方案 §3.2 / §9.3，MS-1 的交付物）。
 *
 * **不依赖 Electron** —— 它直接 import `src/shared` 的纯函数内核与
 * `src/main/services/fs-scan`（后者只碰 node:fs）。这就是 PRD「MS-1 引擎先行、
 * 命令行可验证」的落地形式：界面还没写，引擎已经能被验证。
 *
 * 用法：
 *   npm run cli:verify -- --dir ./tmp-test \
 *     --rule '{"mode":"rule","rule":{"prefix":"{d}-发票-","dateEnabled":true,"seqEnabled":true,"seqPad":3,"keepOriginal":false}}' \
 *     --dry-run
 *
 * 参数：
 *   --dir <路径>      要扫描的目录（只加该目录下的直接子项，不递归，DEC-01）
 *   --rule <JSON>     规则配置（可只给片段，其余取默认值）
 *   --date <YYYY-MM-DD>  目标日期，默认本机今天（DEC-03）
 *   --auto            开启「自动加序号」
 *   --dry-run         只预览不执行（默认就是 dry-run；显式写上更清楚）
 *   --execute         真的执行改名（不加这个参数一律只预览）
 *   --limit <N>       最多处理多少项（默认 20，避免刷屏）
 */

import { promises as fsp } from 'node:fs'
import { resolve } from 'node:path'
import { resolvePaths } from '../src/main/services/fs-scan'
import { buildPreview } from '../src/shared/preview'
import { resolveItems } from '../src/shared/preview'
import { DEFAULT_RULE, type RuleConfig } from '../src/shared/types'
import { localDateString } from '../src/main/services/rename-executor'

interface Args {
  dir: string
  rule: RuleConfig
  date: string
  auto: boolean
  execute: boolean
  limit: number
}

function parseArgs(argv: string[]): Args {
  let dir = ''
  let rule: RuleConfig = { ...DEFAULT_RULE, rule: { ...DEFAULT_RULE.rule } }
  let date = localDateString()
  let auto = false
  let execute = false
  let limit = 20

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') dir = argv[++i] ?? ''
    else if (a === '--date') date = argv[++i] ?? date
    else if (a === '--auto') auto = true
    else if (a === '--execute') execute = true
    else if (a === '--dry-run') execute = false
    else if (a === '--limit') limit = Number(argv[++i] ?? 20) || 20
    else if (a === '--rule') {
      const raw = argv[++i] ?? '{}'
      try {
        const patch = JSON.parse(raw) as Partial<RuleConfig>
        rule = { ...rule, ...patch, rule: { ...rule.rule, ...(patch.rule ?? {}) } }
      } catch (err) {
        throw new Error(`--rule 不是合法 JSON：${(err as Error).message}`)
      }
    }
  }

  if (!dir) throw new Error('缺少 --dir <路径>')
  return { dir, rule, date, auto, execute, limit }
}

const STATUS_LABEL: Record<string, string> = {
  pending: '待处理',
  unchanged: '无变化',
  changed: '将变化',
  conflict: '重名冲突',
  invalid: '非法',
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const abs = resolve(args.dir)

  // 只用「该目录下的直接子项」入列 —— 不递归（DEC-01）
  const entries = await fsp.readdir(abs, { withFileTypes: true })
  const paths = entries.map((e) => resolve(abs, e.name))

  const batch = await resolvePaths({ paths, existingPaths: [] })
  // 预览与计划走的都是「算新名所需的最小信息」这一组字段（接口文档 §3.4 的形状）
  const items = batch.items.map((i) => ({
    id: i.id,
    dirPath: i.dirPath,
    fromName: i.name,
    isDir: i.isDir,
    attrs: i.attrs,
  }))

  console.log(`\n目录：${abs}`)
  console.log(`扫描：入列 ${batch.stats.accepted} 项` +
    (batch.stats.vanished ? ` · 已消失 ${batch.stats.vanished}` : '') +
    (batch.stats.overflow ? ` · 超限丢弃 ${batch.stats.overflow}` : ''))
  console.log(`日期：${args.date}（DEC-03：取执行当天）`)
  console.log(`模式：${args.rule.mode}${args.auto ? ' · 自动加序号' : ' · 冲突跳过（绝不覆盖）'}`)

  const preview = buildPreview(items, args.rule, args.date, batch.snapshot, args.auto)
  const resolved = resolveItems(items, args.rule, args.date, batch.snapshot, args.auto)

  console.log('\n' + '─'.repeat(92))
  console.log(pad('原名', 30) + pad('新名', 30) + pad('状态', 10) + '原因')
  console.log('─'.repeat(92))

  const shown = resolved.slice(0, args.limit)
  for (const r of shown) {
    console.log(
      pad(r.fromName, 30) +
        pad(r.toName || '—', 30) +
        pad(STATUS_LABEL[r.status] ?? r.status, 10) +
        (r.reason ?? ''),
    )
  }
  if (resolved.length > shown.length) {
    console.log(`… 其余 ${resolved.length - shown.length} 项略（用 --limit 调整）`)
  }
  console.log('─'.repeat(92))

  const s = preview.stats
  console.log(
    `统计：共 ${items.length} 项 · 将变化 ${s.changed} · 无变化 ${s.unchanged} · 冲突 ${s.conflict} · 非法 ${s.invalid}`,
  )
  console.log(`预览耗时：${preview.elapsedMs}ms（预算 1000 项 ≤ 200ms）`)

  const ready = resolved.filter((r) => r.outcome === 'ready')
  if (!args.execute) {
    console.log(`\n[dry-run] 不会改动任何文件。要真的执行请加 --execute（会改 ${ready.length} 项）`)
    return
  }

  if (ready.length === 0) {
    console.log('\n没有可执行项，未做任何改动。')
    return
  }

  // 真执行：复用主进程的执行器，两条路径同一套安全防护
  const { execute } = await import('../src/main/services/rename-executor')
  const out = await execute(
    { taskId: `cli-${Date.now()}`, items: ready.map((r) => ({
      id: r.id,
      dirPath: r.dirPath,
      fromName: r.fromName,
      isDir: r.isDir,
      attrs: items.find((x) => x.id === r.id)?.attrs ?? { created: '', modified: '', sizeBytes: null },
    })), rule: args.rule, date: args.date, autoResolveConflict: args.auto },
    () => {},
    new AbortController().signal,
  )
  console.log(
    `\n执行完成：成功 ${out.result.summary.success} · 跳过 ${out.result.summary.skipped} · 非法 ${out.result.summary.invalid} · 失败 ${out.result.summary.failed}（${out.result.elapsedMs}ms）`,
  )
  for (const p of out.result.problems.slice(0, 10)) {
    console.log(`  ✗ ${p.fromName} → ${p.attemptedName}｜${p.reason}`)
  }
}

/** 按显示宽度粗略对齐（中文按 2 列算）*/
function pad(text: string, width: number): string {
  const w = [...text].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e7f ? 2 : 1), 0)
  const clipped = w > width ? `${[...text].slice(0, width - 1).join('')}…` : text
  const cw = [...clipped].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e7f ? 2 : 1), 0)
  return clipped + ' '.repeat(Math.max(1, width - cw + 2))
}

main().catch((err) => {
  console.error('\n验证失败：', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
