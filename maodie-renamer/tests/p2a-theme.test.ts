/**
 * P2-A（设置面 + 深色模式）—— 令牌与主题的单测。
 *
 * 运行：`npm run test:core`
 *   = `node --import tsx --test tests/p1-rules.test.ts tests/p2a-theme.test.ts`
 *
 * 规矩同 P1：不引入第三方框架，只用 `node:test` + `node:assert`。
 *
 * 这个文件里最值钱的是第一条（TC-32）。「深色模式有没有漏改的地方」如果靠人眼
 * 在 5000 行 CSS 里找，一定会漏；做成可执行检查之后，改漏了当场就红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { THEMES, DEFAULT_THEME, WINDOW_BG, normalizeTheme, windowBackgroundFor } from '../src/shared/theme'
import { THEME_OPTIONS } from '../src/shared/labels'

/* ── 定位工程根目录 ──────────────────────────────────────────────────
 * 跑壳（tests/run-unit.js）固定以工程根为 cwd 启动 node —— 所以这里直接用
 * cwd，并且先确认它真的是工程根，免得在别处跑出一个「假绿」。 */
const ROOT = process.cwd()
assert.ok(
  fs.existsSync(path.join(ROOT, 'package.json')),
  `单测必须在工程根目录下运行（当前 cwd = ${ROOT}）—— 用 npm run test:core`,
)

const STYLES = path.join(ROOT, 'src', 'renderer', 'src', 'styles')
const TOKENS_CSS = path.join(STYLES, 'tokens.css')

/* ══ TC-32 令牌覆盖率 ══════════════════════════════════════════════════ */

/** 色值字面量：`#rgb` / `#rrggbb` / `#rrggbbaa` / `rgb(...)` / `rgba(...)` */
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g

/**
 * 允许出现色值的唯一非令牌文件。
 *
 * `WINDOW_BG` 是主进程建窗口那一帧用的底色 —— 那时 CSS 还没加载，所以必须有一份
 * TS 拷贝。它不是「漏改」，而是**被第 3 条测试钉在 tokens.css 上**：
 * 那两个值改了 CSS 却忘了改这里，第 3 条会红。白名单 + 钉子，才敢开这个口子。
 */
const ALLOWLIST = new Set(['src/shared/theme.ts'])

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(css|vue|ts)$/.test(e.name)) out.push(p)
  }
  return out
}

/** 去掉注释：`//` 行注释与 `/* … *\/` 块注释（含多行）。注释里提到色值是允许的。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

test('TC-32 令牌覆盖率：tokens.css 之外不允许出现任何色值字面量', () => {
  const offenders: string[] = []

  for (const abs of walk(path.join(ROOT, 'src'))) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/')
    if (rel === 'src/renderer/src/styles/tokens.css') continue
    if (ALLOWLIST.has(rel)) continue

    const body = stripComments(fs.readFileSync(abs, 'utf8'))
    body.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(COLOR_LITERAL)) {
        offenders.push(`${rel}:${i + 1}  ${m[0]}`)
      }
    })
  }

  assert.deepEqual(
    offenders,
    [],
    `有 ${offenders.length} 处色值没走令牌（应改成 var(--md-…)）：\n${offenders.join('\n')}`,
  )
})

/* ══ 深色块完整性 ═════════════════════════════════════════════════════ */

/** 抽出 tokens.css 里所有 `--md-x: value;` 声明，并按「在深色媒体查询之前/之后」分组 */
function readTokens(): { light: Map<string, string>; dark: Map<string, string> } {
  // ★ 先去掉注释再定位：文件头那段说明里也写了 `@media (prefers-color-scheme: dark)`，
  //   不去注释就会把「讲解」当成真的媒体查询，整份文件都被判成深色块。
  const css = stripComments(fs.readFileSync(TOKENS_CSS, 'utf8'))
  const cut = css.search(/^@media \(prefers-color-scheme: dark\)/m)
  assert.ok(cut > 0, 'tokens.css 里找不到深色媒体查询块 —— 文件结构变了，本测试需要同步')

  const light = new Map<string, string>()
  const dark = new Map<string, string>()
  const re = /(--md-[a-z0-9-]+)\s*:\s*([^;]+);/g
  for (const m of css.matchAll(re)) {
    // 声明起点在 cut 之前 → 浅色块
    const target = (m.index ?? 0) < cut ? light : dark
    target.set(m[1], m[2].trim())
  }
  return { light, dark }
}

