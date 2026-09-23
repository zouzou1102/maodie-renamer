/**
 * P2-B（常用规则模板库）—— 单测。
 *
 * 运行：`npm run test:core`（**必须显式传本文件**，见 package.json 的 test:core）
 *
 * 这个文件盯六件事：
 *  1. 七个模板都在，且**逐字段**等于设计里写死的那份 RuleConfig（不是只断言「变了」）
 *  2. 「去掉括号」的正则能编译，且**两组括号一起去掉**（TC-40，最容易漏的一条）
 *  3. **每个模板都真跑一遍预览**，至少有一个示例文件名发生变化（防「点了没反应」）
 *  4. **模板常量不被污染**（TC-41）：套用 → 手改 → 再套用，拿回的仍是原始模板
 *  5. 状态栏文案：开了正则的模板必须说清「已自动开启正则」
 *  6. 摘要截断只发生在**显示层**，`buildRuleSummary` 的原始输出一个字没变
 *
 * ⚠️ 被验的数据住在 `src/shared/templates.ts`。
 *    放 shared/ 不是随便放的：`tsconfig.node.json` 的 include **不含 src/renderer**，
 *    纯数据一旦放在渲染层，单测 import 会直接编译失败（P2-C 增量踩过一次，
 *    那个测试文件「写了却从来没被跑过」）。
 *
 * 规矩同前：只用 `node:test` + `node:assert`，不引入第三方框架。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { RULE_TEMPLATES, cloneTemplateRule, templateAppliedMessage } from '../src/shared/templates'
import { buildRuleSummary, truncateSummaryForDisplay } from '../src/shared/rule-summary'
import { compileRegex } from '../src/shared/rule-engine'
import { resolveItems } from '../src/shared/preview'
import type { RuleConfig } from '../src/shared/types'

const ROOT = process.cwd()
assert.ok(
  fs.existsSync(path.join(ROOT, 'package.json')),
  `单测必须在工程根目录下运行（当前 cwd = ${ROOT}）—— 用 npm run test:core`,
)

/** 取某个模板（找不到就当场炸，避免后面一堆 undefined 报错看不出真因）*/
function tpl(id: string) {
  const t = RULE_TEMPLATES.find((x) => x.id === id)
  assert.ok(t, `模板库里没有 id = ${id} 的模板`)
  return t
}

/** 每个模板配一个「一定会被改到」的示例文件名 */
const SAMPLES: Record<string, string> = {
  datePrefix: '报告.docx',
  seqPad: '截图.png',
  dateSeq: '素材.jpg',
  stripBrackets: '【某某公众号】x.mp4',
  spaceToUnderscore: 'my file name.txt',
  lowercase: 'IMG_0001.JPG',
  // ★ P3-5：第 7 个模板「只用编号」—— 只留编号、丢掉原名
  seqOnly: '照片A.jpg',
}

/* ══ 1. 七个模板齐全、字段完整 ══════════════════════════════════════ */

test('七个模板都在，且 id / 短名 / 悬停说明都不为空', () => {
  assert.equal(
    RULE_TEMPLATES.length,
    7,
    '本版就做 7 个内置模板（P3-5 加了「只用编号」，设计 §2.4）—— 增删要先改设计',
  )

  for (const t of RULE_TEMPLATES) {
    assert.ok(t.id.length > 0, '模板缺 id')
    assert.ok(t.name.length > 0 && t.name.length <= 8, `「${t.id}」的短名要短（chip 放不下长名字）`)
    assert.ok(t.hint.length > 0, `「${t.id}」缺悬停说明`)
    assert.ok(t.rule, `「${t.id}」缺规则配置`)
  }

  const ids = RULE_TEMPLATES.map((t) => t.id)
  assert.equal(new Set(ids).size, ids.length, '模板 id 有重复')
})

/* ══ 2. 逐字段核对（设计 §3 的表格）══════════════════════════════════ */

test('「加日期前缀」逐字段等于设计：规则化 + 前缀 {d} + 启用日期 + 保留原名', () => {
  assert.deepEqual(cloneTemplateRule(tpl('datePrefix')), {
    mode: 'rule',
    caseSensitive: false,
    autoResolveConflict: false,
    regexEnabled: false,
    caseTransform: 'none',
    extMode: 'keep',
    extValue: '',
    delete: { text: '' },
    replace: { find: '', to: '' },
    insert: { at: 0, text: '' },
    rule: {
      prefix: '{d} ',
      suffix: '',
      seqEnabled: false,
      seqStart: 1,
      seqStep: 1,
      seqPad: 3,
      seqPosition: 'suffix',
      dateEnabled: true,
      dateFormat: 'YYYY-MM-DD',
      keepOriginal: true,
      seqKind: 'number',
      seqAt: 1,
      seqRandomLen: 6,
      seqRandomSeed: 0,
      seqTimeStart: '',
      seqTimeFormat: 'YYYY年MM月DD日',
      sizeUnit: 'auto',
    },
  } satisfies RuleConfig)
})

