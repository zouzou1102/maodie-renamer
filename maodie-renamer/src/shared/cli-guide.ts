/**
 * 「命令行」教程卡片的三张示意图与文案（P2-C 增量）。
 *
 * ══ 为什么放 `shared/` 而不是渲染层（原来是 assets/cli-guide.ts）══════════
 *
 * 同 `regex-cheatsheet.ts` 的理由：这份数据**必须可验证**。
 *
 * 教小白用命令行，最容易出错的地方恰恰不是代码，而是**文案与示意图**——
 * 图里少画一句「先不加 --yes」、或者黑窗口的色值被人顺手挪进 tokens.css
 * 跟着主题翻白，这两种错都不会让界面报错，只会让用户看不懂、甚至盲改。
 * 只有放进 `shared/` 才能被 `node --test` 直接跑到（渲染层的文件，
 * tsconfig.node.json 够不着，单测 import 会直接编译失败 —— 这是它当初
 * 一直没被跑过的原因）。
 *
 * 纪律：不 import electron / fs / path / vue（shared 层铁律）。
 *
 * ══ 为什么图是 SVG 字符串而不是真截图 ═══════════════════════════════════
 *
 *  1. 换主题、改界面之后截图就过期了，而且**没人会发现它过期**
 *  2. 截图是位图，在高 DPI 屏上会糊
 *  3. 多存一张图就多一份打包体积与资源路径要维护
 *
 * 画成 SVG 则永不过期，还能跟着容器缩放。
 *
 * ══ 为什么色值不走令牌 ═════════════════════════════════════════════════
 *
 * 见 `theme.ts` 的 `CLI_DEMO_COLORS` 注释：**这几个颜色画的是「现实里那台机器」**，
 * 与用户把本软件设成浅色还是深色无关。深色主题下如果把这个窗口也翻成浅底，
 * 小白反而认不出它是命令行。
 *
 * ⚠️ 这里**只能**用 CLI_DEMO_COLORS 里的值（`tests/p2c-guide.test.ts` 钉死）。
 */

import { CLI_DEMO_COLORS } from './theme'

export interface CliGuideStep {
  /** 步骤标题（卡片上的大字）*/
  title: string
  /** 步骤说明（卡片上的小字，允许用 ` 包住要强调的命令）*/
  body: string
  /** 示意图 */
  svg: string
}

/** 引导卡上那句总说明 */
export const CLI_GUIDE_INTRO =
  '如果你想一次改很多文件夹里的文件，或者把它写进自己的批处理脚本里，可以用命令行模式。三步就能上手：'

const F = 'var(--md-font-num)'

/* ── ① 怎么打开命令行 ──────────────────────────────────────────────── */

const STEP1_SVG = `<svg viewBox="0 0 240 150" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="按 Win 键加 R 键打开运行框，输入 cmd 回车">
  <!-- 键盘示意：Win + R -->
  <rect x="8" y="10" width="224" height="52" rx="8" fill="${CLI_DEMO_COLORS.screenBar}" opacity="0.18"/>
  <rect x="24" y="22" width="40" height="28" rx="6" fill="${CLI_DEMO_COLORS.screenBar}"/>
  <text x="44" y="41" font-family="${F}" font-size="14" fill="${CLI_DEMO_COLORS.screenInk}" text-anchor="middle">⊞</text>
  <text x="76" y="42" font-family="${F}" font-size="15" fill="${CLI_DEMO_COLORS.screenBar}">+</text>
  <rect x="92" y="22" width="40" height="28" rx="6" fill="${CLI_DEMO_COLORS.screenBar}"/>
  <text x="112" y="41" font-family="${F}" font-size="14" fill="${CLI_DEMO_COLORS.screenInk}" text-anchor="middle">R</text>
  <text x="146" y="41" font-family="${F}" font-size="11.5" fill="${CLI_DEMO_COLORS.screenBar}">同时按下</text>

  <!-- 运行框 -->
  <rect x="24" y="76" width="192" height="30" rx="7" fill="${CLI_DEMO_COLORS.screen}"/>
  <text x="36" y="96" font-family="${F}" font-size="13" fill="${CLI_DEMO_COLORS.screenInk}">cmd</text>
  <rect x="66" y="86" width="1.6" height="12" fill="${CLI_DEMO_COLORS.screenInk}">
    <animate attributeName="opacity" values="1;0;1" dur="1.1s" repeatCount="indefinite"/>
  </rect>
  <text x="24" y="126" font-family="${F}" font-size="11.5" fill="${CLI_DEMO_COLORS.screenBar}">出现黑色窗口 → 就是命令行</text>
</svg>`

/* ── ② 命令的每一段是什么意思 ──────────────────────────────────────── */

