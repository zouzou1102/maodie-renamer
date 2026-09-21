'use strict';
/**
 * 看得见的测试 · 冒烟 helpers（Electron / CommonJS）
 *
 * 只依赖 node 内置模块 + electron。**不要在这里引入任何第三方测试框架。**
 *
 * 设计约束（对应 SKILL.md 的铁律）：
 *   铁律 4  真实输入事件：clickAt 用 sendInputEvent，不用 element.click()
 *   铁律 5  断言读渲染后的真值：see / seeStyle / seeCount 读的都是渲染结果
 *   铁律 7  不往生产代码加钩子：测试光标 / 操作横幅 / 资源监听全部运行时注入
 *
 * 「看得见软件自己在动」靠三件事：
 *   ① 窗口可见、置顶、不抢焦点        → showWindow()
 *   ② 页面上画测试光标 + 操作横幅      → installOverlay() / hud() / cursorMove()
 *   ③ 每个功能"操作前 → 操作后"两张图  → runSteps()
 */

const fs = require('node:fs');
const path = require('node:path');
const nodeAssert = require('node:assert/strict');

// ─────────────────────────────────────────────────────────────
// 0 · 运行开关（默认按"看得清"来；快跑/去掉干扰用环境变量覆盖）
// ─────────────────────────────────────────────────────────────

const config = {
  /** 快跑：SMOKE_FAST=1 关掉慢速 */
  fast: process.env.SMOKE_FAST === '1',
  /** 每步之间 / 点击前后的停顿（ms），默认 600 —— 让人眼跟得上 */
  slow: 0,
  /** 跑完窗口停留毫秒；null = 自动（成功 2s、有失败 10s） */
  hold: process.env.SMOKE_HOLD === undefined ? null : Number(process.env.SMOKE_HOLD),
  /** 不置顶：SMOKE_NO_TOP=1 */
  top: process.env.SMOKE_NO_TOP !== '1',
  /** 不注入测试光标与横幅：SMOKE_NO_HUD=1 */
  hud: process.env.SMOKE_NO_HUD !== '1',
  /** 截图数量：both（默认，操作前后各一张）/ after / none */
  shots: process.env.SMOKE_SHOTS || 'both',
};
config.slow = config.fast ? 0 : Number(process.env.SMOKE_SLOW_MS || 600);

/** 点击前后的极短停顿（慢速模式下才有） */
const tick = () => config.slow * 0.2;

// ─────────────────────────────────────────────────────────────
// 1 · 轮询等待（时间相关断言一律用它，绝不 sleep 固定时长）
// ─────────────────────────────────────────────────────────────

async function waitFor(fn, { timeout = 8000, interval = 50, label = 'condition' } = {}) {
  const t0 = Date.now();
  let lastErr = null;
  for (;;) {
    let v = false;
    try {
      v = await fn();
    } catch (err) {
      lastErr = err; // fn 里抛错（元素还没出现等）视为"没到"，但留痕
      v = false;
    }
    if (v) return v;
    if (Date.now() - t0 > timeout) {
      const tail = lastErr ? `\n  最后一次探测抛错：${lastErr.message}` : '';
      throw new Error(`waitFor 超时(${timeout}ms)：${label}${tail}`);
    }
    await sleep(interval);
  }
}

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

// ─────────────────────────────────────────────────────────────
// 2 · 在渲染层读值 / 量尺寸（只用于"读"，不用于代替操作）
// ─────────────────────────────────────────────────────────────

function evalIn(win, expression) {
  return win.webContents.executeJavaScript(expression, true);
}

async function rectOf(win, selector) {
  return evalIn(
    win,
    `(() => {
       const el = document.querySelector(${JSON.stringify(selector)});
       if (!el) return null;
       const r = el.getBoundingClientRect();
       return { x: r.left, y: r.top, w: r.width, h: r.height,
                cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
     })()`
  );
}

