const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DIR = 'D:\\工作环境\\批量文件改名\\界面方案-2-科技感'
const PORT = 9335
const FILES = ['A-控制台.html', 'B-命令台.html', 'C-面板阵列.html', 'D-标签工作区.html', 'E-一页一步.html']

const PROBE = `(() => {
  const win = document.querySelector('.win');
  if (!win) return JSON.stringify({fatal:'no .win'});
  const r = win.getBoundingClientRect();
  // 真正不可见的元素（display:none / visibility:hidden）不参与测量，
  // 但不排除 opacity:0 —— 那是 hover 才显形的按钮，缺陷一样要抓。
  const vis = el => !el.checkVisibility || el.checkVisibility({ checkVisibilityCSS: true });
  const res = {
    winRect: [Math.round(r.width), Math.round(r.height)],
    winOffset: [win.offsetWidth, win.offsetHeight],
    winBg: getComputedStyle(win).backgroundColor,
    winColor: getComputedStyle(win).color,
    innerW: window.innerWidth,
    winTransform: getComputedStyle(win).transform,
    winScroll: [win.scrollWidth, win.clientWidth, win.scrollHeight, win.clientHeight]
  };

  // 1) 文字被容器截断（叶子节点）
  const clipped = [];
  document.querySelectorAll('.win *').forEach(el => {
    if (!vis(el)) return;
    if (el.children.length) return;
    const t = (el.textContent || '').trim();
    if (!t) return;
    if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
      clipped.push((el.className || el.tagName) + ' :: ' + t.slice(0, 18) + ' [' + el.scrollWidth + '>' + el.clientWidth + ']');
    }
  });
  res.clipped = clipped.slice(0, 20); res.clippedCount = clipped.length;

  // 2) 真逃逸：跑出父容器，且父容器没把溢出裁掉
  const esc = [];
  document.querySelectorAll('.win *').forEach(el => {
    if (!vis(el)) return;
    const p = el.parentElement; if (!p || p === win) return;
    const b = el.getBoundingClientRect(), pb = p.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) return;
    const ps = getComputedStyle(p);
    if ([ps.overflowX, ps.overflowY].some(v => v !== 'visible')) return;
    if (b.right > pb.right + 1.5 || b.bottom > pb.bottom + 1.5 || b.left < pb.left - 1.5 || b.top < pb.top - 1.5) {
      esc.push((el.className || el.tagName).split(' ')[0] + ' [' + Math.round(b.left) + ',' + Math.round(b.top) + ',' + Math.round(b.right) + ',' + Math.round(b.bottom) + '] 父 ' + (p.className || p.tagName).split(' ')[0] + ' [' + Math.round(pb.left) + ',' + Math.round(pb.top) + ',' + Math.round(pb.right) + ',' + Math.round(pb.bottom) + ']');
    }
  });
  res.escaped = esc.slice(0, 20); res.escapedCount = esc.length;

  // 3) 内容比盒子宽。只把「真的会被裁掉」的算缺陷（overflow 不是 visible）。
  //    可见溢出（例如故意撑大的点击区伪元素）单独列出来当参考，不算问题——
  //    那条路真正要防的是「超出父容器」，由第 2 条真逃逸负责，覆盖没有变松。
  const wide = [], wideVis = [];
  document.querySelectorAll('.win *').forEach(el => {
    if (!vis(el)) return;
    if (!(el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)) return;
    const ox = getComputedStyle(el).overflowX;
    const rec = (el.className || el.tagName).split(' ')[0] + ' 内容' + el.scrollWidth + '>盒' + el.clientWidth + ' (overflow-x:' + ox + ')';
    if (ox === 'visible') wideVis.push(rec); else wide.push(rec);
  });
  res.wide = wide.slice(0, 20); res.wideCount = wide.length;
  res.wideVis = wideVis.slice(0, 20); res.wideVisCount = wideVis.length;

  // 4) 需要滚动才看得全的内部容器
  const sc = [];
  document.querySelectorAll('.win *').forEach(el => {
    if (!vis(el)) return;
    const st = getComputedStyle(el);
    if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1)
      sc.push('纵向 ' + (el.className || el.tagName).split(' ')[0] + ' 内容 ' + el.scrollHeight + ' > 可视 ' + el.clientHeight);
    if ((st.overflowX === 'auto' || st.overflowX === 'scroll') && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)
      sc.push('横向 ' + (el.className || el.tagName).split(' ')[0] + ' 内容 ' + el.scrollWidth + ' > 可视 ' + el.clientWidth);
  });
  res.scrollers = sc.slice(0, 14); res.scrollerCount = sc.length;

  // 5) 窗口一级分区实际高度
  res.regions = [...win.children].filter(vis).map(el => {
    const b = el.getBoundingClientRect();
    return (el.className || el.tagName).split(' ')[0] + ' w' + Math.round(b.width) + ' h' + Math.round(b.height);
  });
  res.catUses = document.querySelectorAll('use[href="#catfig"]').length;

  // 6) 动效清单：有没有真的挂上、有没有 stagger
  const an = el => el ? getComputedStyle(el).animationName : '（无此元素）';
  const dl = el => el ? getComputedStyle(el).animationDelay : '-';
  const panels = [...document.querySelectorAll('.p')];
  res.anim = {
    panelCount: panels.length,
    panelAnimOn: panels.filter(p => getComputedStyle(p).animationName !== 'none').length,
    firstPanel: an(panels[0]) + ' @' + dl(panels[0]),
    lastPanel: an(panels[panels.length - 1]) + ' @' + dl(panels[panels.length - 1]),
    delays: panels.map(p => dl(p)).join(','),
    catBreathe: an(document.querySelector('.pa__breathe')),
    eyesBlink: an(document.querySelector('.eyes')),
    eyesPresent: !!document.querySelector('#eyesfig'),
    ringDraw: an(document.querySelector('.ring circle:last-of-type')),
    dotBreath: an(document.querySelector('.pa__st i')),
    reduceNow: matchMedia('(prefers-reduced-motion: reduce)').matches
  };

  // 7) 点击区实测：视觉尺寸 vs 真实可点区（靠 ::before 撑出来的）
  const hit = sel => { const el = document.querySelector(sel); if (!el) return sel + ' 无';
    const b = el.getBoundingClientRect(); const cs = getComputedStyle(el, '::before');
    const ip = (cs && cs.content !== 'none') ? [cs.top, cs.right, cs.bottom, cs.left].join(' ') : '无伪元素';
    return sel + ' 视觉 ' + Math.round(b.width) + '×' + Math.round(b.height) + ' · ::before inset ' + ip; };
  res.hits = [hit('.ck'), hit('.sw'), hit('.tab')];

  return JSON.stringify(res, null, 1);
})()`

