const { spawn } = require('child_process'); const path=require('path'); const fs=require('fs');
const CHROME='C://Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DIR='D://工作环境//批量文件改名//界面方案-2-科技感'; const PORT=9339;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const EXPR=`(()=>{
  const pvs=[...document.querySelectorAll('.pv')];
  const rows=pvs.map((b,i)=>{
    const f=b.querySelector('iframe');
    const r=b.getBoundingClientRect(), fr=f.getBoundingClientRect();
    let inner='';
    try{ const d=f.contentDocument; const w=d&&d.querySelector('.win');
      inner = w ? (w.offsetWidth+'x'+w.offsetHeight) : '没有 .win'; }catch(e){ inner='跨域读不到' }
    return { i, boxW:Math.round(r.width), boxH:Math.round(r.height), ifW:Math.round(fr.width), ifH:Math.round(fr.height),
             t:getComputedStyle(f).transform, inner, filled: Math.abs(fr.width-r.width)<2 && Math.abs(fr.height-r.height)<2 };
  });
  return JSON.stringify({
    iw: window.innerWidth, sw: document.documentElement.scrollWidth,
    n: pvs.length,
    imgs: document.querySelectorAll('img').length,
    badImgs: [...document.images].filter(im=>!im.complete||im.naturalWidth===0).map(im=>im.getAttribute('src')),
    rows
  });
})()`;
(async()=>{
  const profile=path.join(process.env.TEMP||'/tmp','cdp-ov-profile');
  fs.rmSync(profile,{recursive:true,force:true});
  const ch=spawn(CHROME,['--headless=new','--disable-gpu','--hide-scrollbars','--no-first-run',
    '--allow-file-access-from-files','--force-device-scale-factor=1','--window-size=1300,1000',
    '--remote-debugging-port='+PORT,'--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
  let list=[];
  for(let i=0;i<60;i++){try{list=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();if(list.some(t=>t.type==='page'&&t.webSocketDebuggerUrl))break}catch(e){}await sleep(350)}
  const p=list.find(t=>t.type==='page'&&t.webSocketDebuggerUrl);
  const ws=new WebSocket(p.webSocketDebuggerUrl); await new Promise(r=>ws.addEventListener('open',r));
  let id=0; const pend=new Map();
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}});
  const send=(m,pa)=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:pa||{}}))});
  const ev=async e=>(await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true})).result.result.value;
  await send('Page.enable');
  await send('Page.navigate',{url:'file:///'+encodeURI(path.join(DIR,'总览对比.html').replace(/\\/g,'/'))});
  for(let i=0;i<60;i++){const r=await ev('document.readyState==="complete"');if(r)break;await sleep(150)}
  await sleep(2500);
  for(const W of [1300, 1000, 760, 420]){
    await send('Emulation.setDeviceMetricsOverride',{width:W,height:1000,deviceScaleFactor:1,mobile:false});
    await sleep(200); await ev('window.dispatchEvent(new Event("resize"))'); await sleep(600);
    const d=JSON.parse(await ev(EXPR));
    console.log('\n──── 视口宽 '+W+'px ────');
    console.log('  页面横向滚动条 : ' + (d.sw>d.iw+2 ? '✘ 有 ('+d.sw+'>'+d.iw+')' : '✔ 无'));
    console.log('  方案格数       : '+d.n+' 个 iframe');
    console.log('  加载失败的图   : '+(d.badImgs.length?d.badImgs.join(', '):'✔ 无（本页没用图片）'));
    d.rows.forEach(r=>{
      console.log('   #'+(r.i+1)+' 格子 '+r.boxW+'×'+r.boxH+' · 缩放后 iframe '+r.ifW+'×'+r.ifH
        +' · transform='+r.t+(r.filled?'  ✔ 正好铺满':'  ✘ 没铺满')
        +' · 里面窗口 '+(r.inner==='1440x900'?'1440×900 ✔':r.inner));
    });
  }
  ws.close();ch.kill();await sleep(300); try{fs.rmSync(profile,{recursive:true,force:true})}catch(e){} process.exit(0);
})();
