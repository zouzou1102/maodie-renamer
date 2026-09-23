/**
 * P3-3（按文件属性命名）—— 单测。
 *
 * 运行：`npm run test:core`（**必须显式传本文件**，见 package.json 的 test:core）。
 *
 * 这个文件盯九件事（对应设计 §10 的测试要求）：
 *  1. `sizeText`：auto 各档 / B 整数 / KB-MB-GB 一位小数 / **null 与 0 必须不同** / 负值与 NaN 不抛错。
 *  2. `ymdFromMs`：**本地时区**（凌晨 0:00–8:00 不能差一天）、跨年跨月、非法输入不抛错。
 *  3. ★ **`dateText` 对空串的短路**：`dateText('', 'YYYY年MM月DD日')` 会返回 `'年月日'`，
 *     而属性日期**真的可能为空** —— 所以 `applyRuleMode` 必须先判空再转格式。
 *  4. `applyRuleMode` 的 5 个变量：各一条 + 同一变量出现两次 + 不认识的 `{大少}` 原样保留。
 *  5. **属性冻结**：同一份 `attrs` 传两次 → 结果相同（预览 ≡ 执行的硬要求）。
 *  6. ★★ **预览 ≡ 执行**：Walk `buildPreview`（`PreviewItemInput` 形态）与 `buildRenamePlan`
 *     （`ExecuteItem` 形态）两条路，断言**两边都拿到了 attrs、算出的新名逐字节相等**。
 *     **`PreviewItemInput` 是 `Pick<FileItem, ...>` 的显式白名单** —— 漏一个字段
 *     `typecheck` 不会报错（合法子集），只能靠这条用例抓（设计 §7.5 第 1 行）。
 *  7. `sanitizeRule` 的 `sizeUnit`：非法值落 `'auto'`、合法值原样取出。
 *  8. `sanitizeAttrs`：非法值不得混成 `0`（`null` 与 `0` 是两种含义）。
 *  9. 老规则回归：不含属性变量的规则，输出与 P3-2 逐字节相同。
 *
 * 规矩同前：只用 `node:test` + `node:assert`，不引入任何第三方框架。
 * 红线：**绝不为让测试变绿而放宽 / 跳过 / 删断言。**
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { applyRuleMode, sizeText } from '../src/shared/rule-engine'
import { ymdFromMs } from '../src/shared/today'
import { sanitizeAttrs, sanitizeRule } from '../src/shared/sanitize-rule'
import { buildPreview } from '../src/shared/preview'
import { buildRenamePlan } from '../src/shared/rename-plan'
import {
  DEFAULT_RULE,
  type ItemAttrs,
  type PreviewItemInput,
  type RuleConfig,
} from '../src/shared/types'

const ROOT = process.cwd()
assert.ok(
  fs.existsSync(path.join(ROOT, 'package.json')),
  `单测必须在工程根目录下运行（当前 cwd = ${ROOT}）—— 用 npm run test:core`,
)

/** 造一份属性快照 */
function attrs(sizeBytes: number | null, created = '2026-09-18', modified = '2026-09-02'): ItemAttrs {
  return { created, modified, sizeBytes }
}

/** 造一条规则（默认值 + 覆写 rule 内部字段）*/
function rule(rulePatch: Partial<RuleConfig['rule']> = {}): RuleConfig {
  // ★ 必须显式置 `mode: 'rule'`：`DEFAULT_RULE.mode` 是 `'delete'`，
  //   而删除模式**根本不会走 `applyRuleMode`** —— 前后缀与属性变量都不生效。
  return {
    ...DEFAULT_RULE,
    mode: 'rule',
    rule: { ...DEFAULT_RULE.rule, ...rulePatch },
  }
}

/** 走 applyRuleMode（真引擎）*/
function gen(stem: string, r: RuleConfig, a: ItemAttrs): string {
  // ★ P3-6：`dirName` 是必填（形状跟随 —— 没改任何断言）
  return applyRuleMode(stem, r.rule, { index: 0, total: 1, date: '2026-09-21', seedKey: 'k', attrs: a, dirName: '素材' })
}

/* ══ 1. sizeText ══════════════════════════════════════════════════════ */

test('sizeText：auto 选第一个让数值 ≥ 1 的单位（1024 进制）', () => {
  assert.equal(sizeText(1, 'auto'), '1B')
  assert.equal(sizeText(1023, 'auto'), '1023B')
  assert.equal(sizeText(1024, 'auto'), '1.0KB')
  assert.equal(sizeText(2516582, 'auto'), '2.4MB')
  assert.equal(sizeText(1024 ** 3, 'auto'), '1.0GB')
  // 超过 1 GB 也停在 GB（不加 TB）
  assert.equal(sizeText(1024 ** 4, 'auto'), '1024.0GB')
})

