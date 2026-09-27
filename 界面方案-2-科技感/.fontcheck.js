const { spawn } = require('child_process'); const path=require('path'); const fs=require('fs');
const CHROME='C://Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT=9337;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const profile=path.join(process.env.TEMP||'/tmp','cdp-font-profile');
  fs.rmSync(profile,{recursive:true,force:true});
  const ch=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
  let list=[];
  for(let i=0;i<60;i++){try{list=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();if(list.some(t=>t.type==='page'&&t.webSocketDebuggerUrl))break}catch(e){}await sleep(350)}
  const p=list.find(t=>t.type==='page'&&t.webSocketDebuggerUrl);
  const ws=new WebSocket(p.webSocketDebuggerUrl); await new Promise(r=>ws.addEventListener('open',r));
  let id=0; const pend=new Map();
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}});
  const send=(m,pa)=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:pa||{}}))});
  await send('Page.enable');
  await send('Page.navigate',{url:'file:///'+encodeURI('D:/工作环境/批量文件改名/界面方案-2-科技感/A-控制台.html')});
  for(let i=0;i<60;i++){const r=await send('Runtime.evaluate',{expression:'document.readyState==="complete"',returnByValue:true});if(r.result.result.value)break;await sleep(150)}
  await sleep(600);
  const expr=`JSON.stringify({
    bahnschrift: document.fonts.check('16px Bahnschrift'),
    segVText: document.fonts.check('16px "Segoe UI Variable Text"'),
    segVDisplay: document.fonts.check('16px "Segoe UI Variable Display"'),
    segoe: document.fonts.check('16px "Segoe UI"'),
    cascadia: document.fonts.check('16px "Cascadia Mono"'),
    notoSC: document.fonts.check('16px "Noto Sans SC"'),
    measuredBody: (()=>{const d=document.createElement('div');d.style.font='16px ' + getComputedStyle(document.querySelector('.win')).fontFamily;d.style.position='absolute';d.textContent='耄耋改名 ABC 123';document.body.appendChild(d);const w=d.getBoundingClientRect().width;d.remove();return Math.round(w)})(),
    measuredMono: (()=>{const d=document.createElement('div');d.style.font='16px ' + getComputedStyle(document.querySelector('.win')).getPropertyValue('--mono');d.style.position='absolute';d.textContent='0123456789';document.body.appendChild(d);const w=d.getBoundingClientRect().width;d.remove();return Math.round(w)})()
  })`;
  const out=await send('Runtime.evaluate',{expression:expr,returnByValue:true});
  const d=JSON.parse(out.result.result.value);
  console.log('字体可用性（本机 Chromium）:');
  console.log('  Bahnschrift              '+(d.bahnschrift?'有 ✔':'无 ✘'));
  console.log('  Segoe UI Variable Text   '+(d.segVText?'有 ✔':'无 ✘'));
  console.log('  Segoe UI Variable Display'+(d.segVDisplay?'有 ✔':'无 ✘'));
  console.log('  Segoe UI                 '+(d.segoe?'有 ✔':'无 ✘'));
  console.log('  Cascadia Mono            '+(d.cascadia?'有 ✔':'无 ✘'));
  console.log('  Noto Sans SC             '+(d.notoSC?'有 ✔':'无 ✘'));
  console.log('  正文「耄耋改名 ABC 123」16px 实测宽: '+d.measuredBody+'px');
  console.log('  等宽「0123456789」16px 实测宽    : '+d.measuredMono+'px');
  ws.close();ch.kill();await sleep(300);
  try{fs.rmSync(profile,{recursive:true,force:true})}catch(e){}
  process.exit(0);
})();