test('「补零编号」逐字段等于设计：序号开、起始 1、步长 1、补零 3、排在最后、保留原名', () => {
  assert.deepEqual(cloneTemplateRule(tpl('seqPad')), {
    mode: 'rule',
    caseSensitive: false,
    autoResolveConflict: false,
    regexEnabled: false,
    caseTransform: 'none',
    extMode: 'keep',
    extValue: '',
    delete: { text: '' },
    replace: { find: '', to: '' },
    insert: { at: 0, text: '' },
    rule: {
      prefix: '',
      suffix: '',
      seqEnabled: true,
      seqStart: 1,
      seqStep: 1,
      seqPad: 3,
      seqPosition: 'suffix',
      dateEnabled: false,
      dateFormat: 'YYYY-MM-DD',
      keepOriginal: true,
      seqKind: 'number',
      seqAt: 1,
      seqRandomLen: 6,
      seqRandomSeed: 0,
      seqTimeStart: '',
      seqTimeFormat: 'YYYY年MM月DD日',
      sizeUnit: 'auto',
    },
  } satisfies RuleConfig)
})

test('「日期+编号」逐字段等于设计：前缀 {d}- + 日期 + 序号，两个都开', () => {
  assert.deepEqual(cloneTemplateRule(tpl('dateSeq')), {
    mode: 'rule',
    caseSensitive: false,
    autoResolveConflict: false,
    regexEnabled: false,
    caseTransform: 'none',
    extMode: 'keep',
    extValue: '',
    delete: { text: '' },
    replace: { find: '', to: '' },
    insert: { at: 0, text: '' },
    rule: {
      prefix: '{d}-',
      suffix: '',
      seqEnabled: true,
      seqStart: 1,
      seqStep: 1,
      seqPad: 3,
      seqPosition: 'suffix',
      dateEnabled: true,
      dateFormat: 'YYYY-MM-DD',
      keepOriginal: true,
      seqKind: 'number',
      seqAt: 1,
      seqRandomLen: 6,
      seqRandomSeed: 0,
      seqTimeStart: '',
      seqTimeFormat: 'YYYY年MM月DD日',
      sizeUnit: 'auto',
    },
  } satisfies RuleConfig)
})

test('「去掉括号」逐字段等于设计：替换模式 + 正则开 + 替换为空', () => {
  const r = cloneTemplateRule(tpl('stripBrackets'))
  assert.equal(r.mode, 'replace', '去掉括号要落在替换模式上')
  assert.equal(r.regexEnabled, true, '去掉括号靠正则，开关必须打开')
  assert.equal(r.replace.to, '', '替换目标是空 —— 也就是「删掉」')
  assert.deepEqual(r, {
    mode: 'replace',
    caseSensitive: false,
    autoResolveConflict: false,
    regexEnabled: true,
    caseTransform: 'none',
    extMode: 'keep',
    extValue: '',
    delete: { text: '' },
    replace: { find: r.replace.find, to: '' },
    insert: { at: 0, text: '' },
    rule: {
      prefix: '',
      suffix: '',
      seqEnabled: false,
      seqStart: 1,
      seqStep: 1,
      seqPad: 3,
      seqPosition: 'suffix',
      dateEnabled: false,
      dateFormat: 'YYYY-MM-DD',
      keepOriginal: true,
      seqKind: 'number',
      seqAt: 1,
      seqRandomLen: 6,
      seqRandomSeed: 0,
      seqTimeStart: '',
      seqTimeFormat: 'YYYY年MM月DD日',
      sizeUnit: 'auto',
    },
  } satisfies RuleConfig)
})

test('「空格换下划线」逐字段等于设计：替换模式、正则关、空格 → 下划线', () => {
  assert.deepEqual(cloneTemplateRule(tpl('spaceToUnderscore')), {
    mode: 'replace',
    caseSensitive: false,
    autoResolveConflict: false,
    regexEnabled: false,
    caseTransform: 'none',
    extMode: 'keep',
    extValue: '',
    delete: { text: '' },
    replace: { find: ' ', to: '_' },
    insert: { at: 0, text: '' },
    rule: {
      prefix: '',
      suffix: '',
      seqEnabled: false,
      seqStart: 1,
      seqStep: 1,
      seqPad: 3,
      seqPosition: 'suffix',
      dateEnabled: false,
      dateFormat: 'YYYY-MM-DD',
      keepOriginal: true,
      seqKind: 'number',
      seqAt: 1,
      seqRandomLen: 6,
      seqRandomSeed: 0,
      seqTimeStart: '',
      seqTimeFormat: 'YYYY年MM月DD日',
      sizeUnit: 'auto',
    },
  } satisfies RuleConfig)
})

