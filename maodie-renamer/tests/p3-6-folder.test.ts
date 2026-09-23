/**
 * P3-6（提取文件夹名 · `{文件夹}` 变量）—— 单测。
 *
 * 运行：`npm run test:core`（**必须显式传本文件**，见 package.json 的 test:core）。
 *
 * 这个文件盯七件事（对应设计 §10 的测试要求）：
 *  1. `folderNameOf`：普通路径 / 结尾带分隔符 / **盘符根 `D:\`（天然空串）** / **裸盘符 `D:`（要挡）**
 *     / UNC / 共享根 / 隐藏文件夹 —— 逐条给期望值。
 *  2. ★ `{文件夹}` 走**完整链路**：`dirPath → folderNameOf → dirName → expand`（不是只测 `expand`）。
 *  3. 六个变量各替换各的；`{文件夹}` 出现两次都替换；不认识的 `{文件夹名}` **原样保留**。
 *  4. 盘符根**不报错、不标红、不出现 `D:_`**（设计 §3.2）。
 *  5. `rule-summary`：用了 `{文件夹}` 时有对应文案；**老摘要逐字节不变**。
 *  6. ★ `attr-vars` 是「**一处定义**」：遍历清单，每个变量的摘要都自动有文案。
 *  7. 老行为不变：不含 `{文件夹}` 的规则，输出与第 5 批**逐字节相同**。
 *
 * 规矩同前：只用 `node:test` + `node:assert`，不引入任何第三方框架。
 * 红线：**绝不为让测试变绿而放宽 / 跳过 / 删断言。**
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { ATTR_VARS } from '../src/shared/attr-vars'
import { folderNameOf } from '../src/shared/path-utils'
import { resolveItems } from '../src/shared/preview'
import { buildRuleSummary } from '../src/shared/rule-summary'
import { DEFAULT_RULE, type ItemAttrs, type RuleConfig } from '../src/shared/types'

const ROOT = process.cwd()
assert.ok(
  fs.existsSync(path.join(ROOT, 'package.json')),
  `单测必须在工程根目录下运行（当前 cwd = ${ROOT}）—— 用 npm run test:core`,
)

/* ══ 夹具 ═════════════════════════════════════════════════════════════ */

const NO_ATTRS: ItemAttrs = { created: '', modified: '', sizeBytes: null }

type CfgPatch = Partial<Omit<RuleConfig, 'delete' | 'replace' | 'rule' | 'insert'>> & {
  delete?: Partial<RuleConfig['delete']>
  replace?: Partial<RuleConfig['replace']>
  rule?: Partial<RuleConfig['rule']>
  insert?: Partial<RuleConfig['insert']>
}

/** 造一份完整 RuleConfig：从 DEFAULT_RULE 起底，四个子对象**逐层深合并** */
function cfg(patch: CfgPatch = {}): RuleConfig {
  return {
    ...DEFAULT_RULE,
    ...patch,
    delete: { ...DEFAULT_RULE.delete, ...(patch.delete ?? {}) },
    replace: { ...DEFAULT_RULE.replace, ...(patch.replace ?? {}) },
    insert: { ...DEFAULT_RULE.insert, ...(patch.insert ?? {}) },
    rule: { ...DEFAULT_RULE.rule, ...(patch.rule ?? {}) },
  }
}

/** 算一项（走真正的 `resolveItems` —— 与预览 / 执行同一条路）*/
function one(
  fromName: string,
  rule: RuleConfig,
  dirPath = 'D:\\素材\\2026',
  attrs: ItemAttrs = NO_ATTRS,
): ReturnType<typeof resolveItems>[number] {
  return resolveItems(
    [{ id: 'f1', dirPath, fromName, isDir: false, attrs }],
    rule,
    '2026-09-23',
    {},
    false,
  )[0]!
}

/* ══ 1. folderNameOf ══════════════════════════════════════════════════ */

test('folderNameOf：普通路径（正/反斜杠、结尾带分隔符都一样）', () => {
  assert.equal(folderNameOf('D:\\素材\\2026'), '2026')
  assert.equal(folderNameOf('D:\\素材\\2026\\'), '2026', '结尾多一个分隔符不影响')
  assert.equal(folderNameOf('D:/素材/2026'), '2026', '正斜杠也认')
})