test('sizeText：显式单位档（B 整数、KB/MB/GB 一位小数）', () => {
  assert.equal(sizeText(2516582, 'B'), '2516582B')
  assert.equal(sizeText(2516582, 'KB'), '2457.6KB')
  assert.equal(sizeText(2516582, 'MB'), '2.4MB')
  // 选了 GB 但文件很小 → 照实给 0.0GB，不自动纠正
  assert.equal(sizeText(2516582, 'GB'), '0.0GB')
  assert.equal(sizeText(0, 'MB'), '0.0MB')
})

test('★ sizeText：null（文件夹，不可用）与 0（真的空文件）必须产出不同结果', () => {
  // 把两者混为一谈，用户会以为自己的文件夹是空的
  assert.equal(sizeText(null, 'auto'), '', 'null 必须是空串')
  assert.equal(sizeText(0, 'auto'), '0B', '0 必须是 0B')
  assert.notEqual(sizeText(null, 'auto'), sizeText(0, 'auto'))
  assert.equal(sizeText(null, 'B'), '')
  assert.equal(sizeText(null, 'MB'), '')
})

test('sizeText：非法值（负 / NaN / Infinity）不抛错，一律空串', () => {
  assert.equal(sizeText(-1, 'auto'), '')
  assert.equal(sizeText(Number.NaN, 'auto'), '')
  assert.equal(sizeText(Number.POSITIVE_INFINITY, 'auto'), '')
})

/* ══ 2. ymdFromMs ═════════════════════════════════════════════════════ */

test('★ ymdFromMs：用本地时区算 —— 凌晨 0:00–8:00 创建的文件不能差一天', () => {
  // 本地时间 2026-09-18 02:00（东八区下 UTC 是 09-17 18:00）
  const localEarly = new Date(2026, 8, 18, 2, 0, 0)
  assert.equal(
    ymdFromMs(localEarly.getTime()),
    '2026-09-18',
    '必须按本地日期算；若实现用了 toISOString()，这里会得到 2026-09-17（差一天）',
  )
  // 同一天的 23:59 也是同一天
  const localLate = new Date(2026, 8, 18, 23, 59, 59)
  assert.equal(ymdFromMs(localLate.getTime()), '2026-09-18')
})

test('ymdFromMs：跨年 / 跨月都对', () => {
  assert.equal(ymdFromMs(new Date(2025, 11, 31, 23, 30, 0).getTime()), '2025-12-31')
  assert.equal(ymdFromMs(new Date(2026, 0, 1, 0, 30, 0).getTime()), '2026-01-01')
  assert.equal(ymdFromMs(new Date(2026, 1, 28, 12, 0, 0).getTime()), '2026-02-28')
})

test('ymdFromMs：非法输入不抛错，返回空串', () => {
  assert.equal(ymdFromMs(Number.NaN), '')
  assert.equal(ymdFromMs(Number.POSITIVE_INFINITY), '')
})

/* ══ 3. dateText 的空串短路（本批发现的坑）════════════════════════════ */

test('★ 属性日期为空串时 {创建} 展开成空串 —— 不是「年月日」', () => {
  // dateText('', 'YYYY年MM月DD日') 会返回 '年月日'（既有行为，因为 {d} 的调用方保证非空）；
  // 属性日期**真的可能为空**，所以 applyRuleMode 必须先判空再转格式。
  const r = rule({ prefix: '{创建}_', dateFormat: 'YYYY年MM月DD日' })
  assert.equal(gen('素材', r, attrs(100, '', '')), '_素材', '空属性日期必须展开成空串')
  assert.equal(gen('素材', r, attrs(100, '', '')), '_素材', '重复调用结果一致')
})

test('属性日期有值时，走的是「日期格式」那一档（与 {d} 共用）', () => {
  const a = attrs(100, '2026-09-18', '2026-09-02')
  assert.equal(gen('素材', rule({ prefix: '{创建}_', dateFormat: 'YYYY-MM-DD' }), a), '2026-09-18_素材')
  assert.equal(gen('素材', rule({ prefix: '{创建}_', dateFormat: 'YYYY年MM月DD日' }), a), '2026年09月18日_素材')
  assert.equal(gen('素材', rule({ prefix: '{创建}_', dateFormat: 'MM月DD日' }), a), '09月18日_素材')
  assert.equal(gen('素材', rule({ prefix: '{创建}_', dateFormat: 'YYMMDD' }), a), '260918_素材')
  assert.equal(gen('素材', rule({ prefix: '{创建}_', dateFormat: 'YYYYMMDD' }), a), '20260918_素材')
})