test('「全部小写」逐字段等于设计：规则化、各要素全关、只开大小写转换', () => {
  assert.deepEqual(cloneTemplateRule(tpl('lowercase')), {
    mode: 'rule',
    caseSensitive: false,
    autoResolveConflict: false,
    regexEnabled: false,
    caseTransform: 'lower',
    extMode: 'keep',
    extValue: '',
    delete: { text: '' },
    replace: { find: '', to: '' },
    insert: { at: 0, text: '' },
    rule: {
      prefix: '',
      suffix: '',
      seqEnabled: false,
      seqStart: 1,
      seqStep: 1,
      seqPad: 3,
      seqPosition: 'suffix',
      dateEnabled: false,
      dateFormat: 'YYYY-MM-DD',
      keepOriginal: true,
      seqKind: 'number',
      seqAt: 1,
      seqRandomLen: 6,
      seqRandomSeed: 0,
      seqTimeStart: '',
      seqTimeFormat: 'YYYY年MM月DD日',
      sizeUnit: 'auto',
    },
  } satisfies RuleConfig)
})

/* ══ 3. 正则合法性 ═══════════════════════════════════════════════════ */

test('「去掉括号」的正则能被引擎编译通过 —— 模板里写错正则会当场红', () => {
  const r = cloneTemplateRule(tpl('stripBrackets'))
  const { regex, error } = compileRegex(r.replace.find, r.caseSensitive)
  assert.equal(error, null, `模板里的正则编译失败：${error}`)
  assert.ok(regex, '模板里的正则应能编译出 RegExp')
})

/* ══ 4. 每个模板真跑一遍预览 —— 防「点了没反应」══════════════════════ */

test('每个模板跑一遍预览，至少有一个示例文件的名字真的变了', () => {
  const date = '2026-09-17'

  for (const t of RULE_TEMPLATES) {
    const from = SAMPLES[t.id]
    assert.ok(from, `模板「${t.name}」没有配示例文件名 —— 就验不了它到底有没有用`)

    const out = resolveItems(
      [{ id: 'x', dirPath: 'C:\\tmp', fromName: from, isDir: false, attrs: { created: '', modified: '', sizeBytes: null } }],
      cloneTemplateRule(t),
      date,
      {},
      false,
    )

    assert.equal(out.length, 1)
    const item = out[0]!
    assert.equal(item.outcome, 'ready', `模板「${t.name}」算出来的结果是「${item.outcome}」（${item.reason ?? ''}）`)
    assert.notEqual(
      item.toName,
      from,
      `模板「${t.name}」点了没反应：${from} 还是 ${from} —— 大概率是规则没配对`,
    )
  }
})

test('「去掉括号」在 (1)(2)报告.docx 上把两组括号一起去掉（TC-40）', () => {
  const out = resolveItems(
    [{ id: 'x', dirPath: 'C:\\tmp', fromName: '(1)(2)报告.docx', isDir: false, attrs: { created: '', modified: '', sizeBytes: null } }],
    cloneTemplateRule(tpl('stripBrackets')),
    '2026-09-17',
    {},
    false,
  )
  assert.equal(
    out[0]!.toName,
    '报告.docx',
    '只去掉第一组说明引擎没按「全部匹配」处理 —— 正则少了 g 标志（这是 TC-40 要钉死的）',
  )
})

test('「去掉括号」四种括号都吃，扩展名一个字不动', () => {
  const cases: Array<[string, string]> = [
    ['【某某公众号】x.mp4', 'x.mp4'],
    ['报告(1).docx', '报告.docx'],
    ['素材（副本）.png', '素材.png'],
    ['[草稿]方案.txt', '方案.txt'],
  ]
  for (const [from, want] of cases) {
    const out = resolveItems(
      [{ id: 'x', dirPath: 'C:\\tmp', fromName: from, isDir: false, attrs: { created: '', modified: '', sizeBytes: null } }],
      cloneTemplateRule(tpl('stripBrackets')),
      '2026-09-17',
      {},
      false,
    )
    assert.equal(out[0]!.toName, want, `${from} 应变成 ${want}`)
  }
})

test('「全部小写」只动主体，扩展名保持原样', () => {
  const out = resolveItems(
    [{ id: 'x', dirPath: 'C:\\tmp', fromName: 'IMG_0001.JPG', isDir: false, attrs: { created: '', modified: '', sizeBytes: null } }],
    cloneTemplateRule(tpl('lowercase')),
    '2026-09-17',
    {},
    false,
  )
  assert.equal(out[0]!.toName, 'img_0001.JPG', '扩展名 .JPG 不该被改成 .jpg（扩展名保护是默认行为）')
})

