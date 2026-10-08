'use strict';
/**
 * 一次性排版审计探针（用完即删）：照规格书 §04「逐格控件清单」逐条量实际渲染值。
 * 只读，不改任何生产代码。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const electron = require('electron');
const { app, BrowserWindow, dialog } = electron;

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'tests', 'artifacts', 'audit-' + stamp);
fs.mkdirSync(outDir, { recursive: true });

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
app.setPath('userData', path.join(tmpRoot, 'userData'));
app.setPath('sessionData', path.join(tmpRoot, 'userData'));
app.setPath('appData', tmpRoot);
process.env.APP_DATA_DIR = path.join(tmpRoot, 'data');
fs.mkdirSync(process.env.APP_DATA_DIR, { recursive: true });

const S = require(path.join(__dirname, '..', 'tests', 'smoke', 'helpers.js'));

const sampleDir = path.join(tmpRoot, 'samples');
fs.mkdirSync(sampleDir, { recursive: true });
const sampleFiles = ['广告素材-01.png', '广告素材-02.png', '夏季新品广告主图.jpg', '主图-04-备用.jpg', 'banner广告位-05.png', '广告素材-06.gif']
  .map((n) => { const p = path.join(sampleDir, n); fs.writeFileSync(p, 'x', 'utf8'); return p; });
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: sampleFiles });

/** 在渲染进程里量：每条 = {项, 期望, 实测} */
const AUDIT = `(() => {
  const cs = (sel, prop) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[prop] : null; };
  const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect();
    return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, x: Math.round(r.left), y: Math.round(r.top) }; };
  const rows = [];
  const add = (area, item, expected, actual) => rows.push({ area, item, expected, actual });
  const px = (sel, prop, expected, item, area) => add(area, item, expected, cs(sel, prop));
  const box = (sel, dim, expected, item, area) => { const r = rect(sel); add(area, item, expected, r ? r[dim] + (dim === 'w' || dim === 'h' ? 'px' : '') : 'MISSING'); };

  /* ── 标题栏 ── */
  add('标题栏', '高度', '46px', cs('.md-titlebar', 'height'));
  box('.md-titlebar__mark', 'w', '24px', '品牌猫头宽', '标题栏');
  px('.md-titlebar__name', 'fontSize', '13.5px', '品牌字字号', '标题栏');
  px('.md-titlebar__name', 'letterSpacing', '2px', '品牌字字距', '标题栏');
  px('.md-titlebar__sub', 'fontSize', '11px', '状态副题字号', '标题栏');
  box('.md-tbtn', 'h', '30px', '胶囊高', '标题栏');
  px('.md-tbtn', 'borderRadius', '99px', '胶囊圆角', '标题栏');
  px('.md-tbtn', 'fontSize', '11.5px', '胶囊字号', '标题栏');
  box('.md-winbtn', 'w', '32px', '窗口键宽', '标题栏');
  box('.md-winbtn', 'h', '30px', '窗口键高', '标题栏');

  /* ── A 猫块 ── */
  box('.md-catstage__hero', 'w', '240px', '猫槽宽', 'A 猫块');
  add('A 猫块', '猫宽（offsetWidth，不含动画 transform）', '224px', (() => { const el = document.querySelector('.md-cat'); return el ? el.offsetWidth + 'px' : 'MISSING'; })());
  add('A 猫块', '猫高（offsetHeight）', '209px', (() => { const el = document.querySelector('.md-cat'); return el ? el.offsetHeight + 'px' : 'MISSING'; })());
  box('.md-ring', 'w', '100px', '环直径', 'A 猫块');
  px('.md-ring__value', 'fontSize', '23px', '环心数字字号', 'A 猫块');
  px('.md-ring__value', 'fontWeight', '600', '环心数字字重', 'A 猫块');
  add('A 猫块', '状态灯直径（offsetWidth）', '7px', (() => { const el = document.querySelector('.md-catstage__lamp'); return el ? el.offsetWidth + 'px' : 'MISSING'; })());
  px('.md-catstage__sttext', 'fontSize', '13px', '状态文案字号', 'A 猫块');
  px('.md-catstage__sub', 'fontSize', '11.5px', '副行字号', 'A 猫块');
    add('A 猫块', '环 r / 线宽', '40 / 6px', (() => { const c = document.querySelector('.md-ring__arc'); return c ? c.getAttribute('r') + ' / ' + getComputedStyle(c).strokeWidth : 'MISSING'; })());

  /* ── B/C/D 统计卡 ── */
  px('.md-stat .md-stat__eyebrow', 'fontSize', '9.5px', '标签字号', 'B/C/D 统计卡');
  px('.md-stat .md-stat__eyebrow', 'letterSpacing', '1.7px', '标签字距', 'B/C/D 统计卡');
  add('B/C/D 统计卡', '大数字字号', '60px', cs('.md-stat .md-stat__value', 'fontSize'));
  add('B/C/D 统计卡', '大数字字距', '-1.5px', cs('.md-stat .md-stat__value', 'letterSpacing'));
  add('B/C/D 统计卡', '分段条高', '7px', cs('.md-stat .md-stat__cell', 'height'));
  add('B/C/D 统计卡', '分段条间距', '13px', cs('.md-stat .md-stat__bar', 'marginTop'));
  add('B/C/D 统计卡', '分段条圆角', '3px', cs('.md-stat .md-stat__cell', 'borderRadius'));
  add('B/C/D 统计卡', '说明字号/颜色', '11px / rgb(91, 85, 78)', cs('.md-stat .md-stat__caption', 'fontSize') + ' / ' + cs('.md-stat .md-stat__caption', 'color'));

  /* ── E 规则块 ── */
  box('.md-tpl__chip', 'h', '26px', '模板 chip 高', 'E 规则块');
  px('.md-tpl__chip', 'borderRadius', '9px', '模板 chip 圆角', 'E 规则块');
  add('E 规则块', '模板条是否一行（label 与 chips 同一行）', '同一行',
    (() => { const t = document.querySelector('.md-tpl__title'); const c = document.querySelector('.md-tpl__chip');
      return (t && c && Math.abs(t.getBoundingClientRect().top - c.getBoundingClientRect().top) < 8) ? '同一行' : '两行'; })());
  box('.md-tab', 'h', '32px', '页签高', 'E 规则块');
  px('.md-tab', 'borderRadius', '99px', '页签圆角', 'E 规则块');
  px('.md-tab', 'fontSize', '12px', '页签字号', 'E 规则块');
  px('.md-tabsrow__label', 'fontSize', '9.5px', 'Rule/规则 标签字号', 'E 规则块');
  px('.md-tabsrow__label', 'letterSpacing', '1.7px', 'Rule/规则 标签字距', 'E 规则块');
  add('E 规则块', '选中页签字重', '600', cs('.md-tab--active', 'fontWeight'));
  add('E 规则块', '一句话 字号/字重/行高/字距', '25px / 600 / 37.5px / -0.2px',
    [cs('.md-sentence__text','fontSize'), cs('.md-sentence__text','fontWeight'), cs('.md-sentence__text','lineHeight'), cs('.md-sentence__text','letterSpacing')].join(' / '));
  add('E 规则块', '一句话 是否还有底色盒（设计稿无盒）', 'rgba(0, 0, 0, 0)', cs('.md-sentence', 'backgroundColor'));
  add('E 规则块', '「规则」标签 字号/字距', '9.5px / 1.7px',
    cs('.md-sentence__label', 'fontSize') + ' / ' + cs('.md-sentence__label', 'letterSpacing'));
  add('E 规则块', '底栏主排：开关/说明/真源句 是否同一排', '3 个子块 / 1 排（md-switch, md-hint, md-rulefoot__motto）',
    (() => { const row = document.querySelector('.md-rulefoot__row'); if (!row) return 'MISSING';
      const kids = Array.from(row.children);
      const centers = kids.map((el) => { const r = el.getBoundingClientRect(); return Math.round((r.top + r.height / 2) / 4); });
      const uniq = [...new Set(centers)];
      return kids.length + ' 个子块 / ' + uniq.length + ' 排（' + kids.map((el) => el.className.split(' ')[0]).join(', ') + '）'; })());
  add('E 规则块', '底栏主排是否把文字压出框（scrollWidth 差）', '0 / 说明被压 0px',
    (() => { const row = document.querySelector('.md-rulefoot__row'); const note = document.querySelector('.md-rulefoot__note');
      if (!row || !note) return 'MISSING';
      return (row.scrollWidth - row.clientWidth) + ' / 说明被压 ' + Math.max(0, note.scrollWidth - note.clientWidth) + 'px'; })());
  add('E 规则块', '底栏总排数（主排 + 进阶排）', '2',
    (() => { const f = document.querySelector('.md-rulepanel__foot'); if (!f) return 'MISSING';
      return f.children.length; })());

  /* ── F 文件表 ── */
  box('.md-filelist__head', 'h', '42px', '头部高', 'F 文件表');
  box('.md-filelist__cols', 'h', '30px', '列头行高', 'F 文件表');
  box('.md-filelist__row', 'h', '46px', '行高', 'F 文件表');
  add('F 文件表', '行内边距（上/右/下/左）', '0px / 20px / 0px / 20px', [cs('.md-filelist__row','paddingTop'), cs('.md-filelist__row','paddingRight'), cs('.md-filelist__row','paddingBottom'), cs('.md-filelist__row','paddingLeft')].join(' / '));
  px('.md-filelist__cols', 'fontSize', '9.5px', '列头字号', 'F 文件表');
  px('.md-filelist__cols', 'letterSpacing', '1.4px', '列头字距', 'F 文件表');
  px('.md-filelist__no', 'fontSize', '11px', '行号字号', 'F 文件表');
  px('.md-filelist__sttext', 'fontSize', '10px', '状态字字号', 'F 文件表');
  box('.md-filelist__foot', 'h', '54px', '摘要条高', 'F 文件表');
  box('.md-filelist__pill', 'h', '32px', '小胶囊高', 'F 文件表');
  add('F 文件表', '分段条高/间距', '8px / 3px', cs('.md-filelist__stack', 'height') + ' / ' + cs('.md-filelist__stack', 'gap'));
  px('.md-filelist__lg', 'fontSize', '11px', '图例字号', 'F 文件表');

  /* ── G 控件块 ── */
  px('.md-glabel', 'fontSize', '11.5px', '参数标签字号', 'G 控件块');
  box('.md-ginput', 'h', '34px', '输入框高', 'G 控件块');
  px('.md-ginput', 'borderRadius', '6px', '输入框圆角', 'G 控件块');
  add('G 控件块', '行标签宽（38px 写死）', '38px', cs('.md-grow__l', 'flexBasis'));
  add('G 控件块', '开关尺寸', '40px / 23px / 17px', [cs('.md-switch--sm .md-switch__track','width'), cs('.md-switch--sm .md-switch__track','height'), cs('.md-switch--sm .md-switch__thumb','width')].join(' / '));
  add('G 控件块', '数字框宽', '56px', cs('.md-gnum', 'width'));
  px('.md-attradv__bar', 'height', '30px', '属性折叠条高', 'G 控件块');
  px('.md-attradv__bar', 'borderRadius', '6px', '属性折叠条圆角', 'G 控件块');

  /* ── H 执行块 ── */
  box('.md-actionbar .md-btn', 'h', '52px', '主按钮高', 'H 执行块');
  add('H 执行块', '主按钮宽 / 卡片内容区宽', '431 / 内容区 431px', (() => {
    const b = document.querySelector('.md-actionbar .md-btn'); const f = document.querySelector('.md-actionbar');
    if (!b || !f) return 'MISSING';
    const inner = f.clientWidth - parseFloat(getComputedStyle(f).paddingLeft) - parseFloat(getComputedStyle(f).paddingRight); return Math.round(b.getBoundingClientRect().width) + ' / 内容区 ' + Math.round(inner) + 'px';
  })());

  /* ── 验收四条（施工单开头）── */
  add('验收四条', '窗口内高（px，固定不长高）', '900', innerHeight);
  add('验收四条', '文件行高（px，恒定）', '46px', (() => { const el = document.querySelector('.md-filelist__row'); return el ? getComputedStyle(el).height : 'MISSING'; })());
  add('验收四条', '环心数字相对圆心偏移（dx / dy）', '0 / 0', (() => {
    const R = document.querySelector('.md-ring'); const V = document.querySelector('.md-ring__value');
    if (!R || !V) return 'MISSING'; const a = R.getBoundingClientRect(); const b = V.getBoundingClientRect();
    return (Math.round((b.left + b.width / 2 - (a.left + a.width / 2)) * 100) / 100) + ' / ' + (Math.round((b.top + b.height / 2 - (a.top + a.height / 2)) * 100) / 100); })());
  add('验收四条', '全窗口滚动条（应恰好 2 条：G 格 + 文件列表）', '2', (() => {
    const out = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const c = getComputedStyle(el);
      if ((c.overflowY === 'auto' || c.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1) out.push(el);
    }
    return out.length + '（' + out.map((el) => el.hasAttribute('data-numbering') ? 'G格' : el.classList.contains('md-filelist__body') ? '文件列表' : el.className).join(', ') + '）'; })());
  add('验收四条', '主区是否溢出（应为 false）', 'false', (() => { const m = document.querySelector('.md-main'); return m ? String(m.scrollHeight > m.clientHeight + 1) : 'MISSING'; })());
  add('验收四条', '规则块是否溢出（应为 false）', 'false', (() => { const el = document.querySelector('.md-rulepanel'); return el ? String(el.scrollHeight > el.clientHeight + 1) : 'MISSING'; })());

  return JSON.stringify(rows);
})()`;

