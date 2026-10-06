const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DIR = 'D:\\工作环境\\批量文件改名\\界面方案-2-科技感'
const OUT = path.join(DIR, 'shots')
const PORT = 9336
const FILES = [
  ['A-控制台.html', 'A-控制台'],
  ['B-命令台.html', 'B-命令台'],
  ['C-面板阵列.html', 'C-面板阵列'],
  ['D-标签工作区.html', 'D-标签工作区'],
  ['E-一页一步.html', 'E-一页一步']
]
const VW = 1500, DSF = 2
// 可选：只拍某一份，例如 `node .shots2.js C`
const ONLY = process.argv[2] || ''
const PICK = ONLY ? FILES.filter(f => f[0].startsWith(ONLY)) : FILES
if (!PICK.length) { console.log('没有匹配的方案: ' + ONLY); process.exit(1) }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const profile = path.join(process.env.TEMP || '/tmp', 'cdp-shot-profile-2')
  fs.rmSync(profile, { recursive: true, force: true })
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--force-device-scale-factor=' + DSF, '--window-size=1520,1060',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: 'ignore' })

  let ok = false
  for (let i = 0; i < 60; i++) {
    try { await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); ok = true; break } catch (e) { await sleep(300) }
  }
  if (!ok) { console.log('无法启动浏览器'); chrome.kill(); return }

  let list = []
  for (let i = 0; i < 60; i++) {
    try {
      list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()
      if (Array.isArray(list) && list.some(t => t.type === 'page' && t.webSocketDebuggerUrl)) break
    } catch (e) { }
    await sleep(400)
  }
  const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page) { console.log('没拿到页面'); chrome.kill(); return }
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise(r => ws.addEventListener('open', r))
  let id = 0; const pending = new Map()
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  })
  const send = (method, params) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })) })
  const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.result.value

  await send('Page.enable')

  for (const [file, base] of PICK) {
    await send('Emulation.setDeviceMetricsOverride', { width: VW, height: 1020, deviceScaleFactor: DSF, mobile: false })
    await send('Page.navigate', { url: 'file:///' + encodeURI(path.join(DIR, file).replace(/\\/g, '/')) })
    for (let i = 0; i < 80; i++) {
      const r = await ev('document.readyState === "complete" && !!document.querySelector(".win")')
      if (r === true) break
      await sleep(150)
    }
    // 等入场动画「落定」再拍：面板全部回到 opacity:1/transform:none，且进度环画完。
    // 固定 sleep 会拍到动画中途（入场最晚 0.58s+0.46s、进度环 0.35s+1.35s），
    // 所以这里逐帧读 computedStyle 判定终态，最多等 12s，再兜 250ms。
    for (let i = 0; i < 80; i++) {
      const settled = await ev(`(()=>{
        var ps=[].slice.call(document.querySelectorAll('.p'));
        var bad=ps.filter(function(p){var s=getComputedStyle(p);return s.opacity!=='1'||s.transform!=='none'});
        var r=document.querySelector('.ring circle:last-of-type');
        var ringOK=true;
        if(r){var s=getComputedStyle(r);
          ringOK = s.animationName==='none' || (parseFloat(s.strokeDasharray)||0) >= 209}
        return bad.length===0 && ringOK;
      })()`)
      if (settled === true) break
      await sleep(150)
    }
    await sleep(250)
    const h = await ev('document.documentElement.scrollHeight')
    await send('Emulation.setDeviceMetricsOverride', { width: VW, height: Math.max(h, 900), deviceScaleFactor: DSF, mobile: false })
    await sleep(500)
    await ev('window.dispatchEvent(new Event("resize"))')
    await sleep(400)

    let s = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(OUT, base + '-默认.png'), Buffer.from(s.result.data, 'base64'))
    const theme = await ev('getComputedStyle(document.querySelector(".win")).backgroundColor')
    console.log('✔ ' + base + '-默认.png   页面 ' + (h * DSF) + 'px 高 · 窗口底色 ' + theme)

    // 切到另一个颜色，再拍一张
    const clicked = await ev(`(()=>{var b=[...document.querySelectorAll('.pgbar button')].find(x=>!x.classList.contains('on'));if(!b)return '';b.click();return b.textContent.trim()})()`)
    if (clicked) {
      await sleep(700)
      s = await send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(OUT, base + '-另色(' + clicked + ').png'), Buffer.from(s.result.data, 'base64'))
      const t2 = await ev('getComputedStyle(document.querySelector(".win")).backgroundColor')
      console.log('✔ ' + base + '-另色(' + clicked + ').png · 窗口底色 ' + t2)
    }
  }

  console.log('\n输出目录: ' + OUT)
  ws.close(); chrome.kill(); await sleep(400)
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch (e) { }
  process.exit(0)
}
main().catch(e => { console.error('脚本异常:', e.message); process.exit(1) })