/* ══ 5. 模板常量不被污染（TC-41）════════════════════════════════════ */

test('套用 → 手改 → 再套用，第二次拿到的仍是原始模板（TC-41）', () => {
  const t = tpl('datePrefix')

  const first = cloneTemplateRule(t)
  // 模拟用户在界面上瞎改
  first.rule.prefix = '被改乱了'
  first.rule.dateFormat = 'YYYYMMDD'
  first.mode = 'delete'
  first.delete.text = '也改了'

  const second = cloneTemplateRule(t)
  assert.equal(second.rule.prefix, '{d} ', '第二次拿到的前缀不是 {d} —— 模板常量被上一次的编辑污染了')
  assert.equal(second.rule.dateFormat, 'YYYY-MM-DD', '日期格式被污染了')
  assert.equal(second.mode, 'rule', '模式被污染了')
  assert.equal(second.delete.text, '', '删除框被污染了')

  // 再直接查常量本身：它必须还是原样
  assert.equal(t.rule.rule.prefix, '{d} ', '模板常量本体被改了 —— cloneTemplateRule 没做深拷贝')
})

test('cloneTemplateRule 返回的是新对象，改它不会碰到模板常量', () => {
  for (const t of RULE_TEMPLATES) {
    const a = cloneTemplateRule(t)
    assert.notEqual(a, t.rule, `「${t.id}」返回的是同一个对象引用 —— 必须深拷贝`)
    assert.notEqual(a.rule, t.rule.rule, `「${t.id}」的 rule 子对象是同一个引用 —— 嵌套层没拷到`)
    assert.notEqual(a.delete, t.rule.delete, `「${t.id}」的 delete 子对象是同一个引用`)
    assert.notEqual(a.replace, t.rule.replace, `「${t.id}」的 replace 子对象是同一个引用`)
  }
})

/* ══ 6. 状态栏文案 ══════════════════════════════════════════════════ */

test('套用反馈文案带模板名；开了正则的要说清「已自动开启正则」', () => {
  assert.equal(templateAppliedMessage(tpl('datePrefix')), '已套用模板：加日期前缀')
  assert.equal(templateAppliedMessage(tpl('seqPad')), '已套用模板：补零编号')
  assert.equal(
    templateAppliedMessage(tpl('stripBrackets')),
    '已套用模板：去掉括号（已自动开启正则）',
    '这个模板会替用户打开正则开关 —— 不说明白，用户不知道「进阶设置」为什么亮了',
  )
  assert.equal(
    templateAppliedMessage(tpl('spaceToUnderscore')),
    '已套用模板：空格换下划线',
    '没开正则的模板不该带那句后缀',
  )
})

/* ══ 7. 摘要截断（显示层，不动持久化数据）═══════════════════════════ */

test('超长正则在显示层被截断为「前 12 字 + …」', () => {
  const raw = buildRuleSummary(cloneTemplateRule(tpl('stripBrackets')))
  const shown = truncateSummaryForDisplay(raw)

  assert.equal(shown, '替换「[（(【\\[](?:[^…」→（删除）（正则）', `截断结果不对：${shown}`)
  assert.ok(!shown.includes('）)】\\]]*)'), '截断后不该还留着尾巴')
})

test('短的摘要原样显示 —— 不该被无谓截断', () => {
  for (const id of ['datePrefix', 'seqPad', 'spaceToUnderscore', 'lowercase']) {
    const raw = buildRuleSummary(cloneTemplateRule(tpl(id)))
    assert.equal(truncateSummaryForDisplay(raw), raw, `「${id}」的摘要被动了，它本来就不长`)
  }
})

test('★ buildRuleSummary 的原始输出一个字没变 —— 它是要写进 history.json 的', () => {
  const raw = buildRuleSummary(cloneTemplateRule(tpl('stripBrackets')))

  assert.ok(
    raw.includes('[（(【\\[](?:[^）)】\\]]*)[）)】\\]]'),
    `摘要里的正则被改动了！原始输出必须完整保留（截断只能在显示层）。实际：${raw}`,
  )
  assert.ok(!raw.includes('…'), 'buildRuleSummary 的返回值里不该出现省略号 —— 那是显示层的事')

  // 调多少次截断函数，都不该反过来污染原始值
  truncateSummaryForDisplay(raw)
  truncateSummaryForDisplay(raw)
  assert.equal(buildRuleSummary(cloneTemplateRule(tpl('stripBrackets'))), raw, '原始摘要被截断函数改掉了')
})
