// 精确求解浅色主题的橘色：只针对页面里真实存在的底色组合。
// 现状核对：.add / .st--go 出现在 (a) 文件表行（底 #FAF8F5）、(b) 被选中行（底 = sel 罩面板）、
//           (c) 选中行里的 .add（底 = sel 罩 sel 罩面板，双重）
//           .pf 是普通面板（不是下沉面），所以「sel 罩下沉面」这个组合不存在，不纳入约束。
const fs = require('fs')
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

const PANEL = hex2rgb('#FAF8F5'), RAISE = hex2rgb('#FFFFFF'), SINK = hex2rgb('#E3DFD8')
const base = hex2rgb('#DA5A12'), [h, s] = rgb2hsl(...base)
const ALPHA = 0.10

const out = []
out.push('约束卡片（浅色主题）：')
out.push('')
let best = null
for (let i = 0; i <= 800; i++) {
  const l = 0.463 - i / 800 * 0.35
  const acc = hsl2rgb(h, s, l)
  const sel1 = over(acc, ALPHA, PANEL)
  const sel2 = over(acc, ALPHA, sel1)
  const cases = [
    ['面板底上写橘字', ratio(acc, PANEL), 4.5],
    ['抬起底上写橘字', ratio(acc, RAISE), 4.5],
    ['下沉底上写橘字', ratio(acc, SINK), 4.5],
    ['选中行底上写橘字（单层罩）', ratio(acc, sel1), 4.5],
    ['选中行里高亮字的底（双层罩）', ratio(acc, sel2), 4.5],
    ['白字压橘色按钮', ratio([255,255,255], acc), 4.5]
  ]
  if (cases.every(c => c[1] >= c[2])) { best = { hex: rgb2hex(acc), l, cases }; break }
}
if (!best) out.push('  找不到 ✘')
else {
  out.push('  原值 #DA5A12 的问题：')
  const oldAcc = base
  const oldSel1 = over(oldAcc, ALPHA, PANEL), oldSel2 = over(oldAcc, ALPHA, oldSel1)
  const oldCases = [['面板底', ratio(oldAcc,PANEL)],['抬起底', ratio(oldAcc,RAISE)],['下沉底', ratio(oldAcc,SINK)],
    ['选中行底', ratio(oldAcc,oldSel1)],['双层罩底', ratio(oldAcc,oldSel2)],['白字压按钮', ratio([255,255,255],oldAcc)]]
  oldCases.forEach(c => out.push('    ' + c[0].padEnd(12) + ' ' + c[1].toFixed(2) + ':1   ' + (c[1] >= 4.5 ? '✔' : '✘')))
  out.push('')
  out.push('  最小改动后的橘色：' + best.hex + '（明度 0.463 → ' + best.l.toFixed(3) + '，色相/饱和度不变）')
  best.cases.forEach(c => out.push('    ' + c[0].padEnd(24) + ' ' + c[1].toFixed(2) + ':1 (需 ' + c[2] + ') ' + (c[1] >= c[2] ? '✔' : '✘')))
  out.push('')
  out.push('  明度还能再高一点试试（放宽双层罩这条）：')
  for (let i = 0; i <= 800; i++) {
    const l = 0.463 - i / 800 * 0.35
    const acc = hsl2rgb(h, s, l)
    const sel1 = over(acc, ALPHA, PANEL)
    if (ratio(acc, PANEL) >= 4.5 && ratio(acc, sel1) >= 4.5 && ratio([255,255,255], acc) >= 4.5) {
      out.push('    只保「单层罩」时可以用 ' + rgb2hex(acc) + '（明度 ' + l.toFixed(3) + '，选中行底上 ' + ratio(acc, sel1).toFixed(2) + ':1）')
      break
    }
  }
}
out.push('')
out.push('下沉面说明字色（.fbarcap）:')
for (const c of ['#6E685F', '#5B554E', '#4A443D']) out.push('  ' + c + ' 压下沉底 #E3DFD8 = ' + ratio(hex2rgb(c), SINK).toFixed(2) + ':1')

const s2 = out.join('\n')
fs.writeFileSync('D:\\工作环境\\批量文件改名\\界面方案-2-科技感\\.colorfix-out.txt', s2, 'utf8')
console.log(s2)