/* ══ 4. 五个变量 ══════════════════════════════════════════════════════ */

test('applyRuleMode：三个属性变量都能用，且可同时出现在前缀与后缀', () => {
  const a = attrs(2516582)
  const r = rule({ prefix: '{创建}-', suffix: '-{大小}' })
  assert.equal(gen('素材', r, a), '2026-09-18-素材-2.4MB')
})

test('applyRuleMode：同一变量出现两次，两处都替换', () => {
  const a = attrs(2048)
  assert.equal(gen('素材', rule({ prefix: '{大小}~{大小}_' }), a), '2.0KB~2.0KB_素材')
})

test('applyRuleMode：不认识的占位符原样保留（与 {n} {d} 的既有行为一致）', () => {
  const a = attrs(100)
  assert.equal(gen('素材', rule({ prefix: '{大少}_' }), a), '{大少}_素材')
  assert.equal(gen('素材', rule({ prefix: '{size}_' }), a), '{size}_素材')
})

test('applyRuleMode：属性变量写在「原文件名」里不生效（变量只在前后缀里替换）', () => {
  const a = attrs(100)
  // 「原文件名」就是 stem 本身，变量替换不经过它
  assert.equal(gen('{大小}素材', rule({ prefix: 'P_' }), a), 'P_{大小}素材')
})

test('applyRuleMode：{大小} 走的是 sizeUnit 设置', () => {
  const a = attrs(2516582)
  assert.equal(gen('素材', rule({ prefix: '{大小}_', sizeUnit: 'auto' }), a), '2.4MB_素材')
  assert.equal(gen('素材', rule({ prefix: '{大小}_', sizeUnit: 'B' }), a), '2516582B_素材')
  assert.equal(gen('素材', rule({ prefix: '{大小}_', sizeUnit: 'KB' }), a), '2457.6KB_素材')
})

test('applyRuleMode：文件夹（sizeBytes null）→ {大小} 空，{创建}/{修改} 照常有值', () => {
  const a = attrs(null)
  assert.equal(gen('素材', rule({ prefix: '{大小}_{创建}_' }), a), '_2026-09-18_素材')
  assert.equal(gen('素材', rule({ prefix: '{大小}_{修改}_' }), a), '_2026-09-02_素材')
})

/* ══ 5. 属性冻结 ══════════════════════════════════════════════════════ */

test('属性冻结：同一份 attrs 传给两次计算 → 结果完全相同', () => {
  const a = attrs(2516582)
  const r = rule({ prefix: '{大小}-{修改}_' })
  assert.equal(gen('素材', r, a), gen('素材', r, a))
})

test('属性冻结：attrs 变了结果才变（证明它确实在读快照、不是常量）', () => {
  const r = rule({ prefix: '{大小}_' })
  assert.notEqual(gen('素材', r, attrs(100)), gen('素材', r, attrs(2048)))
})

/* ══ 6. sanitizeAttrs（主进程收口）════════════════════════════════════ */

test('sanitizeAttrs：非法值不得混成 0（null 与 0 是两种含义）', () => {
  assert.equal(sanitizeAttrs({ sizeBytes: 'abc' }).sizeBytes, null)
  assert.equal(sanitizeAttrs({ sizeBytes: -5 }).sizeBytes, null)
  assert.equal(sanitizeAttrs({ sizeBytes: Number.NaN }).sizeBytes, null)
  assert.equal(sanitizeAttrs({}).sizeBytes, null)
  // 0 必须保住
  assert.equal(sanitizeAttrs({ sizeBytes: 0 }).sizeBytes, 0)
  assert.equal(sanitizeAttrs({ sizeBytes: 1024 }).sizeBytes, 1024)
  assert.equal(sanitizeAttrs({ sizeBytes: 1024.7 }).sizeBytes, 1024)
})

test('sanitizeAttrs：日期只认合法 YYYY-MM-DD，其余落空串', () => {
  assert.equal(sanitizeAttrs({ created: '2026-09-18' }).created, '2026-09-18')
  assert.equal(sanitizeAttrs({ created: '2026-9-8' }).created, '')
  assert.equal(sanitizeAttrs({ created: 123 }).created, '')
  assert.equal(sanitizeAttrs(null).created, '')
})