/** 高亮词测量：切到替换模式、填入两个值之后跑 */
const HL_AUDIT = `(() => {
  const t = document.querySelector('[data-rule-sentence]');
  const hl = Array.from(document.querySelectorAll('.md-sentence__hl'));
  const s = hl[0] ? getComputedStyle(hl[0]) : null;
  return JSON.stringify({
    sentence: t ? t.textContent.replace(/\\s+/g, ' ').trim() : null,
    hlCount: hl.length,
    hlTexts: hl.map((e) => e.textContent),
    hlStyle: s ? { fontSize: s.fontSize, color: s.color, bg: s.backgroundColor, border: s.borderTopWidth + ' ' + s.borderTopColor, radius: s.borderTopLeftRadius, padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].join(' ') } : null,
  });
})()`;

/** 最小窗口复核：底栏换行行为 + 验收四条 */
const NARROW_AUDIT = `(() => {
  const row = document.querySelector('.md-rulefoot__row');
  const note = document.querySelector('.md-rulefoot__note');
  const motto = document.querySelector('.md-rulefoot__motto');
  const kids = row ? Array.from(row.children) : [];
  const centers = kids.map((el) => { const r = el.getBoundingClientRect(); return Math.round((r.top + r.height / 2) / 4); });
  const scrollables = [];
  for (const el of Array.from(document.querySelectorAll('*'))) {
    const cs = getComputedStyle(el);
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
      scrollables.push(el.hasAttribute('data-numbering') ? 'numbering(G格)' : el.classList.contains('md-filelist__body') ? 'filelist-body' : el.className);
    }
  }
  const ring = document.querySelector('.md-ring'); const val = document.querySelector('.md-ring__value');
  let ringOffset = null;
  if (ring && val) { const R = ring.getBoundingClientRect(); const V = val.getBoundingClientRect();
    ringOffset = { dx: Math.round((V.left + V.width / 2 - (R.left + R.width / 2)) * 100) / 100, dy: Math.round((V.top + V.height / 2 - (R.top + R.height / 2)) * 100) / 100 }; }
  const fileRow = document.querySelector('.md-filelist__row');
  return JSON.stringify({
    inner: [innerWidth, innerHeight],
    footerRows: kids.length + ' 个子块 / ' + [...new Set(centers)].length + ' 排',
    noteClipped: note ? Math.max(0, note.scrollWidth - note.clientWidth) + 'px' : 'MISSING',
    mottoWrapped: motto && note ? (motto.getBoundingClientRect().top > note.getBoundingClientRect().top + 8) : null,
    scrollables,
    rowH: fileRow ? Math.round(fileRow.getBoundingClientRect().height) : null,
    ringOffset,
    mainOver: (() => { const m = document.querySelector('.md-main'); return m ? m.scrollHeight + '/' + m.clientHeight : null; })(),
    gridBox: (() => { const g = document.querySelector('.md-grid'); return g ? g.scrollHeight + '/' + g.clientHeight + ' rows=' + getComputedStyle(g).gridTemplateRows : null; })(),
    boxes: (() => { const q = (sel) => { const el = document.querySelector(sel); if (!el) return 'MISS';
        const r = el.getBoundingClientRect(); return Math.round(r.height) + 'x' + Math.round(r.width) + (el.scrollHeight > el.clientHeight + 1 ? '(溢出' + (el.scrollHeight - el.clientHeight) + ')' : '') + (el.scrollWidth > el.clientWidth + 1 ? '(横溢' + (el.scrollWidth - el.clientWidth) + ')' : ''); };
      return { cat: q('.md-catstage'), stat1: q('.md-stat'), rule: q('.md-rulepanel'), list: q('.md-filelist'), num: q('[data-numbering]'), go: q('.md-actionbar'), hero: q('.md-catstage__hero'), ring: q('.md-ring') }; })(),
    catParts: (() => { const r = (sel) => { const el = document.querySelector(sel); if (!el) return 'MISS'; const b = el.getBoundingClientRect(); return Math.round(b.height) + 'x' + Math.round(b.width); };
      const cs = (sel, prop) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[prop] : 'MISS'; };
      return { hero: r('.md-catstage__hero'), cat: r('.md-cat'), svg: r('.md-c'), side: r('.md-catstage__side'), ring: r('.md-ring'),
        heroHeightCss: cs('.md-catstage__hero', 'height'), cardHeightCss: cs('.md-catstage', 'height'), cardAlign: cs('.md-catstage', 'alignItems'),
        heroAlignSelf: cs('.md-catstage__hero', 'alignSelf') }; })(),
  });
})()`;