const STEP2_SVG = `<svg viewBox="0 0 240 150" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="命令行逐段拆解：程序路径、要改的文件夹、规则、确认开关">
  <rect x="8" y="8" width="224" height="96" rx="8" fill="${CLI_DEMO_COLORS.screen}"/>

  <!-- 命令本身：按段着色，配上方的小标签 -->
  <text x="18" y="32" font-family="${F}" font-size="9.5" fill="${CLI_DEMO_COLORS.screenInk}" opacity="0.75">①程序</text>
  <text x="18" y="46" font-family="${F}" font-size="10" fill="${CLI_DEMO_COLORS.screenInk}">maodie.exe</text>

  <text x="88" y="32" font-family="${F}" font-size="9.5" fill="${CLI_DEMO_COLORS.screenInk}" opacity="0.75">②改哪个文件夹</text>
  <text x="88" y="46" font-family="${F}" font-size="10" fill="${CLI_DEMO_COLORS.screenInk}">--dir "D:\\下载"</text>

  <text x="18" y="64" font-family="${F}" font-size="9.5" fill="${CLI_DEMO_COLORS.screenInk}" opacity="0.75">③怎么改</text>
  <text x="18" y="78" font-family="${F}" font-size="10" fill="${CLI_DEMO_COLORS.screenInk}">--delete "广告"</text>

  <text x="110" y="64" font-family="${F}" font-size="9.5" fill="${CLI_DEMO_COLORS.screenInk}" opacity="0.75">④真改开关</text>
  <text x="110" y="78" font-family="${F}" font-size="10" fill="${CLI_DEMO_COLORS.screenInk}">--yes</text>

  <text x="18" y="96" font-family="${F}" font-size="10" fill="${CLI_DEMO_COLORS.screenInk}" opacity="0.8">（②③ 换成你自己的就行）</text>

  <!-- 指向「要换成你自己的那两段」的箭头 -->
  <path d="M86 52 L86 66" stroke="${CLI_DEMO_COLORS.screenInk}" stroke-width="1" opacity="0.6"/>
  <text x="8" y="122" font-family="${F}" font-size="11.5" fill="${CLI_DEMO_COLORS.screenBar}">用界面的「复制命令」粘过来，只改②③</text>
  <text x="8" y="140" font-family="${F}" font-size="11.5" fill="${CLI_DEMO_COLORS.screenBar}">路径两边的引号别删</text>
</svg>`

/* ── ③ 先试一遍，再真改 ───────────────────────────────────────────── */

const STEP3_SVG = `<svg viewBox="0 0 240 150" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="先不加 --yes 跑一遍看清单，确认后再补上 --yes 真正改名">
  <rect x="8" y="8" width="224" height="88" rx="8" fill="${CLI_DEMO_COLORS.screen}"/>

  <!-- 第一步：试运行输出 -->
  <text x="18" y="28" font-family="${F}" font-size="10" fill="${CLI_DEMO_COLORS.screenInk}">&gt; ...  --delete "广告"</text>
  <text x="18" y="46" font-family="${F}" font-size="10" fill="${CLI_DEMO_COLORS.screenInk}" opacity="0.9">预演：广告素材-01.png → 素材-01.png</text>
  <text x="18" y="61" font-family="${F}" font-size="10" fill="${CLI_DEMO_COLORS.screenInk}" opacity="0.9">预演：广告素材-02.png → 素材-02.png</text>
  <text x="18" y="80" font-family="${F}" font-size="10" fill="${CLI_DEMO_COLORS.screenInk}" opacity="0.8">共 2 项，未改动任何文件</text>

  <!-- 第二步：补 --yes -->
  <text x="8" y="118" font-family="${F}" font-size="11.5" fill="${CLI_DEMO_COLORS.screenBar}">清单没错 → 末尾补一个 --yes 再跑</text>
  <text x="8" y="136" font-family="${F}" font-size="11.5" fill="${CLI_DEMO_COLORS.screenBar}">（按 ↑ 键能调出上一条命令）</text>
</svg>`

export const CLI_GUIDE_STEPS: readonly CliGuideStep[] = [
  {
    title: '第一步 · 打开命令行',
    body:
      '按 Win + R 打开「运行」，输入 cmd 后回车，会弹出一个黑色窗口。' +
      '这就是命令行 —— 它和软件界面做的是同一件事，只是用打字代替点鼠标。',
    svg: STEP1_SVG,
  },
  {
    title: '第二步 · 改这条命令',
    body:
      '点设置里的「复制命令」，粘到黑色窗口里。命令中的 ②要改哪个文件夹 ' +
      '和 ③怎么改 换成你自己的内容，其余照抄 —— 路径两边的引号别删掉。',
    svg: STEP2_SVG,
  },
  {
    title: '第三步 · 先试一遍，再真改',
    body:
      '先不加 --yes 跑一遍，它只会把打算改成的名字列出来，一个文件都不动。' +
      '确认清单没问题后，在末尾补上 --yes 再跑一次，才真正改名。',
    svg: STEP3_SVG,
  },
] as const
