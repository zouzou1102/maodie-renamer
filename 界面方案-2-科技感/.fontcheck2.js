const { spawn } = require('child_process'); const path=require('path'); const fs=require('fs');
const CHROME='C://Program Files\\Google\\Chrome\\Application\\chrome.exe'; const PORT=9338;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const profile=path.join(process.env.TEMP||'/tmp','cdp-font-profile2');
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
  await send('Page.navigate',{url:'about:blank'}); await sleep(400);
  const expr=`(()=>{
    const probe=(fam,txt)=>{const d=document.createElement('div');d.style.cssText='position:absolute;left:-9999px;font-size:40px;white-space:nowrap;font-family:'+fam;d.textContent=txt;document.body.appendChild(d);const w=d.getBoundingClientRect().width;d.remove();return w};
    const FAKE='"__no_such_font_zz__",serif';
    const rows={};
    [['Bahnschrift','Bahnschrift,serif'],['Segoe UI Variable Text','"Segoe UI Variable Text",serif'],['Segoe UI Variable Display','"Segoe UI Variable Display",serif'],['Segoe UI','"Segoe UI",serif'],['Cascadia Mono','"Cascadia Mono",serif'],['Noto Sans SC','"Noto Sans SC",serif'],['Microsoft YaHei','"Microsoft YaHei",serif']]
      .forEach(([nm,fam])=>{const a=probe(fam,'耄耋改名 Rename 0123');const b=probe(FAKE,'耄耋改名 Rename 0123');
        rows[nm]={w:Math.round(a*10)/10,fallback:Math.round(b*10)/10,real:Math.abs(a-b)>0.5}});
    return JSON.stringify(rows);
  })()`;
  const out=await send('Runtime.evaluate',{expression:expr,returnByValue:true});
  const r=JSON.parse(out.result.result.value);
  console.log('宽度对比法（真字体 vs 故意写错的字体名，宽度必须不同才算真有）:');
  for(const [k,v] of Object.entries(r))
    console.log('  '+k.padEnd(26)+String(v.w).padStart(7)+'px   回落时 '+String(v.fallback).padStart(7)+'px   '+(v.real?'真有 ✔':'其实没有，走了回落 ✘'));
  ws.close();ch.kill();await sleep(300); try{fs.rmSync(profile,{recursive:true,force:true})}catch(e){} process.exit(0);
})();
