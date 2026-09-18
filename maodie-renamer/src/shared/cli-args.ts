/**
 * 命令行参数解析（P2-C · F-15）。
 *
 * 放共享层：纯函数、不 import electron / fs / path，所以 `node --test` 能直接跑它 ——
 * 命令行最容易出错的地方就是「参数解析」，而它不该只有打包成 exe 之后才能验。
 *
 * ## 两条安全底线（与界面完全一致）
 * 1. **默认不覆盖任何已有文件**（`--auto-seq` 才改成自动加序号，默认跳过）
 * 2. **`--dry-run` 是默认行为**：不传 `--yes` 只打印将要做的改动。
 *    命令行没有预览界面，所以默认必须是只读的 —— 让人「先看一眼再决定」，
 *    而不是「一不小心就跑完了」。这是界面里「先预览、再执行」的延伸。
 *
 * ## 与 `scripts/cli-verify.ts` 的区别（别混）
 * 那个是 **MS-1 的开发者引擎验证脚本**（`npm run cli:verify`，经 tsx 跑、不进打包产物），
 * 参数名是 `--rule <JSON>` / `--execute`。本文件是**面向用户的**命令行模式，
 * 参数以 `P2-C轻量设计确认.md` §3.3 的草案为准（`--delete` / `--yes`）。
 */
import { DEFAULT_RULE, type DateFormat, type RuleConfig } from './types'

export interface CliOptions {
  dir: string
  rule: RuleConfig
  /** 显式 `--yes` 才真改；不传只打印将要做的改动 */
  yes: boolean
  autoSeq: boolean
  caseSensitive: boolean
  /** 预览表格的打印上限，默认 50（避免刷屏）*/
  limit: number
}

/** 全部合法开关。用于判断「这是不是命令行模式」——避免把 Electron 自己的
 *  `--inspect` / `--remote-debugging-port` 之类误当成我们的调用。 */
const KNOWN_FLAGS = new Set([
  '--rename',
  '--help',
  '--dry-run',
  '--yes',
  '--dir',
  '--delete',
  '--replace',
  '--prefix',
  '--suffix',
  '--seq',
  '--date',
  '--date-format',
  '--regex',
  '--lower',
  '--upper',
  '--capitalize',
  '--auto-seq',
  '--case-sensitive',
  '--limit',
])

export function isCliInvocation(argv: string[]): boolean {
  return argv.some((a) => KNOWN_FLAGS.has(a))
}

export const CLI_USAGE = `耄耋改名 · 命令行模式

用法：
  maodie.exe --rename --dir "<目录>" [规则] [--yes]

规则（三选一，与界面完全一致）：
  --delete "<文本>"
  --replace "<查找>" "<替换为>"
  --prefix "<前缀>" --suffix "<后缀>" --seq --date --date-format "<格式>"

P1 能力：
  --regex                             正则匹配
  --lower | --upper | --capitalize    大小写转换

安全相关：
  --auto-seq       冲突时自动加序号（默认不加 = 跳过）
  --case-sensitive 区分大小写
  --limit <N>      预览表格最多打印多少行（默认 50）

★ 默认不覆盖任何已有文件
★ dry-run 是默认行为：不传 --yes 只打印将要做的改动，必须显式 --yes 才真正改名

退出码：
  0 = 成功（含 dry-run）   1 = 执行时有失败项   2 = 参数错 / 程序正在运行

示例：
  maodie.exe --rename --dir "D:\\下载\\素材" --delete "广告" --yes
`

/**
 * `--date-format` 的白名单。
 *
 * P3-1 从 3 档扩到 5 档：新格式对「启用日期」同时生效，命令行自然也要认。
 *
 * ⚠️ 与设计文档 §7.3 第 3 条的一处出入（已核实）：那里写的是「`--rule '{...}'`
 *    的解析同样要认这 6 个字段与 `'at'`」—— 但**本文件从来没有 `--rule` 这个开关**
 *    （参数是 `--delete` / `--prefix` / `--seq` 这类，逐个落进 `RuleConfig`）。
 *    真正带 `--rule <JSON>` 的是开发用的 `scripts/cli-verify.ts`，它把 JSON 直接
 *    当 `RuleConfig` 用，多出来的字段本来就跟着走。
 *    所以这里**只需要补日期样式白名单**：新增的 6 个字段由 `DEFAULT_RULE` 的展开
 *    自动带上默认值，命令行也就天然保持 P0/P1 的老行为。
 */
const DATE_FORMATS: readonly string[] = [
  'YYYY-MM-DD',
  'YYYYMMDD',
  'YYYY年MM月DD日',
  'MM月DD日',
  'YYMMDD',
]

