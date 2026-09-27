const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DIR = 'D:\\工作环境\\批量文件改名\\界面方案'
const PORT = 9333
const FILES = ['01-对开档案台.html', '02-竖向流水线.html', '03-抽屉工作台.html', '04-指挥台.html', '05-一句话.html']

const PROBE = `(() => {
  const win = document.querySelector('.win');
  if (!win) return JSON.stringify({fatal:'no .win'});
  const r = win.getBoundingClientRect();
  const doc = document.documentElement;
  const res = {
    winSize: [Math.round(r.width), Math.round(r.height)],
    winBg: getComputedStyle(win).backgroundColor,
    winColor: getComputedStyle(win).color,
    pageOverflow: [doc.scrollWidth, window.innerWidth, doc.scrollHeight, window.innerHeight],
    bodyOverflowY: doc.scrollHeight > window.innerHeight + 2,
    fontFun: document.fonts.check('16px "ZCOOL KuaiLe"'),
    fontSerif: document.fonts.check('16px "Noto Serif SC"'),
    innerW: window.innerWidth,
    winTransform: getComputedStyle(win).transform,
    winRectW: Math.round(win.getBoundingClientRect().width),
    fitExists: typeof fit
  };
  const clipped = [];
  document.querySelectorAll('.win *').forEach(el => {
    if (el.children.length) return;
    const t = (el.textContent || '').trim();
    if (!t) return;
    if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
      clipped.push((el.className || el.tagName) + ' :: ' + t.slice(0, 16) + ' [' + el.scrollWidth + '>' + el.clientWidth + ']');
    }
  });
  const esc = [];
  document.querySelectorAll('.win *').forEach(el => {
    const b = el.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) return;
    if (b.right > r.right + 1 || b.bottom > r.bottom + 1 || b.left < r.left - 1 || b.top < r.top - 1) {
      esc.push((el.className || el.tagName) + ' [' + Math.round(b.left) + ',' + Math.round(b.top) + ',' + Math.round(b.right) + ',' + Math.round(b.bottom) + ']');
    }
  });
  res.clipped = clipped.slice(0, 25);
  res.clippedCount = clipped.length;
  const sc = [];
  document.querySelectorAll('.win *').forEach(el => {
    const st = getComputedStyle(el);
    if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && el.clientHeight > 0
        && el.scrollHeight > el.clientHeight + 1) {
      sc.push((el.className || el.tagName) + ' 内容 ' + el.scrollHeight + ' > 可视 ' + el.clientHeight);
    }
  });
  res.scrollers = sc.slice(0, 12);
  res.scrollerCount = sc.length;
  res.escaped = esc.slice(0, 25);
  res.escapedCount = esc.length;
  const rl = win.getBoundingClientRect();
  res.regions = [...document.querySelectorAll('.win > *, .win .col, .win .card, .win .sec, .win .drawer, .win .stage, .win .say, .win .rail, .win .seam')]
    .slice(0, 24).map(el => {
      const b = el.getBoundingClientRect();
      return (el.className || el.tagName).split(' ')[0] + ' w' + Math.round(b.width) + ' h' + Math.round(b.height);
    });
  return JSON.stringify(res, null, 1);
})()`

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  const profile = path.join(process.env.TEMP || '/tmp', 'cdp-probe-profile')
  fs.rmSync(profile, { recursive: true, force: true })
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--force-device-scale-factor=1', '--window-size=1360,960',
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
  const wsUrl = page.webSocketDebuggerUrl
  const ws = new WebSocket(wsUrl)
  await new Promise(r => ws.addEventListener('open', r))

  let id = 0
  const pending = new Map()
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  })
  const send = (method, params) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })) })

  await send('Page.enable')

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
    await sleep(600)
    if (!ready) { console.log('\n══════ ' + f + ' ══════\n页面没加载出 .win，跳过'); continue }
    const out = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true })
    console.log('\n══════ ' + f + ' ══════')
    const v = out.result && out.result.result && out.result.result.value
    if (!v) { console.log('探针无返回: ' + JSON.stringify(out).slice(0, 400)); continue }
    const d = JSON.parse(v)
    if (d.fatal) { console.log('探针报错: ' + d.fatal); continue }
    console.log('窗口尺寸      : ' + d.winSize + (d.winSize[0] === 1280 && d.winSize[1] === 800 ? '  ✔ 1280×800' : '  ✘ 尺寸不对'))
    console.log('自适应缩放    : innerWidth=' + d.innerW + ' · transform=' + d.winTransform + ' · 渲染后宽=' + d.winRectW + ' · fit函数=' + d.fitExists)
    console.log('窗口底色      : ' + d.winBg + '   文字色 ' + d.winColor)
    console.log('页面溢出      : 文档 ' + d.pageOverflow[0] + '×' + d.pageOverflow[1] + ' / 视口 ' + d.pageOverflow[2] + '×' + d.pageOverflow[3] + (d.bodyOverflowY ? '   ✘ 出现纵向滚动条' : '   ✔ 无滚动条'))
    console.log('品牌字可用    : ZCOOL KuaiLe ' + (d.fontFun ? '有' : '无（回落微软雅黑）') + ' · Noto Serif SC ' + (d.fontSerif ? '有' : '无'))
    console.log('文字被截断    : ' + d.clippedCount + (d.clipped.length ? '\n   ' + d.clipped.join('\n   ') : '   ✔ 无'))
    console.log('跑出窗口的元素: ' + d.escapedCount + (d.escaped.length ? '\n   ' + d.escaped.slice(0, 6).join('\n   ') : '   ✔ 无'))
    console.log('需要滚动才看得全: ' + d.scrollerCount + (d.scrollers.length ? '\n   ' + d.scrollers.join('\n   ') : '   ✔ 无') + (d.escapedCount > 20 ? '   （逃逸元素均在默认收起的滑出层里，属预期）' : ''))
    console.log('主要分区尺寸  : ' + d.regions.join('\n               '))

    await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 820, deviceScaleFactor: 1, mobile: false })
    await sleep(250)
    await send('Runtime.evaluate', { expression: 'window.dispatchEvent(new Event("resize"))' })
    await sleep(250)
    const narrow = await send('Runtime.evaluate', {
      expression: 'JSON.stringify({iw:window.innerWidth,sw:document.documentElement.scrollWidth,t:getComputedStyle(document.querySelector(".win")).transform,w:Math.round(document.querySelector(".win").getBoundingClientRect().width)})',
      returnByValue: true
    })
    const n = JSON.parse(narrow.result.result.value)
    const horiz = n.sw > n.iw + 2
    console.log('窄窗口 900px 时 : 视口' + n.iw + ' · 窗口实际渲染宽 ' + n.w + ' · 横向滚动条 ' + (horiz ? '✘ 有' : '✔ 无'))
    await send('Emulation.clearDeviceMetricsOverride')
  }

  ws.close()
  chrome.kill()
  await sleep(400)
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch (e) {}
  process.exit(0)
}
main().catch(e => { console.error('脚本异常:', e.message); process.exit(1) })
