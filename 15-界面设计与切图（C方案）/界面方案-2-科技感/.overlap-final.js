// 定稿口径：原始 class 名（去重）− 「五套全都有」的公共外壳类名 → 两两 Jaccard
// 依据：A/B/D/E 未改动，该口径复现出 64/45/42/30（原矩阵 66/49/43/31，差 0~4，属同口径）
const fs = require('fs'); const path = require('path')
const DIR = 'D:\\工作环境\\批量文件改名\\界面方案-2-科技感'
const FILES = [['A','A-控制台.html'],['B','B-命令台.html'],['C','C-面板阵列.html'],['D','D-标签工作区.html'],['E','E-一页一步.html']]
const raw = {}
for (const [k, f] of FILES) {
  const h = fs.readFileSync(path.join(DIR, f), 'utf8'); const s = new Set()
  const re = /class\s*=\s*"([^"]*)"/g; let m
  while ((m = re.exec(h))) m[1].split(/\s+/).filter(Boolean).forEach(c => s.add(c))
  raw[k] = s
}
const keys = FILES.map(f => f[0])
const all = new Set(keys.flatMap(k => [...raw[k]]))
const common = new Set([...all].filter(c => keys.every(k => raw[k].has(c))))
const sets = {}; for (const k of keys) sets[k] = new Set([...raw[k]].filter(c => !common.has(c)))
const pct = (a,b) => { const i=[...sets[a]].filter(x=>sets[b].has(x)).length; const u=new Set([...sets[a],...sets[b]]).size; return {i,u,p:i/u*100} }

const L = []
L.push('公共外壳类名（五套全有，共 ' + common.size + ' 个）: ' + [...common].sort().join(' '))
L.push('各套「零件类名」个数: ' + keys.map(k => k + '=' + sets[k].size + '（原始 ' + raw[k].size + '）').join(' · '))
L.push('')
L.push('矩阵（行 A · 列 B，单位 %）:')
for (const a of keys) L.push('  ' + a + ' | ' + keys.map(b => (a===b?'  —  ':pct(a,b).p.toFixed(1).padStart(5)).padEnd(7)).join(''))
L.push('')
L.push('两两:')
for (let i=0;i<5;i++) for (let j=i+1;j<5;j++) { const r=pct(keys[i],keys[j])
  L.push('  ' + keys[i]+'+'+keys[j] + '  重合 ' + r.p.toFixed(1) + '%（交 '+r.i+'/并 '+r.u+'）  相差 ' + (100-r.p).toFixed(1) + '%') }
L.push('')
const combos = []
for (let i=0;i<5;i++) for (let j=i+1;j<5;j++) for (let k=j+1;k<5;k++) {
  const g=[keys[i],keys[j],keys[k]]
  const ds=[100-pct(g[0],g[1]).p,100-pct(g[0],g[2]).p,100-pct(g[1],g[2]).p]
  combos.push({g:g.join(' + '), min:Math.min(...ds), ds:ds.map(d=>d.toFixed(1)+'%').join(' / ')})
}
combos.sort((x,y)=>y.min-x.min)
L.push('三份一组（按最低相差降序）:')
combos.forEach(c => L.push('  ' + c.g.padEnd(14) + ' 相差 ' + c.ds.padEnd(26) + ' 最低 ' + c.min.toFixed(1) + '%' + (c.min>=90?'  ✔ 达标':'')))
L.push('')
const pairs = []; for (let i=0;i<5;i++) for (let j=i+1;j<5;j++) pairs.push({p:keys[i]+'+'+keys[j], v:pct(keys[i],keys[j]).p})
pairs.sort((x,y)=>y.v-x.v)
L.push('最像的一对: ' + pairs[0].p + ' 重合 ' + pairs[0].v.toFixed(1) + '%')
L.push('最不像的一对: ' + pairs[pairs.length-1].p + ' 重合 ' + pairs[pairs.length-1].v.toFixed(1) + '%')
const s = L.join('\n')
fs.writeFileSync(path.join(DIR,'.overlap-final.txt'), s, 'utf8')
console.log(s)
