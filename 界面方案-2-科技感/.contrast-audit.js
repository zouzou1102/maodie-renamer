// 对比度真审计：在浏览器里遍历 .win 子树所有「有直接文字」的元素，
// 自动解析实际生效的底色（含半透明层叠），按字号/字重决定门槛（大字 3:1，普通字 4.5:1），
// 逐条报出对比度不足的元素。深浅两个主题各跑一遍。
const { spawn } = require('child_process'); const path = require('path'); const fs = require('fs')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DIR = 'D:\\工作环境\\批量文件改名\\界面方案-2-科技感'
const PORT = 9345
const sleep = ms => new Promise(r => setTimeout(r, ms))

const AUDIT = `(()=>{
  function parse(c){ if(!c) return null; const m=c.match(/rgba?\\(([^)]+)\\)/); if(!m) return null;
    const p=m[1].split(',').map(Number); return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1} }
  function over(src,dst){ return {r:src.r*src.a+dst.r*(1-src.a), g:src.g*src.a+dst.g*(1-src.a), b:src.b*src.a+dst.b*(1-src.a), a:1} }
  function effBg(el){
    const layers=[]; let n=el;
    while(n && n.nodeType===1){
      const c=parse(getComputedStyle(n).backgroundColor);
      if(c && c.a>0){ layers.push(c); if(c.a>=1) break }
      n=n.parentElement;
    }
    let acc={r:255,g:255,b:255,a:1};
    for(let i=layers.length-1;i>=0;i--) acc=over(layers[i],acc);
    return acc;
  }
  const lin=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};
  const lum=c=>0.2126*lin(c.r)+0.7152*lin(c.g)+0.0722*lin(c.b);
  const ratio=(a,b)=>{const l1=lum(a),l2=lum(b);const hi=Math.max(l1,l2),lo=Math.min(l1,l2);return (hi+0.05)/(lo+0.05)};

  const root=document.querySelector('.win'); if(!root) return JSON.stringify({err:'没有 .win'});
  const bad=[], checked=[];
  root.querySelectorAll('*').forEach(el=>{
    // 只看「自己有文字」的元素
    let hasText=false;
    el.childNodes.forEach(n=>{ if(n.nodeType===3 && n.textContent.trim()) hasText=true });
    if(!hasText) return;
    const s=getComputedStyle(el);
    if(s.display==='none'||s.visibility!=='visible') return;
    if(parseFloat(s.opacity)===0) return;
    // 祖先 opacity 为 0（入场动画未落定）也跳过
    let p=el, hidden=false;
    while(p && p.nodeType===1){ if(parseFloat(getComputedStyle(p).opacity)===0){hidden=true;break} p=p.parentElement }
    if(hidden) return;

    const fg=parse(s.color); if(!fg) return;
    const bg=effBg(el);
    const fgSolid={r:fg.r,g:fg.g,b:fg.b,a:1};
    const fs2=parseFloat(s.fontSize), w=parseInt(s.fontWeight)||400;
    const big = fs2>=24 || (fs2>=18.66 && w>=700);
    const need = big?3:4.5;
    const r=ratio(fgSolid,bg);
    const cls=(el.className&&el.className.baseVal!==undefined?el.className.baseVal:el.className)||el.tagName;
    const item={ cls:String(cls).split(' ').join('.')||el.tagName, txt:el.textContent.trim().slice(0,22),
      fs:fs2, w:w, need:need, got:Math.round(r*100)/100,
      fg:'rgb('+Math.round(fg.r)+','+Math.round(fg.g)+','+Math.round(fg.b)+')',
      bg:'rgb('+Math.round(bg.r)+','+Math.round(bg.g)+','+Math.round(bg.b)+')' };
    checked.push(item);
    if(r < need) bad.push(item);
  });
  checked.sort((a,b)=>a.got-b.got);
  return JSON.stringify({ n:checked.length, bad:bad, worst:checked.slice(0,6), theme:document.documentElement.getAttribute('data-theme')||'dark' });
})()`

;(async () => {
  const profile = path.join(process.env.TEMP || '/tmp', 'cdp-ca-profile')
  fs.rmSync(profile, { recursive: true, force: true })
  const ch = spawn(CHROME, ['--headless=new','--disable-gpu','--hide-scrollbars','--no-first-run',
    '--force-device-scale-factor=1','--window-size=1520,1010','--remote-debugging-port='+PORT,
    '--user-data-dir='+profile,'about:blank'], { stdio: 'ignore' })
  let list = []
  for (let i = 0; i < 60; i++) { try { list = await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json(); if (list.some(t=>t.type==='page'&&t.webSocketDebuggerUrl)) break } catch(e){} await sleep(350) }
  const p = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl)
  const ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r))
  let id = 0; const pend = new Map()
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } })
  const send = (m, pa) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: pa || {} })) })
  const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.result.value
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: 'file:///' + encodeURI(path.join(DIR, 'C-面板阵列.html').replace(/\\/g, '/')) })
  for (let i = 0; i < 80; i++) { const r = await ev('document.readyState==="complete" && !!document.querySelector(".win")'); if (r === true) break; await sleep(150) }
  await sleep(2600)   // 等入场动画完全结束，否则 opacity:0 的会被算进来

  const out = []
  for (const theme of ['dark', 'light']) {
    await ev(`(function(){ var t=document.documentElement.getAttribute('data-theme');
      var want='${theme==='dark'?'dark':'light'}';
      if((t||'dark')!==want){ var b=[].slice.call(document.querySelectorAll('.pgbar button'));
        var hit=b.find(function(x){return want==='light'? x.textContent.indexOf('浅')>=0 : x.textContent.indexOf('深')>=0});
        if(hit) hit.click(); } })()`)
    await sleep(900)
    const d = JSON.parse(await ev(AUDIT))
    out.push('══════ 主题 ' + theme + '（实测 ' + d.theme + '）· 共检查 ' + d.n + ' 处文字 ══════')
    if (d.bad.length === 0) out.push('  ✔ 没有不达标的')
    else {
      out.push('  ✘ 不达标 ' + d.bad.length + ' 处：')
      d.bad.forEach(b => out.push('    ' + b.cls.padEnd(22) + ' 「' + b.txt + '」  ' + b.fs.toFixed(1) + 'px/' + b.w
        + '  需 ' + b.need + ':1  实测 ' + b.got + ':1   字色 ' + b.fg + ' 底 ' + b.bg))
    }
    out.push('  —— 最接近门槛的 6 处（越低越险）——')
    d.worst.forEach(b => out.push('    ' + b.cls.padEnd(22) + ' 「' + b.txt + '」  ' + b.fs.toFixed(1) + 'px  需 ' + b.need
      + ':1  实测 ' + b.got + ':1   ' + (b.got >= b.need ? '✔' : '✘')))
    out.push('')
  }
  ws.close(); ch.kill(); await sleep(300); try { fs.rmSync(profile, { recursive: true, force: true }) } catch (e) {}
  const s = out.join('\n')
  fs.writeFileSync(path.join(DIR, '.contrast-audit.txt'), s, 'utf8')
  console.log(s)
  process.exit(0)
})().catch(e => { console.error('异常:', e.message); process.exit(1) })