/** 用户"真的看得见"的判定：可见 + 有尺寸 + 与视口有交集。 */
function visibilityExpr(selector) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { found: false, visible: false, onScreen: false };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const onScreen = r.width > 0 && r.height > 0
      && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    const visible = typeof el.checkVisibility === 'function'
      ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      : cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0;
    return { found: true, visible: !!visible, onScreen, w: Math.round(r.width), h: Math.round(r.height),
             display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
             overflowY: cs.overflowY, color: cs.color, backgroundColor: cs.backgroundColor };
  })()`;
}

/** 读元素"渲染后的实际样式值"（铁律 5：断颜色/尺寸必须用这个，不能只看 class）。 */
function styleExpr(selector, prop) {
  return `(() => { const el = document.querySelector(${JSON.stringify(selector)});
    return el ? getComputedStyle(el)[${JSON.stringify(prop)}] : null; })()`;
}

function textExpr(selector) {
  return `(() => { const el = document.querySelector(${JSON.stringify(selector)});
    return el ? String(el.textContent).trim() : null; })()`;
}

function countExpr(selector) {
  return `(() => document.querySelectorAll(${JSON.stringify(selector)}).length)()`;
}

function attrExpr(selector, attr) {
  return `(() => { const el = document.querySelector(${JSON.stringify(selector)});
    return el ? el.getAttribute(${JSON.stringify(attr)}) : null; })()`;
}

/** 页面里的资源加载失败清单（配合 injectResourceGuards 注入的 __safety）。 */
function resourceFailuresExpr() {
  return `(() => {
    const perf = performance.getEntriesByType('resource').filter(r =>
      (r.responseStatus && r.responseStatus >= 400) ||
      (r.initiatorType && r.transferSize === 0 && r.decodedBodySize === 0 && r.duration > 0)
    ).map(r => ({ name: r.name, initiatorType: r.initiatorType,
                  responseStatus: r.responseStatus, transferSize: r.transferSize }));
    const injected = (window.__safety && window.__safety.resourceErrors) || [];
    return { performance: perf, injected };
  })()`;
}

// ─────────────────────────────────────────────────────────────
// 3 · 让窗口在你眼前动
// ─────────────────────────────────────────────────────────────

/**
 * 窗口可见化：显示 + 临时置顶，**不抢焦点**。
 * 用 showInactive 而不是 show：show 会把焦点从用户手上夺走。
 */
function showWindow(win, { top = config.top, focus = false } = {}) {
  try {
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) (focus ? win.show() : win.showInactive());
    if (top) win.setAlwaysOnTop(true, 'screen-saver');
  } catch {
    /* 某些窗口类型不支持置顶，忽略即可，不影响测试 */
  }
}

const OVERLAY_JS = `(() => {
  if (window.__vtov) return 'exists';
  const host = document.body || document.documentElement;
  const wrap = document.createElement('div');
  wrap.id = '__vtov';
  // ★ pointer-events:none —— 覆盖层绝不吃点击，否则它自己就成了"点不到"的 bug 源
  wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';

  const bar = document.createElement('div');
  bar.id = '__vt-hud';
  bar.style.cssText = 'position:absolute;left:50%;bottom:14px;transform:translateX(-50%);'
    + 'max-width:min(780px,92vw);display:flex;align-items:center;gap:10px;'
    + 'padding:7px 15px;border-radius:999px;'
    + 'font:13px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;'
    + 'color:#e6e9ef;background:rgba(15,18,24,.88);'
    + 'border:1px solid rgba(106,168,255,.55);box-shadow:0 6px 22px rgba(0,0,0,.5);'
    + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  const idx = document.createElement('b');
  idx.style.cssText = 'color:#6aa8ff;font-variant-numeric:tabular-nums;flex:none;';
  const txt = document.createElement('span');
  txt.style.cssText = 'overflow:hidden;text-overflow:ellipsis;';
  const st = document.createElement('span');
  st.style.cssText = 'flex:none;';
  bar.append(idx, txt, st);

  const cur = document.createElement('div');
  cur.id = '__vt-cursor';
  cur.style.cssText = 'position:absolute;left:0;top:0;width:34px;height:34px;'
    + 'margin:-17px 0 0 -17px;border-radius:50%;'
    + 'border:2px solid #6aa8ff;background:rgba(106,168,255,.20);'
    + 'box-shadow:0 0 0 4px rgba(106,168,255,.14),0 0 16px rgba(106,168,255,.55);'
    + 'transition:transform .18s cubic-bezier(.22,1,.36,1);transform:translate3d(-200px,-200px,0);';

  wrap.append(bar, cur);
  host.appendChild(wrap);
  window.__vtov = { bar, idx, txt, st, cur, wrap };
  // 点击涟漪：跟着真实点击坐标弹一圈，让"它点了这儿"看得见
  window.__vtRipple = function (x, y, color) {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;left:0;top:0;width:16px;height:16px;margin:-8px 0 0 -8px;'
      + 'border-radius:50%;border:2px solid ' + (color || '#6aa8ff') + ';'
      + 'transition:transform .45s ease-out,opacity .45s ease-out;'
      + 'transform:translate3d(' + x + 'px,' + y + 'px,0) scale(1);opacity:.95;';
    wrap.appendChild(d);
    requestAnimationFrame(function () {
      d.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0) scale(3.4)';
      d.style.opacity = '0';
    });
    setTimeout(function () { d.remove(); }, 520);
  };
  return 'installed';
})()`;

/** 注入测试光标 + 操作横幅（运行时注入；撤掉它被测程序一点不受影响）。 */
async function installOverlay(win) {
  if (!config.hud) return 'disabled';
  try {
    return await evalIn(win, OVERLAY_JS);
  } catch {
    return 'failed';
  }
}

/** 更新横幅文字。status 传 '✅' / '❌' / '▶' / ''。 */
async function hud(win, { index, total, text, status = '' } = {}) {
  if (!config.hud) return;
  const idx = index && total ? `${index}/${total}` : '';
  try {
    await evalIn(
      win,
      `(() => { const o = window.__vtov; if (!o) return false;
         o.idx.textContent = ${JSON.stringify(idx)};
         o.txt.textContent = ${JSON.stringify(` ${text || ''}`)};
         o.st.textContent = ${JSON.stringify(status)};
         return true; })()`
    );
  } catch { /* 横幅只是给人看的，出问题不影响测试 */ }
}

/**
 * 把测试光标移到 (x, y)。
 * ⚠️ 系统真实的鼠标指针**不会**动 —— Electron 注入的输入事件不驱动 OS 光标。
 * 所以要自己在页面上画一个，否则你只会看到"按钮自己亮了"，不知道它点了哪儿。
 */
async function cursorMove(win, x, y) {
  if (!config.hud) return;
  try {
    await evalIn(
      win,
      `(() => { const o = window.__vtov; if (!o) return false;
         o.cur.style.transform = 'translate3d(${Math.round(x)}px,${Math.round(y)}px,0)';
         return true; })()`
    );
  } catch { /* 忽略 */ }
}

async function cursorRipple(win, x, y, color) {
  if (!config.hud) return;
  try {
    await evalIn(
      win,
      `(() => { if (window.__vtRipple) window.__vtRipple(${Math.round(x)},${Math.round(y)},${JSON.stringify(color || '')}); return true; })()`
    );
  } catch { /* 忽略 */ }
}

// ─────────────────────────────────────────────────────────────
// 4 · 真实输入事件（铁律 4：这是"抓得到点不到"的唯一办法）
// ─────────────────────────────────────────────────────────────

async function scrollIntoView(win, selector) {
  await evalIn(
    win,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)});
       if (el) el.scrollIntoView({ block: 'center', inline: 'center' }); })()`
  );
  await sleep(120);
  const r = await rectOf(win, selector);
  if (!r) throw new Error(`定位失败（元素不存在）：${selector}`);
  return { x: Math.round(r.cx), y: Math.round(r.cy) };
}

