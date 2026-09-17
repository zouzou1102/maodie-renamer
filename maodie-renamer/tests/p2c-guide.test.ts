/**
 * P2-C 增量（命令行教程卡片）—— 单测。
 *
 * 运行：`npm run test:core`（**必须显式传本文件**，见 package.json 的 test:core）
 *
 * 这个文件盯三件事：
 *  1. 三张示意图的 SVG 是否**结构合法**（有 viewBox、能缩放、不留死色）
 *  2. 示意图的专用色是否**只来自 `CLI_DEMO_COLORS`**（不许在 SVG 里另写色值）
 *  3. 教程文案是否**真的说人话** —— 没有占位符、没有面向程序员的黑话
 *
 * ⚠️ 被验的数据（三张图 + 文案）住在 `src/shared/cli-guide.ts`。
 *    它**原本在 `src/renderer/src/assets/`**，就因为这个文件够不着渲染层目录
 *    （`tsconfig.node.json` 的 include 里没有 src/renderer），
 *    单测 import 会直接编译失败 —— 于是它虽然写了，却**从来没被跑过**。
 *    挪到 shared/ 才真正可验证（同 `regex-cheatsheet.ts` 的理由）。
 *
 * 规矩同前：只用 `node:test` + `node:assert`，不引入第三方框架。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { CLI_DEMO_COLORS } from '../src/shared/theme'
import { CLI_GUIDE_STEPS, CLI_GUIDE_INTRO } from '../src/shared/cli-guide'

const ROOT = process.cwd()
assert.ok(
  fs.existsSync(path.join(ROOT, 'package.json')),
  `单测必须在工程根目录下运行（当前 cwd = ${ROOT}）—— 用 npm run test:core`,
)

/* ══ 1. SVG 结构 ══════════════════════════════════════════════════════ */

test('三张示意图都齐、都有标题与说明文字', () => {
  assert.equal(CLI_GUIDE_STEPS.length, 3, '教程必须是三步 —— 多一步小白记不住，少一步讲不清')

  for (const [i, s] of CLI_GUIDE_STEPS.entries()) {
    assert.ok(s.title.length > 0, `第 ${i + 1} 张图缺标题`)
    assert.ok(s.body.length > 0, `第 ${i + 1} 张图缺说明文字`)
    assert.ok(s.svg.length > 0, `第 ${i + 1} 张图缺 SVG`)
  }
})

test('每张 SVG 都带 viewBox —— 没有它就不能随容器缩放', () => {
  for (const s of CLI_GUIDE_STEPS) {
    assert.match(
      s.svg,
      /viewBox="[\d.\s-]+"/,
      `「${s.title}」的 SVG 没有 viewBox —— 切图规范要求必须带（否则容器一变它就溢出）`,
    )
  }
})

test('SVG 根元素是 <svg> 且不含脚本 / 外链 —— 它是内联进 DOM 的', () => {
  for (const s of CLI_GUIDE_STEPS) {
    const head = s.svg.trimStart().slice(0, 40)
    assert.ok(head.startsWith('<svg'), `「${s.title}」的 SVG 必须以 <svg 开头，实际是：${head}`)
    assert.ok(!/<script/i.test(s.svg), `「${s.title}」的 SVG 里不许有 <script>`)
    assert.ok(!/<image\b/i.test(s.svg), `「${s.title}」的 SVG 不许引用外部图片（打包后路径会失效）`)
  }
})

/* ══ 2. 色值纪律 ══════════════════════════════════════════════════════ */

/** 色值字面量（与 TC-32 同一套口径）*/
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g

