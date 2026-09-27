const { spawn } = require('child_process'); const path=require('path'); const fs=require('fs');
const CHROME='C://Program Files\\Google\\Chrome\\Application\\chrome.exe'; const PORT=9341;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const E=`(()=>{
  const pf=document.querySelector('.pf');
  const cs=getComputedStyle(pf);
  const kids=[...pf.children].map(c=>{const b=c.getBoundingClientRect();const s=getComputedStyle(c);
    return {cls:(c.className||c.tagName).split(' ').slice(0,2).join('.'),
      h:Math.round(b.height), flex:s.flex, minH:s.minHeight, mt:s.marginTop, bt:Math.round(b.top)};});
  return JSON.stringify({pfH:Math.round(pf.getBoundingClientRect().height), pfDir:cs.flexDirection, kids}, null, 1);
})()`;
(async()=>{
  const profile=path.join(process.env.TEMP||'/tmp','cdp-c2-profile');
  fs.rmSync(profile,{recursive:true,force:true});
  const ch=spawn(CHROME,['--headless=new','--disable-gpu','--hide-scrollbars','--no-first-run',
    '--force-device-scale-factor=1','--window-size=1520,1010','--remote-debugging-port='+PORT,'--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
  let list=[];
  for(let i=0;i<60;i++){try{list=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();if(list.some(t=>t.type==='page'&&t.webSocketDebuggerUrl))break}catch(e){}await sleep(350)}
  const p=list.find(t=>t.type==='page'&&t.webSocketDebuggerUrl);
  const ws=new WebSocket(p.webSocketDebuggerUrl); await new Promise(r=>ws.addEventListener('open',r));
  let id=0; const pend=new Map();
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}});
  const send=(m,pa)=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:pa||{}}))});
  const ev=async e=>(await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true})).result.result.value;
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'file:///'+encodeURI(path.join('D://工作环境//批量文件改名//界面方案-2-科技感','C-面板阵列.html').replace(/\\/g,'/'))});
  for(let i=0;i<80;i++){const r=await ev('document.readyState==="complete" && !!document.querySelector(".win")');if(r===true)break;await sleep(150)}
  await sleep(2000);
  const d=JSON.parse(await ev(E));
  console.log('.pf 高 '+d.pfH+' · flex-direction '+d.pfDir);
  d.kids.forEach(k=>console.log('  '+k.cls.padEnd(12)+' 高 '+String(k.h).padStart(3)+'  top '+String(k.bt).padStart(4)
    +'   flex: '+k.flex.padEnd(14)+' min-height '+k.minH.padEnd(6)+' margin-top '+k.mt));
  ws.close();ch.kill();await sleep(300); try{fs.rmSync(profile,{recursive:true,force:true})}catch(e){} process.exit(0);
})();
