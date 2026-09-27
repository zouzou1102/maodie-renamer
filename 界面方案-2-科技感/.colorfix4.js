// 最后 0.01：浅色 --ink3 差一点点（4.49 → 需 4.50），压在选中行淡底上。
const hex2rgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
const rgb2hex = a => '#' + a.map(v => Math.round(v).toString(16).padStart(2, '0').toUpperCase()).join('')
const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b), hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05) }
const over = (src, a, dst) => [src[0]*a+dst[0]*(1-a), src[1]*a+dst[1]*(1-a), src[2]*a+dst[2]*(1-a)]
function rgb2hsl(r,g,b){r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;let h=0,s=0,l=(mx+mn)/2
  if(d){s=l>.5?d/(2-mx-mn):d/(mx+mn);h=mx===r?((g-b)/d+(g<b?6:0)):mx===g?(b-r)/d+2:(r-g)/d+4;h/=6}return [h,s,l]}
function hsl2rgb(h,s,l){if(!s){const v=l*255;return[v,v,v]}const q=l<.5?l*(1+s):l+s-l*s,p=2*l-q
  const f=t=>{t=(t+1)%1;return t<1/6?p+(q-p)*6*t:t<.5?q:t<2/3?p+(q-p)*(2/3-t)*6:p};return[f(h+1/3)*255,f(h)*255,f(h-1/3)*255]}

const PANEL=hex2rgb('#FAF8F5'), RAISE=hex2rgb('#FFFFFF'), SINK=hex2rgb('#E3DFD8'), ACC=hex2rgb('#A1420D')
const sel1 = over(ACC, .10, PANEL)
const bgList = [['面板底',PANEL],['抬起底',RAISE],['下沉底',SINK],['选中行底',sel1]]
const base = hex2rgb('#6E685F'); const [h,s,l0]=rgb2hsl(...base)
let best=null
for(let i=0;i<=400;i++){
  const l=l0 - i/400*0.12
  const c=hsl2rgb(h,s,l)
  if(bgList.every(([,bg])=>ratio(c,bg)>=4.5)){ best={hex:rgb2hex(c),l,list:bgList.map(([n,bg])=>n+' '+ratio(c,bg).toFixed(2))}; break }
}
const out=[]
out.push('浅色 --ink3 求解（原 #6E685F）：')
bgList.forEach(([n,bg])=>out.push('  原值压'+n+' = '+ratio(base,bg).toFixed(2)+':1 '+(ratio(base,bg)>=4.5?'✔':'✘')))
out.push(best ? '  → '+best.hex+'（明度 '+l0.toFixed(3)+' → '+best.l.toFixed(3)+'）  '+best.list.join(' · ')+'  ✔ 全部达标'
  : '  找不到 ✘')
const t=out.join('\n'); require('fs').writeFileSync('D:\\工作环境\\批量文件改名\\界面方案-2-科技感\\.colorfix-out.txt',t,'utf8'); console.log(t)