/**
 * 真实鼠标左键点击：测试光标先移过去 → 停一下 → mouseMove / mouseDown / mouseUp → 涟漪。
 * 「先移过去停一下」是为了让人眼看清它要点哪儿；按下的瞬间不拖长（真人点击就是很快的）。
 */
async function clickAt(win, selector, { scroll = true } = {}) {
  let p;
  if (scroll) {
    p = await scrollIntoView(win, selector);
  } else {
    const r = await rectOf(win, selector);
    if (!r) throw new Error(`定位失败（元素不存在）：${selector}`);
    p = { x: Math.round(r.cx), y: Math.round(r.cy) };
  }
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < -1000 || p.y < -1000) {
    throw new Error(`坐标异常，拒绝点击：${selector} → (${p.x}, ${p.y})`);
  }
  await cursorMove(win, p.x, p.y);
  await sleep(Math.max(140, config.slow * 0.5)); // 让"光标移过去"看得见
  win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
  await sleep(tick());
  win.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await sleep(tick());
  win.webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await cursorRipple(win, p.x, p.y);
  await sleep(tick());
  return p;
}

/**
 * 按窗口坐标点一下（不定位元素）。
 *
 * 为什么需要它：有些区域「一整个元素」但只有一部分可点。最典型的是弹窗遮罩
 * `.md-mask`（fixed inset:0，铺满整窗）—— 它的关闭逻辑挂在 `@click.self` 上，
 * 点中心只会落在弹窗本体上，点不中遮罩。元素中心点这条路在这里天然走不通，
 * 所以补一个「我就要点这个坐标」的操作。
 */
async function clickPoint(win, x, y, { label = '' } = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`坐标非法，拒绝点击：(${x}, ${y})`);
  }
  await cursorMove(win, x, y);
  await sleep(Math.max(140, config.slow * 0.5));
  win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
  await sleep(tick());
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  await sleep(tick());
  win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  await cursorRipple(win, x, y);
  await sleep(tick());
  return { x, y, label };
}

async function doubleClickAt(win, selector) {
  const p = await scrollIntoView(win, selector);
  await cursorMove(win, p.x, p.y);
  await sleep(Math.max(140, config.slow * 0.5));
  win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
  for (const clickCount of [1, 2]) {
    win.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount });
    await sleep(16);
  }
  await cursorRipple(win, p.x, p.y);
  return p;
}

async function hoverAt(win, selector) {
  const p = await scrollIntoView(win, selector);
  await cursorMove(win, p.x, p.y);
  await sleep(Math.max(120, config.slow * 0.5));
  win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
  return p;
}

async function dragTo(win, fromSelector, toSelector, { steps = 8 } = {}) {
  const from = await scrollIntoView(win, fromSelector);
  const to = await scrollIntoView(win, toSelector);
  await cursorMove(win, from.x, from.y);
  await sleep(Math.max(140, config.slow * 0.5));
  win.webContents.sendInputEvent({ type: 'mouseMove', x: from.x, y: from.y });
  win.webContents.sendInputEvent({ type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= steps; i++) {
    const x = Math.round(from.x + ((to.x - from.x) * i) / steps);
    const y = Math.round(from.y + ((to.y - from.y) * i) / steps);
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y, button: 'left' });
    await cursorMove(win, x, y);
    await sleep(Math.max(24, config.slow / 12));
  }
  win.webContents.sendInputEvent({ type: 'mouseUp', x: to.x, y: to.y, button: 'left', clickCount: 1 });
  await cursorRipple(win, to.x, to.y);
  return { from, to };
}

