/**
 * 主题（P2-A · F-14）。
 *
 * 三态：跟随系统 / 始终浅色 / 始终深色，默认**始终浅色** ——
 * 让软件在任何机器上首屏都长一样，对非技术用户更「稳定」。
 *
 * 为什么放在 `shared/` 而不是主进程：这里全是纯函数（不 import electron / fs），
 * 主进程的存储兜底与 IPC 入参校验都要用它，而且**能被单测直接跑**
 * —— 同 `regex-cheatsheet.ts` 的理由。
 */

export const THEMES = ['system', 'light', 'dark'] as const

export type Theme = (typeof THEMES)[number]

export const DEFAULT_THEME: Theme = 'light'

/** 是不是三个合法值之一（用于在主进程边界上挡掉渲染层传来的野值）*/
export function isTheme(raw: unknown): raw is Theme {
  return typeof raw === 'string' && (THEMES as readonly string[]).includes(raw)
}

/** 只认三个合法值；prefs.json 被手改坏、或渲染层传了野值时回落到默认 */
export function normalizeTheme(raw: unknown): Theme {
  return isTheme(raw) ? raw : DEFAULT_THEME
}

/**
 * 窗口底色的兜底值（主进程建窗口那一刻用）。
 *
 * 为什么必须有一份 TS 拷贝：`BrowserWindow.backgroundColor` 要在建窗口时立刻给出，
 * 那时 CSS 还没加载 —— 而**它就是「首帧不闪」那一帧用的颜色**。
 *
 * ⚠️ 这两个值必须与 `styles/tokens.css` 里 `--md-bg-cream` 的浅色值 / 深色值
 * 逐字节相同。靠人同步不住，所以 `tests/p2a-theme.test.ts` 会**解析 CSS** 把两边
 * 钉在一起：改了 CSS 忘了改这里，单测会红。
 */
export const WINDOW_BG = {
  light: '#fffbf5',
  dark: '#251a14',
} as const

/** 深色与否 → 窗口底色（themeSource 为 system 时由主进程先解析成布尔）*/
export function windowBackgroundFor(dark: boolean): string {
  return dark ? WINDOW_BG.dark : WINDOW_BG.light
}

/**
 * 命令行示意图的专用色（P2-C 增量 · 教程卡片）。
 *
 * ★ **这两个值刻意不参与主题切换。**
 *
 * 理由：示意图画的是**现实中的 Windows 命令提示符窗口** —— 它永远是黑底浅字，
 * 与用户把本软件设成「浅色」还是「深色」**毫无关系**。如果让它跟随主题，
 * 深色主题下这个窗口会变成浅底深字，反而**不像命令行窗口了**，小白更认不出来。
 *
 * ⚠️ 这就是为什么不能放进 `tokens.css`：令牌的语义是「随主题变的界面颜色」，
 * 而这两个是「画里那台机器的颜色」。两者生命周期不同 ——
 * 设计规范改了主色，这里不该跟着动。
 *
 * 白名单：`tests/p2a-theme.test.ts` 的 TC-32 盯着「色值只能写在 tokens.css」，
 * `src/shared/theme.ts` 是唯一豁免文件（`WINDOW_BG` 也需要它）。本常量与
 * `WINDOW_BG` 一样属于「必须有一份 TS 拷贝」的情形（SVG 是字符串，读不到 CSS 变量）。
 */
export const CLI_DEMO_COLORS = {
  /** 命令提示符窗口的底色（Windows 终端的默认黑）*/
  screen: '#0c0c0c',
  /** 命令提示符窗口里的浅色文字 */
  screenInk: '#cccccc',
  /** 窗口标题栏（比底色略亮一档，用来区分标题与正文）*/
  screenBar: '#2b2b2b',
} as const