test('示意图里的色值只允许来自 CLI_DEMO_COLORS —— 不许在 SVG 里另写', () => {
  const allowed = new Set(Object.values(CLI_DEMO_COLORS).map((v) => v.toLowerCase()))
  const offenders: string[] = []

  for (const s of CLI_GUIDE_STEPS) {
    for (const m of s.svg.matchAll(COLOR_LITERAL)) {
      if (!allowed.has(m[0].toLowerCase())) offenders.push(`${s.title}: ${m[0]}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `这些色值不在 CLI_DEMO_COLORS 里（示意图的色值必须单一来源）：\n${offenders.join('\n')}`,
  )
})

test('CLI_DEMO_COLORS 三个值本身是合法色值，且黑底明显比字暗', () => {
  const { screen, screenInk, screenBar } = CLI_DEMO_COLORS

  for (const [k, v] of Object.entries(CLI_DEMO_COLORS)) {
    assert.match(v, /^#[0-9a-fA-F]{6}$/, `${k} 不是六位十六进制色值：${v}`)
  }

  const lum = (hex: string): number => {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }

  assert.ok(
    lum(screen) < 40,
    `命令提示符示意图的底色要**真的是黑的**（现在亮度 ${lum(screen).toFixed(1)}）—— ` +
      '它不是「深色主题色」，是「现实里那台机器的颜色」',
  )
  assert.ok(
    lum(screenInk) > 140,
    `示意图上的字要够亮（现在亮度 ${lum(screenInk).toFixed(1)}）`,
  )
  assert.ok(
    lum(screenBar) > lum(screen) && lum(screenBar) < lum(screenInk),
    '标题栏亮度要夹在底色与文字之间，否则看不出是「窗口」',
  )
})

test('★ 示意图色不随主题变 —— 它画的是现实里的命令行窗口', () => {
  // 断言这两个值与「跟随主题」无关：无论深浅色，命令行窗口都是黑的。
  // 如果将来有人把它们挪进 tokens.css 的深色块，这条会红。
  const tokensPath = path.join(ROOT, 'src', 'renderer', 'src', 'styles', 'tokens.css')
  const css = fs.readFileSync(tokensPath, 'utf8')

  for (const [name, value] of Object.entries(CLI_DEMO_COLORS)) {
    assert.ok(
      !css.includes(value),
      `CLI_DEMO_COLORS.${name}（${value}）出现在 tokens.css 里了 —— ` +
        '它不该是主题令牌：主题令牌会随深浅色翻，而命令行窗口永远是黑的',
    )
  }
})

/* ══ 3. 文案 ══════════════════════════════════════════════════════════ */

test('教程文案：不许留占位符 / 待办', () => {
  const all = [CLI_GUIDE_INTRO, ...CLI_GUIDE_STEPS.flatMap((s) => [s.title, s.body])]

  for (const t of all) {
    assert.ok(!/TBD|TODO|待补|待定|XXX/i.test(t), `文案里还留着占位符：${t}`)
  }
})

test('教程文案：三步必须都说清「做什么」，不许只有名词', () => {
  const all = CLI_GUIDE_STEPS.map((s) => s.body)

  // 每步的说明至少 12 个字 —— 一两个词不算教程
  for (const [i, b] of all.entries()) {
    assert.ok(b.length >= 12, `第 ${i + 1} 步的说明太短（${b.length} 字），小白看不懂：${b}`)
  }
})

test('教程第一步必须告诉小白「怎么打开命令行」—— 这是最大的门槛', () => {
  const first = CLI_GUIDE_STEPS[0]
  const text = `${first.title}${first.body}`

  assert.ok(
    /Win|win|⊞|开始菜单/.test(text),
    '第一步没提怎么打开命令行。Win+R 是这个功能对小白最大的门槛，必须写清',
  )
  assert.ok(/cmd|命令提示符/i.test(text), '第一步要写出「命令提示符 / cmd」这个名字，否则小白不知道找什么')
})

test('教程必须提「先不加 --yes 试一遍」—— 否则等于教人盲改', () => {
  const allText = CLI_GUIDE_STEPS.map((s) => `${s.title}${s.body}`).join('\n')

  assert.ok(allText.includes('--yes'), '教程里要出现 --yes，因为它是「真改」的那个开关')
  assert.ok(
    /试|预览|先看/.test(allText),
    '教程没说「先试一遍再真改」—— 命令行没有预览界面，这一步省了就是教人盲改',
  )
})