async function pressKey(win, keyCode, { modifiers = [] } = {}) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  await sleep(16);
  // 只有单个可打印字符才补发 char；方向键 / Enter 等发 char 是多余的
  if (typeof keyCode === 'string' && keyCode.length === 1) {
    win.webContents.sendInputEvent({ type: 'char', keyCode, modifiers });
  }
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await sleep(tick());
}

/**
 * 把焦点放到元素上（用 el.focus()）。
 *
 * 为什么需要它：原生 `<select>` 的**下拉弹窗是 OS 级窗口**，注入的鼠标事件点不开也选不中
 * （和原生对话框同理）。所以「选下拉项」这条路是：先聚焦，再用**真实方向键**改选中项 ——
 * 键盘事件是真实输入通道，`change` 由 Chromium 自己发，不是我们伪造的。
 * 报告里会标注这一代价。
 */
async function focusEl(win, selector) {
  const ok = await evalIn(
    win,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)});
       if (!el) return false; el.focus(); return document.activeElement === el; })()`
  );
  if (!ok) throw new Error(`聚焦失败（元素不存在或未能获得焦点）：${selector}`);
  await sleep(Math.max(60, tick()));
}

/** 真实文本输入（写进当前焦点元素）。先用 c.click() 聚焦，再调它。 */
async function typeText(win, text) {
  win.webContents.insertText(text);
  await sleep(Math.max(60, tick()));
}

// ─────────────────────────────────────────────────────────────
// 5 · 截图（全尺寸存档 + 缩略图内嵌报告）
// ─────────────────────────────────────────────────────────────

async function shot(win, outDir, index, name) {
  const image = await win.webContents.capturePage();
  const base = `${String(index).padStart(2, '0')}-${sanitize(name)}`;
  fs.mkdirSync(outDir, { recursive: true }); // 目录不存在时自己建，不要抛 ENOENT 去污染步骤结果
  const full = path.join(outDir, `${base}.png`);
  const thumb = path.join(outDir, `${base}.thumb.jpg`);
  fs.writeFileSync(full, image.toPNG());
  const size = image.getSize();
  const width = Math.min(720, size.width || 720);
  fs.writeFileSync(thumb, image.resize({ width }).toJPEG(72));
  return { full, thumb, name: path.basename(full) };
}

const sanitize = (s) => String(s).replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 40);

// ─────────────────────────────────────────────────────────────
// 6 · 兜底监听（console / 资源 / 预加载 / 崩溃 / 无响应 / 加载失败）
//    全部在运行时挂载，生产源码一个字都没动（铁律 7）
// ─────────────────────────────────────────────────────────────

function attachSafetyNet(win, result) {
  result.console = [];
  result.resources = [];
  result.hardErrors = [];

  // Electron ≤32: (event, level:number, message, line, sourceId)
  // Electron ≥36: (event, details:{level:string, message, lineNumber, sourceId})
  win.webContents.on('console-message', (...args) => {
    let level, message, line, source;
    if (args[1] && typeof args[1] === 'object' && 'message' in args[1]) {
      level = args[1].level; message = args[1].message;
      line = args[1].lineNumber; source = args[1].sourceId;
    } else {
      level = args[1]; message = args[2]; line = args[3]; source = args[4];
    }
    const isErr = level === 3 || level === 'error';
    const isWarn = level === 2 || level === 'warning';
    if (isErr || isWarn) {
      result.console.push({ level: isErr ? 'error' : 'warning', message, line, source, raw: `${message} (${source}:${line})` });
    }
  });

  win.webContents.on('preload-error', (_e, preloadPath, error) => {
    result.hardErrors.push({ kind: 'preload-error', preloadPath, raw: String((error && error.stack) || error) });
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    result.hardErrors.push({ kind: 'render-process-gone', raw: JSON.stringify(details) });
  });
  win.webContents.on('unresponsive', () => {
    result.hardErrors.push({ kind: 'unresponsive', raw: '页面无响应（可能卡死，不是"慢"）' });
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    result.hardErrors.push({ kind: 'did-fail-load', raw: `code=${code} ${desc} url=${url} mainFrame=${isMainFrame}` });
  });

  if (!attachSafetyNet._hooked) {
    attachSafetyNet._hooked = true;
    process.on('uncaughtException', (err) => {
      result.hardErrors.push({ kind: 'main-uncaughtException', raw: String((err && err.stack) || err) });
    });
    process.on('unhandledRejection', (reason) => {
      result.hardErrors.push({ kind: 'main-unhandledRejection', raw: String((reason && reason.stack) || reason) });
    });
  }
}

/** 页面侧注入资源/未捕获异常监听（必须在页面加载完成后调用）。 */
async function injectResourceGuards(win) {
  await evalIn(
    win,
    `(() => {
       if (window.__safety) return;
       window.__safety = { resourceErrors: [], unhandled: [] };
       addEventListener('error', (e) => {
         const t = e.target;
         if (t && t !== window && (t.src || t.href)) {
           window.__safety.resourceErrors.push({ tag: t.tagName, url: t.src || t.href });
         } else {
           window.__safety.unhandled.push(String(e.message) + ' @ ' + e.filename + ':' + e.lineno);
         }
       }, true);
       addEventListener('unhandledrejection', (e) => {
         window.__safety.unhandled.push('unhandledrejection: ' +
           String((e.reason && e.reason.stack) || e.reason));
       });
     })()`
  );
}

async function collectResourceGuards(win, result) {
  try {
    const s = await evalIn(win, 'window.__safety || null');
    if (s) {
      result.resources = s.resourceErrors || [];
      result.unhandled = s.unhandled || [];
    }
  } catch {
    /* 页面已关闭等情况：不掩盖已有失败，只留空数组 */
    result.resources = result.resources || [];
    result.unhandled = result.unhandled || [];
  }
}

// ─────────────────────────────────────────────────────────────
// 7 · 断言（复用 node:assert 语义，但把期望/实际都收进报告）
// ─────────────────────────────────────────────────────────────

function makeAssert() {
  const items = [];
  /**
   * @param {string} label  给人看的断言说明
   * @param {any} actual    实际值（必须来自渲染后的真实结果）
   * @param {any} expected  期望值
   * @param {string} [detail] 附加细节（如尺寸、可见性、在不在视口内），
   *                          只用于报告里让人看清数字，**不参与判定**
   */
  const assert = (label, actual, expected, detail) => {
    try {
      nodeAssert.deepStrictEqual(actual, expected);
      items.push({ label, actual, expected, detail, pass: true });
      return true;
    } catch (err) {
      items.push({ label, actual, expected, detail, pass: false, raw: String(err.message) });
      return false;
    }
  };
  return { assert, items };
}

// ─────────────────────────────────────────────────────────────
// 8 · 功能清单（一个功能一行，读起来就是"要验哪些功能"）
// ─────────────────────────────────────────────────────────────

const cut = (s, n = 60) => {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** 同步记录器：写起来是链式的，执行时按顺序发真实事件。 */
function makeRecorder(ops) {
  const rec = {};
  const add = (kind, label, args = []) => {
    ops.push({ kind, label, args });
    return rec; // 可链式：c.click('.x').see('.y')
  };
  // —— 操作（发真实输入事件）——
  rec.click = (sel) => add('click', `点 ${sel}`, [sel]);
  /** 按窗口坐标点一下；第三参是给人看的说明（报告横幅会显示） */
  rec.clickPoint = (x, y, label) => add('clickPoint', label || `点坐标 (${x}, ${y})`, [x, y]);
  rec.dblclick = (sel) => add('dblclick', `双击 ${sel}`, [sel]);
  rec.hover = (sel) => add('hover', `移到 ${sel} 上`, [sel]);
  rec.drag = (a, b) => add('drag', `${a} 拖到 ${b}`, [a, b]);
  rec.type = (text) => add('type', `输入「${cut(text, 30)}」`, [text]);
  rec.key = (k) => add('key', `按 ${k}`, [k]);
  /**
   * 把 `<select>` 选成指定值。
   *
   * ⚠️ 它**不是**真实鼠标操作：原生下拉的弹出层不在 DOM 里，
   * `sendInputEvent` 点不到它。所以这里直接改 value 并派发一个**真实的
   * `change` 事件** —— Vue 的 `@change` 处理器照常触发，走的是与用户点选之后
   * **完全同一条**业务代码路径。
   * 局限要记住：它验不了「鼠标能不能点开下拉」。
   */
  rec.select = (sel, value) => add('select', `把 ${sel} 选成「${value}」`, [sel, value]);
  rec.focus = (sel) => add('focus', `聚焦 ${sel}`, [sel]);
  rec.scroll = (sel) => add('scroll', `滚动到 ${sel}`, [sel]);
  rec.wait = (ms) => add('wait', `等 ${ms}ms`, [ms]);
  rec.waitUntil = (expr, timeout) => add('waitUntil', `等条件成立：${cut(expr)}`, [expr, timeout]);
  // —— 断言（只看用户看得见的结果）——
  rec.see = (sel, label) => add('see', label || `${sel} 可见`, [sel]);
  rec.notSee = (sel, label) => add('notSee', label || `${sel} 不可见`, [sel]);
  rec.seeText = (sel, expected, label) => add('seeText', label || `${sel} 的文字`, [sel, expected]);
  rec.seeContains = (sel, sub, label) =>
    add('seeContains', label || `${sel} 的文字包含「${sub}」`, [sel, sub]);
  /**
   * 读「过渡动画结束后的稳定样式值」再断言。
   *
   * 为什么需要它：`.md-input` 对 border-color / box-shadow 有 180ms 过渡，类名刚加上时
   * getComputedStyle 返回的是**中间插值色**（例如 #F0E4D4→#E5544B 的 55% = rgb(234,148,136)），
   * 直接断言必然"看起来像失败其实没问题"。这里轮询到稳定值再判，不是 sleep，也不会放宽标准。
   */
  rec.seeStyleSettled = (sel, prop, expected, label) =>
    add('seeStyleSettled', label || `${sel} 的 ${prop}（过渡结束后）`, [sel, prop, expected]);
  rec.seeCount = (sel, n, label) => add('seeCount', label || `${sel} 有 ${n} 个`, [sel, n]);
  /**
   * 断言「任意表达式的求值结果 === 期望值」。
   *
   * 用途：有些真值说不成「某个元素的某个属性等于某个常量」——
   * 最典型的是「现在解析出来的主题，是否等于系统深浅色信号所要求的那一个」，
   * 它的期望值取决于跑测试的这台机器，写不成字面量。
   * 用表达式把它说清楚，失败时报告里同样有 期望/实际 两栏，不是"糊过去"。
   * 表达式必须读**渲染后的真值**（铁律 5）。
   */
  rec.seeThat = (expr, expected, label) =>
    add('seeThat', label || `表达式结果应为 ${JSON.stringify(expected)}：${cut(expr)}`, [expr, expected]);
  rec.seeStyle = (sel, prop, expected, label) => add('seeStyle', label || `${sel} 的 ${prop}`, [sel, prop, expected]);
  rec.seeAttr = (sel, attr, expected, label) => add('seeAttr', label || `${sel} 的 ${attr}`, [sel, attr, expected]);
  return rec;
}

/**
 * 声明一个"功能"。用法：
 *   feature('打开设置面板', c => c.click('.titlebar__settings').see('.settings-panel'))
 * 一个功能一行，读起来就是"这个功能要验什么"。
 */
function feature(name, build, opts = {}) {
  const ops = [];
  if (typeof build === 'function') build(makeRecorder(ops));
  return { name, ops, ...opts };
}

// ─────────────────────────────────────────────────────────────
// 9 · 执行功能清单
// ─────────────────────────────────────────────────────────────

/**
 * 把 `<select>` 选成指定值，并派发一个**真实的 change 事件**。
 *
 * ⚠️ 局限：原生下拉的弹出层不在 DOM 里，`sendInputEvent` 点不到它 ——
 * 所以这一步不是「真实鼠标操作」。但派发的 `change` 会触发 Vue 的 `@change`，
 * 走的是与用户点选之后**完全同一条**业务代码路径：
 * 能验「选项生效了没」，验不了「鼠标能不能点开下拉」。
 */
async function selectOption(win, selector, value) {
  const got = await evalIn(
    win,
    `(() => {
       const el = document.querySelector(${JSON.stringify(selector)});
       if (!el) throw new Error('找不到元素：' + ${JSON.stringify(selector)});
       el.value = ${JSON.stringify(String(value))};
       el.dispatchEvent(new Event('change', { bubbles: true }));
       return el.value;
     })()`,
  );
  if (String(got) !== String(value)) {
    throw new Error(`下拉没能选成 ${value}（实际 ${got}）：${selector}`);
  }
}

/** 执行一个 op。断言类 op 把结果交给 assert。 */
async function runOp(win, op, assert) {
  const [a, b, c] = op.args;
  switch (op.kind) {
    case 'click': await clickAt(win, a); break;
    case 'clickPoint': await clickPoint(win, a, b); break;
    case 'dblclick': await doubleClickAt(win, a); break;
    case 'hover': await hoverAt(win, a); break;
    case 'drag': await dragTo(win, a, b); break;
    case 'type': await typeText(win, a); break;
    case 'key': await pressKey(win, a); break;
    case 'select': await selectOption(win, a, b); break;
    case 'focus': await focusEl(win, a); break;
    case 'scroll': await scrollIntoView(win, a); break;
    case 'wait': await sleep(a); break;
    case 'waitUntil':
      await waitFor(() => evalIn(win, `!!(${a})`), { timeout: b || 8000, label: op.label });
      break;
    case 'see': {
      // 断言的是布尔（判定），尺寸等数字放 detail（只给人看，不参与判定）
      const v = await evalIn(win, visibilityExpr(a));
      assert(op.label, v.visible === true && v.onScreen === true, true,
        `可见=${v.visible} 在视口内=${v.onScreen} 尺寸=${v.w}x${v.h}`
        + `${v.found ? '' : '（没找到元素）'}`);
      break;
    }
    case 'notSee': {
      const v = await evalIn(win, visibilityExpr(a));
      assert(op.label, v.visible === true, false, `可见=${v.visible}`);
      break;
    }
    case 'seeText': assert(op.label, await evalIn(win, textExpr(a)), b); break;
    case 'seeContains': {
      // 读的是渲染后的真实文字；判定"包含"而非全等（用于新名含未知文件名主体的场景）
      const t = await evalIn(win, textExpr(a));
      assert(op.label, typeof t === 'string' && t.includes(b), true,
        `实际文字=${JSON.stringify(t)}（应包含 ${JSON.stringify(b)}）`);
      break;
    }
    case 'seeCount': assert(op.label, await evalIn(win, countExpr(a)), b); break;
    case 'seeThat': assert(op.label, await evalIn(win, `(${a})`), b); break;
    case 'seeStyleSettled': {
      // 轮询到样式稳定值再断言（过渡动画期间读到的是插值，见 makeRecorder 里的说明）
      const t0 = Date.now();
      let v = await evalIn(win, styleExpr(a, b));
      while (v !== c && Date.now() - t0 < 3000) {
        await sleep(40);
        v = await evalIn(win, styleExpr(a, b));
      }
      assert(op.label, v, c, '（等过渡动画结束后读取的稳定值）');
      break;
    }
    case 'seeStyle': assert(op.label, await evalIn(win, styleExpr(a, b)), c); break;
    case 'seeAttr': assert(op.label, await evalIn(win, attrExpr(a, b)), c); break;
    default: throw new Error(`未知操作类型：${op.kind}`);
  }
}

/**
 * 逐个功能跑。每个功能：
 *   横幅显示"准备：<功能名>" → 截图(操作前) → 执行 ops → 截图(操作后)
 * 单个功能失败不中断后续功能（一次跑完能看到全貌），但会记进 result。
 */
async function runSteps(win, outDir, result, features) {
  result.steps = result.steps || [];
  const total = features.length;
  for (let i = 0; i < total; i++) {
    const f = features[i];
    const index = i + 1;
    const rec = { index, name: f.name, pass: false, asserts: [], ops: f.ops || [], startedAt: new Date().toISOString() };
    const collected = makeAssert();

    // 截图是"证据"，不是"断言"：截图失败只记一笔并大声提示，不能把这一步判成失败。
    const tryShot = async (suffix) => {
      if (config.shots === 'none') return null;
      if (config.shots === 'after' && suffix !== 'after') return null;
      try {
        return await shot(win, outDir, index, `${f.name}-${suffix}`);
      } catch (err) {
        rec.shotError = `截图失败（${suffix}）：${String((err && err.message) || err)}`;
        console.log(`     ⚠️ ${rec.shotError}（这一步的判定不受影响，但报告里会缺图）`);
        return null;
      }
    };

    try {
      await hud(win, { index, total, text: `准备：${f.name}` });
      if (config.slow) await sleep(config.slow * 0.3);
      rec.shotBefore = await tryShot('before');
      await hud(win, { index, total, text: f.name, status: '▶' });

      for (const op of f.ops || []) {
        await hud(win, { index, total, text: `${f.name} · ${op.label}` });
        await runOp(win, op, collected.assert);
      }

      rec.shotAfter = await tryShot('after');
      rec.asserts = collected.items;
      rec.pass = collected.items.length > 0 && collected.items.every((x) => x.pass);
      if (collected.items.length === 0) {
        rec.pass = false;
        rec.note = '这个功能一条断言都没有 —— 不算通过（见 SKILL.md 铁律 5）';
      }
      await hud(win, { index, total, text: f.name, status: rec.pass ? '✅' : '❌' });
    } catch (err) {
      rec.asserts = collected.items;
      rec.pass = false;
      rec.raw = String((err && err.stack) || err); // ★ 原始报错，原文保留
      rec.shotAfter = rec.shotAfter || (await tryShot('failed'));
      await cursorRipple(win, 8, 8, '#ff5c5c');
      await hud(win, { index, total, text: `中断：${f.name}`, status: '❌' });
    }

    rec.finishedAt = new Date().toISOString();
    result.steps.push(rec);
    const mark = rec.pass ? '✅' : '❌';
    console.log(`${mark} 第 ${index}/${total} 个功能 ${f.name}`);
    for (const x of rec.asserts.filter((y) => !y.pass)) {
      console.log(`     断言失败：${x.label}`);
      console.log(`       期望：${preview(x.expected)}`);
      console.log(`       实际：${preview(x.actual)}`);
      if (x.detail) console.log(`       细节：${x.detail}`);
      if (x.raw) {
        console.log('       原始报错：');
        console.log(indent(limitLines(x.raw, 5), 10));
      }
    }
    if (rec.raw) {
      console.log('     原始报错：');
      console.log(indent(limitLines(rec.raw, 8), 6));
    }
    if (config.slow) await sleep(config.slow); // 让最后一眼留得住
  }
  return result.steps;
}

const preview = (v) => {
  const s = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v);
  return s && s.length > 300 ? `${s.slice(0, 300)}…` : s;
};
const indent = (s, n) => String(s).split('\n').map((l) => ' '.repeat(n) + l).join('\n');
const limitLines = (s, n) => {
  const lines = String(s).split('\n');
  return lines.length <= n ? lines.join('\n') : `${lines.slice(0, n).join('\n')}\n  …（全文见报告）`;
};

// ─────────────────────────────────────────────────────────────
// 10 · 隔离核验（断言"真的没碰用户真实数据"）
// ─────────────────────────────────────────────────────────────

/** 目录指纹：文件数 + 总字节 + 最新 mtime。跑前跑后各取一次，应完全相同。 */
function fingerprint(dir) {
  let files = 0;
  let bytes = 0;
  let newest = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        try {
          const s = fs.statSync(p);
          files += 1;
          bytes += s.size;
          newest = Math.max(newest, s.mtimeMs);
        } catch { /* 文件刚被删/锁住，忽略 */ }
      }
    }
  };
  walk(dir);
  return { files, bytes, newest };
}

// ─────────────────────────────────────────────────────────────
// 11 · 轮次记录（修复循环用，见 references/fix-loop.md）
// ─────────────────────────────────────────────────────────────

/** 从失败里提"指纹"，用于判断"是不是同一个错误连续 3 轮没变化"。 */
function failureSignature(step) {
  const first = (step.asserts || []).find((a) => !a.pass);
  if (first) return `${first.label} :: ${preview(first.expected)} != ${preview(first.actual)}`;
  if (step.raw) return step.raw.split('\n')[0];
  if (step.note) return step.note;
  return `${step.name} :: 未知失败`;
}

function writeRound(outDir, result, { round, changed, hypothesis, verifiedHow }) {
  const failures = result.steps.filter((s) => !s.pass).map((s) => ({
    step: s.name,
    signature: failureSignature(s),
    rawError: s.raw || (s.asserts || []).filter((a) => !a.pass).map((a) => `${a.label}: ${a.raw || ''}`).join('\n'),
    screenshot: (s.shotAfter || {}).name || null,
  }));
  const payload = {
    round,
    at: new Date().toISOString(),
    unit: result.unit || null,
    smoke: { passed: result.steps.length - failures.length, total: result.steps.length },
    failures,
    changed: changed || [],
    hypothesis: hypothesis || '',
    verifiedHow: verifiedHow || '',
  };
  const file = path.join(outDir, `round-${round}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  return { file, payload };
}