/**
 * 两主题**同值**、因而不需要在深色块里重复声明的令牌。
 * 少了这条清单，本测试会逼着人把「不变的品牌橘」也抄一遍 —— 那反而增加漂移面。
 *
 * ★ P3-9（DEC-31）把这六条从清单里**移出去**了：品牌橘三色、ok、warn、
 *   on-brand / on-danger 现在**两主题不同值**，必须各自在深色块里有值。
 *   不是放宽断言 —— 清单本来只是「哪些令牌不需要写两遍」的声明式数据，
 *   而且移出去之后**要求更严**（这些令牌现在漏写深色值就会红）。
 *   前四条的历史值见 P3-9 设计确认 §11「被推翻的两条规矩」。
 */
const SAME_IN_BOTH = new Set([
  '--md-switch-thumb',
  '--md-confetti-1',
  '--md-confetti-2',
])

test('深色块完整性：浅色块里每个「色值型」令牌都要在深色块有个值', () => {
  const { light, dark } = readTokens()
  const isColor = (v: string) => /^#[0-9a-fA-F]{3,8}$/.test(v) || /^rgba?\(/.test(v)

  const missing = [...light.entries()]
    .filter(([name, value]) => isColor(value) && !SAME_IN_BOTH.has(name) && !dark.has(name))
    .map(([name, value]) => `${name}（浅色 ${value}）没有深色值`)

  assert.deepEqual(missing, [], `深色块漏了 ${missing.length} 个令牌：\n${missing.join('\n')}`)
})

test('深色块不许多写不存在的令牌（防拼错名字）', () => {
  const { light, dark } = readTokens()
  const unknown = [...dark.keys()].filter((name) => !light.has(name))

  assert.deepEqual(unknown, [], `深色块里这些令牌在浅色块里不存在（拼错了？）：\n${unknown.join('\n')}`)
})

test('SAME_IN_BOTH 清单本身不许过期：列进去的令牌就不该有深色值', () => {
  const { dark } = readTokens()
  const stale = [...SAME_IN_BOTH].filter((name) => dark.has(name))

  assert.deepEqual(
    stale,
    [],
    `这些令牌被列进 SAME_IN_BOTH，却又有深色值 —— 两者只能留一个：\n${stale.join('\n')}`,
  )
})

/* ══ 主进程窗口底色 ↔ tokens.css（TC-32 的那个盲区）═══════════════════ */

test('主进程窗口底色常量与 tokens.css 的 --md-bg-cream 逐字节一致（含深色）', () => {
  const { light, dark } = readTokens()

  assert.equal(
    light.get('--md-bg-cream')?.toLowerCase(),
    WINDOW_BG.light.toLowerCase(),
    '浅色窗口底色对不上：改了 tokens.css 的 --md-bg-cream，就要同步 src/shared/theme.ts 的 WINDOW_BG.light',
  )
  assert.equal(
    dark.get('--md-bg-cream')?.toLowerCase(),
    WINDOW_BG.dark.toLowerCase(),
    '深色窗口底色对不上：改了 tokens.css 深色块的 --md-bg-cream，就要同步 WINDOW_BG.dark',
  )
})

test('windowBackgroundFor 按深浅色返回对应底色', () => {
  assert.equal(windowBackgroundFor(false), WINDOW_BG.light)
  assert.equal(windowBackgroundFor(true), WINDOW_BG.dark)
})

/* ══ 主题三态 ═════════════════════════════════════════════════════════ */

test('normalizeTheme：三个合法值原样通过，其余一律回落到默认', () => {
  for (const t of THEMES) assert.equal(normalizeTheme(t), t)

  for (const bad of ['LIGHT', 'Dark', 'auto', '', null, undefined, 42, {}, []]) {
    assert.equal(normalizeTheme(bad), DEFAULT_THEME, `野值 ${JSON.stringify(bad)} 应回落到 ${DEFAULT_THEME}`)
  }
})

test('默认主题是「始终浅色」—— 软件在任何机器上首屏都长一样', () => {
  assert.equal(DEFAULT_THEME, 'light')
})

test('THEME_OPTIONS 与 THEMES 一一对应，且顺序就是界面顺序（跟随系统 / 浅色 / 深色）', () => {
  assert.deepEqual(
    THEME_OPTIONS.map((o) => o.value),
    [...THEMES],
    'THEME_OPTIONS 的取值或顺序与 THEMES 不一致 —— 界面顺序是设计稿定死的',
  )
  for (const o of THEME_OPTIONS) assert.ok(o.label.length > 0, `${o.value} 缺中文标签`)
})