// 模拟「系统开了减少动态效果」后，所有存在的动画都必须变成 none
const REDUCED = `(() => {
  const on = sel => { const el = document.querySelector(sel); return el ? getComputedStyle(el).animationName : '-'; };
  return JSON.stringify({
    reduceMatched: matchMedia('(prefers-reduced-motion: reduce)').matches,
    panel: on('.p'), breathe: on('.pa__breathe'), eyes: on('.eyes'), dot: on('.pa__st i'), ring: on('.ring circle:last-of-type')
  });
})()`

// 猫到底渲染出来没有：把内联的猫画进 canvas，数不透明像素 + 平均色。
// 我看不了图片，这是唯一能证明「那只橘猫真的画出来了」的办法。
const CAT = `(async () => {
  const out = { defs: !!document.getElementById('catfig'), eyes: !!document.getElementById('eyesfig'), uses: document.querySelectorAll('use[href="#catfig"]').length };
  try {
    const cs = getComputedStyle(document.querySelector('.win'));
    const cat  = cs.getPropertyValue('--cat').trim()  || '#F9C077';
    const catl = cs.getPropertyValue('--cat-line').trim() || '#B4712A';
    let s = new XMLSerializer().serializeToString(document.querySelector('svg defs'));
    s = s.replace(/var\\(--cat-line\\)/g, catl).replace(/var\\(--cat\\)/g, cat);
    const full = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 112" width="120" height="112">' + s + '<use href="#catfig"/><use href="#eyesfig"/></svg>';
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(full);
    await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('SVG 载不进 Image')) });
    const c = document.createElement('canvas'); c.width = 120; c.height = 112;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, 120, 112);
    const d = ctx.getImageData(0, 0, 120, 112).data;
    let n = 0, R = 0, G = 0, B = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40) { n++; R += d[i]; G += d[i + 1]; B += d[i + 2] }
    out.opaque = n;
    out.mean = n ? [Math.round(R / n), Math.round(G / n), Math.round(B / n)] : null;
    out.cover = +(n / (120 * 112) * 100).toFixed(1);
  } catch (e) { out.err = e.message }
  return JSON.stringify(out);
})()`

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  const profile = path.join(process.env.TEMP || '/tmp', 'cdp-probe-profile-2')
  fs.rmSync(profile, { recursive: true, force: true })
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--force-device-scale-factor=1', '--window-size=1520,1010',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: 'ignore' })

  let version = null
  for (let i = 0; i < 60; i++) {
    try { version = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break } catch (e) { await sleep(300) }
  }
  if (!version) { console.log('无法启动浏览器调试端口'); chrome.kill(); return }

  let list = []
  for (let i = 0; i < 60; i++) {
    try {
      list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()
      if (Array.isArray(list) && list.some(t => t.type === 'page' && t.webSocketDebuggerUrl)) break
    } catch (e) { }
    await sleep(400)
  }
  const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page) { console.log('没拿到可调试页面: ' + JSON.stringify(list.map(t => t.type)).slice(0, 300)); chrome.kill(); return }
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise(r => ws.addEventListener('open', r))

  let id = 0
  const pending = new Map()
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  })
  const send = (method, params) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })) })
  const evalAsync = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result.value

  await send('Page.enable')
  // 固定视口 1500 宽 → fit() 不缩放((1500-36)/1440 = 1.0167 > 1)，量到的就是真实 1440×900
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false })

  let bad = 0
  for (const f of FILES) {
    const target = 'file:///' + encodeURI(path.join(DIR, f).replace(/\\/g, '/'))
    await send('Page.navigate', { url: target })
    let ready = false
    for (let i = 0; i < 80; i++) {
      const st = await send('Runtime.evaluate', {
        expression: 'document.readyState === "complete" && !!document.querySelector(".win")',
        returnByValue: true
      })
      if (st.result && st.result.result && st.result.result.value === true) { ready = true; break }
      await sleep(150)
    }
    // 等入场动画彻底跑完（stagger 0.58s + 0.46s ≈ 1.05s），否则会量到动画途中的位置报假逃逸
    await sleep(1900)
    console.log('\n══════ ' + f + ' ══════')
    if (!ready) { console.log('页面没加载出 .win，跳过'); bad++; continue }
    const v = await evalAsync(PROBE)
    if (!v) { console.log('探针无返回'); bad++; continue }
    const d = JSON.parse(v)
    if (d.fatal) { console.log('探针报错: ' + d.fatal); bad++; continue }

    const okSize = d.winOffset[0] === 1440 && d.winOffset[1] === 900
    if (!okSize) bad++
    console.log('窗口尺寸      : ' + d.winOffset.join('×') + (okSize ? '  ✔ 1440×900' : '  ✘ 不对 rect=' + d.winRect.join('×')))
    console.log('自适应缩放    : 视口宽 ' + d.innerW + ' · transform=' + d.winTransform + (d.winTransform === 'none' ? '  ✔ 未缩放' : '  ⚠ 被缩放'))
    console.log('窗口底色/文字 : ' + d.winBg + '  /  ' + d.winColor)
    console.log('窗口自身滚动  : 横 ' + d.winScroll[0] + '>' + d.winScroll[1] + ' · 纵 ' + d.winScroll[2] + '>' + d.winScroll[3]
      + (d.winScroll[2] > d.winScroll[3] + 1 ? '   ✘ 内容超出窗口高度' : '   ✔ 装得下'))
    const flag = (n, arr, marker) => (n ? (marker ? '  ← ' + marker : '') + '\n   ' + arr.join('\n   ') : '   ✔ 无')
    console.log('文字被截断    : ' + d.clippedCount + flag(d.clippedCount, d.clipped))
    console.log('真逃逸(父未裁): ' + d.escapedCount + flag(d.escapedCount, d.escaped))
    console.log('内容宽于盒子  : 会被裁掉的 ' + d.wideCount + flag(d.wideCount, d.wide, '小图标被内边距压扁会出现这里'))
    console.log('               可见溢出（参考项，含故意撑大的点击区）: ' + d.wideVisCount + (d.wideVisCount ? ' → ' + d.wideVis.join(' | ') : ''))
    console.log('内部滚动容器  : ' + d.scrollerCount + flag(d.scrollerCount, d.scrollers))
    console.log('窗口一级分区  : ' + d.regions.join('\n               '))
    if (d.clippedCount || d.escapedCount || d.wideCount || d.winScroll[2] > d.winScroll[3] + 1) bad++

    const a = d.anim
    console.log('入场动效      : 面板 ' + a.panelCount + ' 块，' + a.panelAnimOn + ' 块挂上动画 · 第一块 ' + a.firstPanel + ' · 最后一块 ' + a.lastPanel)
    if (a.panelCount) console.log('                stagger 延迟序列: ' + a.delays)
    console.log('其它动效      : 猫呼吸=' + a.catBreathe + ' · 眨眼=' + a.eyesBlink + '（眼睛独立份 ' + (a.eyesPresent ? '在' : '无') + '）· 进度环=' + a.ringDraw + ' · 状态点=' + a.dotBreath)
    console.log('点击区实测    : ' + d.hits.join('\n               '))

    const catOut = await evalAsync(CAT)
    try {
      const c = JSON.parse(catOut)
      const looksOrange = c.mean && c.mean[0] > c.mean[1] && c.mean[1] > c.mean[2] && c.mean[0] > 150
      console.log('猫（像素级）  : defs ' + (c.defs ? '在' : '✘ 缺') + ' · 页面引用 ' + c.uses + ' 处 · 不透明像素 ' + (c.opaque || 0)
        + '（占画布 ' + c.cover + '%）· 平均色 rgb(' + (c.mean || []).join(',') + ')'
        + (c.err ? '  ✘ ' + c.err : (looksOrange && c.opaque > 1500 ? '  ✔ 橘色猫确实画出来了' : '  ✘ 像素不对，可能没渲染')))
      if (c.err || !looksOrange || !(c.opaque > 1500)) bad++
    } catch (e) { console.log('猫检测异常: ' + String(catOut).slice(0, 200)); bad++ }

    // 模拟系统开了「减少动态效果」：所有存在的动画都必须变成 none
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await sleep(260)
    const rm = JSON.parse(await evalAsync(REDUCED))
    const list2 = [['面板入场', rm.panel], ['猫呼吸', rm.breathe], ['眨眼', rm.eyes], ['状态点', rm.dot], ['进度环', rm.ring]]
    const exists = list2.filter(x => x[1] !== '-')
    const stillOn = exists.filter(x => x[1] !== 'none')
    console.log('减少动效模拟  : matchMedia 命中 ' + (rm.reduceMatched ? '✔ 是' : '✘ 否') + ' · 这份共 ' + exists.length + ' 项动画'
      + (exists.length ? (stillOn.length === 0 ? '  ✔ 全部已关' : '  ✘ 还有没关的: ' + stillOn.map(x => x[0]).join('/')) : '（这份本来就没动效）'))
    if (exists.length && (stillOn.length || !rm.reduceMatched)) bad++
    await send('Emulation.setEmulatedMedia', { features: [] })
    await sleep(150)

    await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 820, deviceScaleFactor: 1, mobile: false })
    await sleep(250)
    await send('Runtime.evaluate', { expression: 'window.dispatchEvent(new Event("resize"))' })
    await sleep(300)
    const n = JSON.parse(await evalAsync('JSON.stringify({iw:window.innerWidth,sw:document.documentElement.scrollWidth,ow:document.querySelector(".win").offsetWidth,w:Math.round(document.querySelector(".win").getBoundingClientRect().width)})'))
    console.log('窄视口 900px  : 视口' + n.iw + ' · 窗口渲染宽 ' + n.w + '（未缩放 ' + n.ow + '）· 页面横向滚动条 ' + (n.sw > n.iw + 2 ? '✘ 有' : '✔ 无'))
    if (n.sw > n.iw + 2) bad++
    await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false })
    await sleep(200)
  }

  console.log('\n─────────────────────────────')
  console.log(bad === 0 ? '五份全部通过硬判据 ✔' : '有 ' + bad + ' 处需要处理 ✘')
  ws.close()
  chrome.kill()
  await sleep(400)
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch (e) {}
  process.exit(0)
}
main().catch(e => { console.error('脚本异常:', e.message); process.exit(1) })