// ─────────────────────────────────────────────────────────────
// 12 · 收尾
// ─────────────────────────────────────────────────────────────

/**
 * 冒烟收尾：合并页面侧信息 → 停留让用户看最后一眼 → 写报告 → 打印汇总 → 用退出码反映成败。
 * 用 app.exit() 而不是 app.quit()：托盘常驻 / before-quit 拦截会让冒烟永远卡住。
 */
async function finish({ app, win, outDir, result, writeReport }) {
  try {
    if (win && !win.isDestroyed()) await collectResourceGuards(win, result);
  } catch { /* 忽略 */ }
  result.safety = {
    consoleErrors: (result.console || []).filter((c) => c.level === 'error'),
    consoleWarnings: (result.console || []).filter((c) => c.level === 'warning'),
    resourceErrors: result.resources || [],
    unhandled: result.unhandled || [],
    hardErrors: result.hardErrors || [],
  };
  const stepFailed = result.steps.filter((s) => !s.pass).length;
  const failed = stepFailed + (result.fatal ? 1 : 0);
  result.summary = {
    unit: result.unit || null,
    smokePassed: result.steps.length - stepFailed,
    smokeTotal: result.steps.length,
    failed,
    finishedAt: new Date().toISOString(),
    slow: config.slow,
    fast: config.fast,
  };

  // 别跑完就消失：留一会儿让用户看最后一眼（有失败就多留一会儿）
  const holdMs = config.hold !== null ? config.hold : failed > 0 ? 10000 : 2000;
  if (holdMs > 0 && win && !win.isDestroyed()) {
    try {
      await hud(win, {
        text: failed > 0
          ? `有 ${failed} 项未通过 —— 窗口停留 ${(holdMs / 1000).toFixed(0)} 秒，你可以看一眼`
          : '全部通过 —— 窗口稍后自动关闭',
        status: failed > 0 ? '❌' : '✅',
      });
    } catch { /* 忽略 */ }
    console.log(`（窗口停留 ${(holdMs / 1000).toFixed(0)} 秒供你查看；SMOKE_HOLD=0 可关闭）`);
    await sleep(holdMs);
  }

  const reportPath = writeReport(outDir, result);
  const shotErrs = result.steps.filter((s) => s.shotError);
  console.log('');
  console.log(`单测 ${result.unit ? `${result.unit.passed}/${result.unit.total}` : '（未跑）'}`);
  console.log(`冒烟 ${result.summary.smokePassed}/${result.summary.smokeTotal}`);
  console.log(`速度 ${config.fast ? '全速（SMOKE_FAST=1）' : `慢速 ${config.slow}ms/步`}`);
  if (result.safety.consoleErrors.length) console.log(`console 报错 ${result.safety.consoleErrors.length} 条`);
  if (result.safety.hardErrors.length) console.log(`硬错误 ${result.safety.hardErrors.length} 条`);
  if (shotErrs.length) console.log(`⚠️ 有 ${shotErrs.length} 个功能没截到图：${shotErrs.map((s) => s.name).join('、')}`);
  console.log(`报告：${reportPath}`);
  console.log(`临时数据目录（没碰真实数据）：${result.tmpRoot || '(未设置)'}`);
  app.exit(failed > 0 || result.safety.hardErrors.length > 0 ? 1 : 0);
}

module.exports = {
  config,
  waitFor,
  sleep,
  evalIn,
  rectOf,
  visibilityExpr,
  styleExpr,
  textExpr,
  countExpr,
  attrExpr,
  resourceFailuresExpr,
  showWindow,
  installOverlay,
  hud,
  cursorMove,
  cursorRipple,
  scrollIntoView,
  clickAt,
  clickPoint,
  doubleClickAt,
  hoverAt,
  dragTo,
  pressKey,
  focusEl,
  typeText,
  shot,
  attachSafetyNet,
  injectResourceGuards,
  collectResourceGuards,
  makeAssert,
  makeRecorder,
  feature,
  runOp,
  runSteps,
  fingerprint,
  failureSignature,
  writeRound,
  finish,
  sanitize,
};