app.whenReady().then(async () => {
  const report = { rows: null, error: null, bounds: null };
  try {
    require(path.join(__dirname, '..', 'out', 'main', 'index.js'));
    const win = await S.waitFor(() => BrowserWindow.getAllWindows()[0], { timeout: 15000, label: '主窗口' });
    S.showWindow(win);
    await S.waitFor(() => !win.webContents.isLoading(), { timeout: 20000, label: '页面加载' });
    await new Promise((r) => setTimeout(r, 1200));
    report.bounds = win.getBounds();
    await S.evalIn(win, `(() => { const b = document.querySelector('[data-add-files]'); if (b) b.click(); return !!b; })()`);
    await S.waitFor(async () => (await S.evalIn(win, `document.querySelectorAll('.md-filelist__row').length`)) >= 6, { timeout: 15000, label: '入列' });
    await new Promise((r) => setTimeout(r, 1200));
    report.rows = JSON.parse(await S.evalIn(win, AUDIT));

    // ── 第二段：切到「替换」并填入两个值 → 量高亮词（设计 §04）──
    await S.evalIn(win, `(() => {
      const tab = Array.from(document.querySelectorAll('.md-rulepanel .md-tab')).find((t) => t.textContent.trim() === '替换');
      if (tab) tab.click();
      return !!tab; })()`);
    await new Promise((r) => setTimeout(r, 500)); // 等 Vue 把替换模式的参数框渲染出来
    await S.evalIn(win, `(() => {
      const set = (sel, v) => { const el = document.querySelector(sel); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } return !!el; };
      return set('input[placeholder="例如：最终版"]', '广告') && set('input[placeholder="留空 = 删除"]', '推广'); })()`);
    await new Promise((r) => setTimeout(r, 900));
    report.hl = JSON.parse(await S.evalIn(win, HL_AUDIT));
    await S.shot(win, outDir, 3, '替换模式-人话');
    await S.shot(win, outDir, 1, '1440x900');

    // ── 第三段：最小窗口 1180×760 —— 底栏要「换行不压字」，验收四条不能破 ──
    win.setSize(1180, 760);
    await new Promise((r) => setTimeout(r, 900));
    report.narrow = {
      bounds: win.getBounds(),
      page: JSON.parse(await S.evalIn(win, NARROW_AUDIT)),
    };
    await S.shot(win, outDir, 2, '1180x760');
  } catch (err) {
    report.error = String((err && err.stack) || err);
  } finally {
    fs.writeFileSync(path.join(outDir, 'audit.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log('AUDIT_DIR=' + outDir);
    try { app.exit(0); } catch { /* noop */ }
  }
});