/* ══ 7. sanitizeRule 的 sizeUnit ══════════════════════════════════════ */

test('sanitizeRule：sizeUnit 非法值落 auto、合法值原样取出', () => {
  for (const ok of ['auto', 'B', 'KB', 'MB', 'GB'] as const) {
    assert.equal(sanitizeRule({ rule: { sizeUnit: ok } }).rule.sizeUnit, ok)
  }
  assert.equal(sanitizeRule({ rule: { sizeUnit: 'TB' } }).rule.sizeUnit, 'auto')
  assert.equal(sanitizeRule({ rule: { sizeUnit: 123 } }).rule.sizeUnit, 'auto')
  assert.equal(sanitizeRule({ rule: {} }).rule.sizeUnit, 'auto', '缺失时给默认值')
  assert.equal(sanitizeRule(null).rule.sizeUnit, 'auto')
})

/* ══ 8. ★★ 预览 ≡ 执行（本批最重要）═══════════════════════════════════ */

test('★★ 预览 ≡ 执行：PreviewItemInput 与 ExecuteItem 两条路算出的新名逐字节相等', () => {
  const a = attrs(2516582, '2026-09-18', '2026-09-02')
  const r = rule({ prefix: '{大小}-{创建}_', suffix: '_{修改}' })

  // ① Worker / 预览形态：PreviewItemInput（**只有 Pick 出来的那几个字段**）
  const pii: PreviewItemInput[] = [
    { id: 'f1', dirPath: 'D:\\p33', stem: '素材', ext: '.docx', isDir: false, attrs: a },
  ]

  // ② 执行形态：ExecuteItem（主进程拿到的形状）
  const exec = [{ id: 'f1', dirPath: 'D:\\p33', fromName: '素材.docx', isDir: false, attrs: a }]

  const preview = buildPreview(pii, r, '2026-09-21', {}, false)
  const plan = buildRenamePlan(exec, r, '2026-09-21', {}, false)

  const pName = preview.items[0].newName
  const eName = [...plan.ready, ...plan.skipped, ...plan.invalid][0].toName

  // ★ 这一条是唯一能抓「PreviewItemInput 的 Pick 漏了 attrs」的断言：
  //   漏了 → Worker 拿不到属性 → {大小} 展开成空串 → 名字短一截，而类型检查不报错。
  assert.equal(pName, '2.4MB-2026-09-18_素材_2026-09-02.docx', '预览侧必须拿到 attrs')
  assert.equal(
    pName,
    eName,
    '预览与执行两条路的「最小信息」必须传全，否则就是「预览 ≠ 执行」',
  )
})

test('★★ 预览 ≡ 执行：空属性日期 / 文件夹（null）两条边也一致', () => {
  const cases: ItemAttrs[] = [attrs(null, '', ''), attrs(0), attrs(1023, '2026-01-31')]
  const r = rule({ prefix: '{大小}_{创建}_', dateFormat: 'YYYYMMDD' })

  for (const a of cases) {
    const preview = buildPreview(
      [{ id: 'x', dirPath: 'D:\\p33', stem: 'n', ext: '.txt', isDir: false, attrs: a }],
      r,
      '2026-09-21',
      {},
      false,
    )
    const plan = buildRenamePlan(
      [{ id: 'x', dirPath: 'D:\\p33', fromName: 'n.txt', isDir: false, attrs: a }],
      r,
      '2026-09-21',
      {},
      false,
    )
    const pName = preview.items[0].newName
    const eName = [...plan.ready, ...plan.skipped, ...plan.invalid][0].toName
    assert.equal(pName, eName, `attrs=${JSON.stringify(a)} 时预览与执行必须相等`)
  }
})

/* ══ 9. 老规则回归 ════════════════════════════════════════════════════ */

test('回归：不含属性变量的规则，输出与 P3-2 逐字节相同', () => {
  const a = attrs(2516582)
  // 老规则的默认值：数字序号 + 前后缀，不用任何属性变量
  assert.equal(
    gen('报告', rule({ prefix: 'P-', suffix: '-S', seqEnabled: true, seqPad: 3 }), a),
    'P-报告-S001',
  )
  // 属性存在也不影响老规则的输出
  assert.equal(
    gen('报告', rule({ prefix: 'P-', suffix: '-S', seqEnabled: true, seqPad: 3 }), attrs(null)),
    'P-报告-S001',
  )
})