test('★ folderNameOf：盘符根 —— `D:\\` 天然空串；裸盘符 `D:` 也要挡成空串', () => {
  // `dirName('D:\\照片.jpg')` 真正会产出的就是 `D:\` 这种形态
  assert.equal(folderNameOf('D:\\'), '', '带分隔符的盘符根：baseName 天然给空串')
  assert.equal(folderNameOf('D:'), '', '★ 裸盘符：必须挡住 —— 否则会产出带冒号的名字')
  assert.equal(folderNameOf('Z:'), '', '换个盘符同样')
})

test('folderNameOf：UNC 网络路径与共享根', () => {
  assert.equal(folderNameOf('\\\\服务器\\共享\\素材'), '素材')
  assert.equal(folderNameOf('\\\\服务器\\共享'), '共享', '共享根就用它自己的名字')
  assert.equal(folderNameOf('\\\\服务器\\共享\\'), '共享')
})

test('folderNameOf：隐藏文件夹（点开头）也照取', () => {
  assert.equal(folderNameOf('D:\\素材\\.git'), '.git')
})

/* ══ 2. ★ 完整链路：dirPath → folderNameOf → dirName → expand ═════════ */

test('★★ {文件夹} 走完整链路（TC-75/76/77：基本取值 / 盘符根 / UNC）', () => {
  const r = cfg({ mode: 'rule', rule: { prefix: '{文件夹}_' } })

  assert.equal(one('照片A.JPG', r).toName, '2026_照片A.JPG', '取直接上级文件夹的名字')
  assert.equal(one('说明.docx', r, 'D:\\素材\\待归档').toName, '待归档_说明.docx')
  assert.equal(one('照片C.JPG', r, 'D:\\').toName, '_照片C.JPG', '★ 盘符根 → 空串，不报错、不标红')
  assert.equal(one('报告.pdf', r, '\\\\服务器\\共享\\素材').toName, '素材_报告.pdf', '★ UNC 取最后一段')
})

test('★ 盘符根的那一项是「能改」而不是「非法」（TC-76 的关键）', () => {
  const out = one('照片C.JPG', cfg({ mode: 'rule', rule: { prefix: '{文件夹}_' } }), 'D:\\')
  assert.equal(out.outcome, 'ready', `盘符根不该被判非法（实际 ${out.outcome}：${out.reason ?? ''}）`)
  assert.equal(out.status, 'changed')
  assert.ok(!out.toName.includes(':'), '新名里绝不能出现冒号')
})

test('★ 文件夹本身改名：取的是它**父文件夹**的名字（TC-78）', () => {
  const it = resolveItems(
    [{ id: 'd1', dirPath: 'D:\\素材\\2026', fromName: '客户素材', isDir: true, attrs: NO_ATTRS }],
    cfg({ mode: 'rule', rule: { prefix: '{文件夹}_' } }),
    '2026-09-23',
    {},
    false,
  )[0]!
  assert.equal(it.ext, '', '文件夹没有扩展名概念')
  assert.equal(it.toName, '2026_客户素材', '取父文件夹名')
})

/* ══ 3. 六个变量 ══════════════════════════════════════════════════════ */

test('★ 六个变量各替换各的（新增 {文件夹} 不会吃掉别的）', () => {
  const r = cfg({
    mode: 'rule',
    rule: {
      prefix: '{n}|{d}|{创建}|{修改}|{大小}|{文件夹}',
      seqEnabled: true,
      seqPad: 0,
      seqPosition: 'prefix',
      dateEnabled: true,
      dateFormat: 'YYYYMMDD',
      sizeUnit: 'B',
    },
  })
  const out = one('x.jpg', r, 'D:\\素材\\2026', {
    created: '2026-09-18',
    modified: '2026-09-02',
    sizeBytes: 1024,
  })
  assert.equal(out.toName, '1|20260923|20260918|20260902|1024B|2026x.jpg')
})