export function parseCliArgs(
  argv: string[],
): { ok: true; options: CliOptions } | { ok: false; error: string } {
  let i = 0
  let dir = ''
  let limit = 50
  let yes = false
  let dryRun = false
  let autoSeq = false
  let caseSensitive = false
  let ruleKind: 'delete' | 'replace' | 'basic' | null = null

  const rule: RuleConfig = {
    ...DEFAULT_RULE,
    delete: { ...DEFAULT_RULE.delete },
    replace: { ...DEFAULT_RULE.replace },
    rule: { ...DEFAULT_RULE.rule },
  }

  /** 取当前开关后面的一个值（不消费时返回错误 —— 缺值必须报错，不能当空串）*/
  const val = (): { v: string } | { error: string } => {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) return { error: `${argv[i]} 后面缺少值` }
    i += 1
    return { v }
  }

  while (i < argv.length) {
    const a = argv[i]

    if (a === '--rename' || a === '--help') {
      i += 1
      continue
    }
    if (a === '--yes') {
      yes = true
      i += 1
      continue
    }
    if (a === '--dry-run') {
      dryRun = true
      i += 1
      continue
    }
    if (a === '--auto-seq') {
      autoSeq = true
      i += 1
      continue
    }
    if (a === '--case-sensitive') {
      caseSensitive = true
      i += 1
      continue
    }
    if (a === '--regex') {
      rule.regexEnabled = true
      i += 1
      continue
    }
    if (a === '--lower' || a === '--upper' || a === '--capitalize') {
      rule.caseTransform = a === '--lower' ? 'lower' : a === '--upper' ? 'upper' : 'capitalize'
      i += 1
      continue
    }
    if (a === '--seq' || a === '--date') {
      // 「三选一」在界面里由 RuleMode 保证互斥，命令行必须同样严格 ——
      // 否则 `--delete x --seq` 会被静默接受，而界面根本无法表达这种组合
      if (ruleKind !== null && ruleKind !== 'basic') {
        return { ok: false, error: `${a} 与 --delete / --replace 不能同时使用（规则三选一）` }
      }
      ruleKind = 'basic'
      if (a === '--seq') rule.rule.seqEnabled = true
      else rule.rule.dateEnabled = true
      i += 1
      continue
    }

    if (a === '--dir') {
      const r = val()
      if ('error' in r) return { ok: false, error: r.error }
      dir = r.v
      i += 1
      continue
    }
    if (a === '--delete') {
      if (ruleKind !== null && ruleKind !== 'delete') {
        return { ok: false, error: '--delete 与 --replace / 前后缀不能同时使用' }
      }
      const r = val()
      if ('error' in r) return { ok: false, error: r.error }
      ruleKind = 'delete'
      rule.mode = 'delete'
      rule.delete.text = r.v
      i += 1
      continue
    }
    if (a === '--replace') {
      if (ruleKind !== null && ruleKind !== 'replace') {
        return { ok: false, error: '--replace 与 --delete / 前后缀不能同时使用' }
      }
      const r1 = val()
      if ('error' in r1) return { ok: false, error: r1.error }
      const r2 = val()
      if ('error' in r2) return { ok: false, error: '--replace 需要两个值：<查找> <替换为>' }
      ruleKind = 'replace'
      rule.mode = 'replace'
      rule.replace.find = r1.v
      rule.replace.to = r2.v
      i += 1
      continue
    }
    if (a === '--prefix' || a === '--suffix' || a === '--date-format') {
      if (ruleKind !== null && ruleKind !== 'basic') {
        return {
          ok: false,
          error: `${a} 与 --delete / --replace 不能同时使用（规则三选一）`,
        }
      }
      const r = val()
      if ('error' in r) return { ok: false, error: r.error }
      if (a === '--date-format' && !DATE_FORMATS.includes(r.v)) {
        return {
          ok: false,
          error: `--date-format 只支持 ${DATE_FORMATS.join(' / ')}（收到 ${r.v}）`,
        }
      }
      ruleKind = 'basic'
      if (a === '--prefix') rule.rule.prefix = r.v
      else if (a === '--suffix') rule.rule.suffix = r.v
      else rule.rule.dateFormat = r.v as DateFormat
      i += 1
      continue
    }
    if (a === '--limit') {
      const r = val()
      if ('error' in r) return { ok: false, error: r.error }
      const n = Number(r.v)
      limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : 50
      i += 1
      continue
    }

    return { ok: false, error: `未知参数 ${a}（用 --help 看用法）` }
  }

  if (dir === '') return { ok: false, error: '缺少 --dir <路径>' }
  if (ruleKind === null) {
    return { ok: false, error: '至少要给一条规则（--delete / --replace / --prefix 等）' }
  }
  if (yes && dryRun) return { ok: false, error: '--yes 与 --dry-run 不能同时使用' }

  rule.autoResolveConflict = autoSeq
  rule.caseSensitive = caseSensitive
  return { ok: true, options: { dir, rule, yes, autoSeq, caseSensitive, limit } }
}