test('{文件夹} 出现两次都替换（不是只换第一处）', () => {
  const r = cfg({ mode: 'rule', rule: { prefix: '{文件夹}-{文件夹}_', keepOriginal: false } })
  assert.equal(one('x.jpg', r).toName, '2026-2026_.jpg')
})

test('不认识的 {文件夹名} 原样保留（与其它变量的既有行为一致）', () => {
  const r = cfg({ mode: 'rule', rule: { prefix: '{文件夹名}_' } })
  assert.equal(one('x.jpg', r).toName, '{文件夹名}_x.jpg')
})

test('{文件夹} 写在「原文件名」里不替换（变量只作用于前后缀）', () => {
  // keepOriginal=true + 前缀为空 → 原主体 `{文件夹}` 原样保留
  const r = cfg({ mode: 'rule', rule: { prefix: '' } })
  assert.equal(one('{文件夹}.jpg', r).toName, '{文件夹}.jpg')
})

/* ══ 4. rule-summary ══════════════════════════════════════════════════ */

test('★ 摘要：用了 {文件夹} 时会出现「文件夹名」', () => {
  const s = buildRuleSummary(cfg({ mode: 'rule', rule: { prefix: '{文件夹}_' } }))
  assert.ok(s.includes('文件夹名'), `摘要里应出现「文件夹名」（实际：${s}）`)
})

test('★ 摘要：不含 {文件夹} 的规则，输出与第 5 批逐字节相同', () => {
  // 非空前缀会先出一段「前缀「…」」——这是既有写法，本批一个字没动
  assert.equal(
    buildRuleSummary(cfg({ mode: 'rule', rule: { prefix: '{创建}' } })),
    '前缀「{创建}」 + 创建日期 + 保留原名',
  )
  assert.equal(
    buildRuleSummary(cfg({ mode: 'rule', rule: { prefix: '{大小}', sizeUnit: 'MB' } })),
    '前缀「{大小}」 + 大小(MB) + 保留原名',
    '★ 单位仍然带在摘要里',
  )
})

/* ══ 5. ★ attr-vars 是「一处定义」══════════════════════════════════════ */

test('★ attr-vars：清单里每个变量的摘要都自动有文案（遍历数组，不是逐条硬写）', () => {
  for (const v of ATTR_VARS) {
    const r = cfg({ mode: 'rule', rule: { prefix: v.token } })
    const s = buildRuleSummary(r)
    assert.ok(
      s.includes(v.summary(r.rule)),
      `清单里的 ${v.token}（${v.label}）在摘要里没有对应文案 —— 「一处定义」没接上（实际：${s}）`,
    )
  }
})

test('attr-vars 清单：四个变量、token 不重复（本批就是 4 个）', () => {
  assert.equal(ATTR_VARS.length, 4, 'P3-6 之后是 4 个属性变量 —— 增删要先改设计')
  assert.deepEqual(
    ATTR_VARS.map((v) => v.token),
    ['{创建}', '{修改}', '{大小}', '{文件夹}'],
    '★ 次序即界面次序，「文件夹名」排在最后（不动既有三个的位置）',
  )
  assert.equal(new Set(ATTR_VARS.map((v) => v.token)).size, 4, 'token 有重复')
})

/* ══ 6. 老行为不变 ════════════════════════════════════════════════════ */

test('老行为不变：不含 {文件夹} 的规则，输出与第 5 批逐字节相同（文件夹名完全不参与）', () => {
  const r = cfg({
    mode: 'rule',
    rule: {
      prefix: '{创建}_{n}_',
      suffix: '_{大小}',
      seqEnabled: true,
      seqPad: 0,
      seqPosition: 'suffix',
      sizeUnit: 'KB',
    },
  })
  const out = one('x.jpg', r, 'D:\\别的文件夹', {
    created: '2026-09-18',
    modified: '',
    sizeBytes: 2048,
  })
  // ⚠️ 没设 dateFormat → 用默认的 'YYYY-MM-DD'（所以是 2026-09-18 而不是 20260918）
  assert.equal(out.toName, '2026-09-18_1_x_2.0KB.jpg')
})
