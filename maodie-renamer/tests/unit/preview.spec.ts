import { describe, expect, it } from 'vitest'
import { buildPreview, resolveItems, type ResolveInput } from '@shared/preview'
import { assertPlanIsSafe, buildRenamePlan, toPlanEntry } from '@shared/rename-plan'
import { dirKey } from '@shared/path-utils'
import { DEFAULT_RULE, type RuleConfig } from '@shared/types'

const DIR = 'C:\\Users\\PC\\Desktop'
const KEY = dirKey(DIR)

function item(fromName: string, id = fromName, isDir = false): ResolveInput {
  return { id, dirPath: DIR, fromName, isDir, attrs: { created: '', modified: '', sizeBytes: null } }
}

function rule(patch: Partial<RuleConfig> = {}, rulePatch: Partial<RuleConfig['rule']> = {}): RuleConfig {
  return { ...DEFAULT_RULE, ...patch, rule: { ...DEFAULT_RULE.rule, ...rulePatch } }
}

const del = (text: string, caseSensitive = false) =>
  rule({ mode: 'delete', caseSensitive, delete: { text } })

describe('preview · 空列表兜底', () => {
  it('空 items → 立即可返回，不做任何计算', () => {
    const r = buildPreview([], del('广告'), '2026-09-11', { [KEY]: [] }, false)
    expect(r.items).toEqual([])
    expect(r.stats).toEqual({ changed: 0, unchanged: 0, conflict: 0, invalid: 0 })
    expect(r.elapsedMs).toBe(0)
  })
})

describe('preview · 状态分类与统计', () => {
  it('TC-03 删除命中 → changed + 差异区间', () => {
    const r = buildPreview(
      [item('abc广告.txt')],
      del('广告'),
      '2026-09-11',
      { [KEY]: ['abc广告.txt'] },
      false,
    )
    expect(r.items[0].status).toBe('changed')
    expect(r.items[0].newName).toBe('abc.txt')
    expect(r.items[0].newStem).toBe('abc')
    expect(r.items[0].diffRange).toEqual({ oldStart: 3, oldEnd: 5, newStart: 3, newEnd: 3 })
    expect(r.stats).toEqual({ changed: 1, unchanged: 0, conflict: 0, invalid: 0 })
  })

  it('规则未命中 → unchanged，且 diffRange 为 null（界面显示灰色「—」）', () => {
    const r = buildPreview([item('abc.txt')], del('广告'), '2026-09-11', { [KEY]: ['abc.txt'] }, false)
    expect(r.items[0].status).toBe('unchanged')
    expect(r.items[0].diffRange).toBeNull()
    expect(r.stats.unchanged).toBe(1)
  })

  it('改后为空 → invalid + E_EMPTY_NAME', () => {
    const r = buildPreview([item('广告.txt')], del('广告'), '2026-09-11', { [KEY]: ['广告.txt'] }, false)
    expect(r.items[0].status).toBe('invalid')
    expect(r.items[0].reasonCode).toBe('E_EMPTY_NAME')
    expect(r.stats.invalid).toBe(1)
  })

  it('改后含非法字符 → invalid + E_INVALID_CHAR', () => {
    const r = rule({ mode: 'replace', replace: { find: 'X', to: '?' } })
    const p = buildPreview([item('aXb.txt')], r, '2026-09-11', { [KEY]: ['aXb.txt'] }, false)
    expect(p.items[0].status).toBe('invalid')
    expect(p.items[0].reasonCode).toBe('E_INVALID_CHAR')
  })

  it('U-01 磁盘冲突（预览侧）→ conflict + E_CONFLICT_DISK + 中文原因', () => {
    const r = rule({ mode: 'replace', replace: { find: 'a', to: 'b' } })
    const p = buildPreview([item('a.txt')], r, '2026-09-11', { [KEY]: ['a.txt', 'b.txt'] }, false)
    expect(p.items[0].status).toBe('conflict')
    expect(p.items[0].reasonCode).toBe('E_CONFLICT_DISK')
    expect(p.items[0].reason).toBe('已经有同名文件了')
    expect(p.stats.conflict).toBe(1)
  })

  it('EX-05 批次内撞名 → 后到者判 batch，且原因里的数量 N 是实际值', () => {
    // 两项同名同源，替换后都变成 xx.txt → 后到者撞上「已分配的目标名」
    const r = rule({ mode: 'replace', replace: { find: 'a', to: 'x' } })
    const p = buildPreview(
      [item('aa.txt', '1'), item('aa.txt', '2')],
      r,
      '2026-09-11',
      { [KEY]: ['aa.txt'] },
      false,
    )
    expect(p.items[0].status).toBe('changed')
    expect(p.items[1].status).toBe('conflict')
    expect(p.items[1].reasonCode).toBe('E_CONFLICT_BATCH')
    expect(p.items[1].reason).toBe('有 1 项改完会撞名')
    expect(p.stats).toEqual({ changed: 1, unchanged: 0, conflict: 1, invalid: 0 })
  })

  it('规则化模式「不保留原名」且一个片段都没填 → 新名为空 → invalid', () => {
    const r = rule({ mode: 'rule' }, { prefix: '', suffix: '', keepOriginal: false })
    const p = buildPreview(
      [item('a.txt', '1'), item('b.txt', '2')],
      r,
      '2026-09-11',
      { [KEY]: ['a.txt', 'b.txt'] },
      false,
    )
    expect(p.stats.invalid).toBe(2)
    expect(p.items[0].reasonCode).toBe('E_EMPTY_NAME')
  })

  it('U-04 仅大小写不同 → changed（不标红），conflictKind 为 case-only', () => {
    const r = rule({ mode: 'replace', replace: { find: 'a', to: 'A' } })
    const p = buildPreview([item('a.txt')], r, '2026-09-11', { [KEY]: ['a.txt'] }, false)
    expect(p.items[0].status).toBe('changed')
    expect(p.items[0].conflictKind).toBe('case-only')
    expect(p.items[0].newName).toBe('A.txt')
  })
})

describe('preview · 自动加序号（U-11 的预览表现）', () => {
  it('开启后冲突项变为「将变化」并带出 resolvedName', () => {
    const r = rule({ mode: 'replace', replace: { find: 'a', to: 'b' } })
    const p = buildPreview([item('a.txt')], r, '2026-09-11', { [KEY]: ['a.txt', 'b.txt'] }, true)
    expect(p.items[0].status).toBe('changed')
    expect(p.items[0].resolvedName).toBe('b_1.txt')
    expect(p.items[0].newName).toBe('b_1.txt')
    expect(p.stats.conflict).toBe(0)
  })
})

describe('preview · 扩展名保护与字段一致性', () => {
  it('newName 恒等于 newStem + ext（扩展名保护的最后一道实现）', () => {
    const r = rule({ mode: 'rule' }, { prefix: 'P-', seqEnabled: true, seqPad: 2 })
    const inputs = [item('报告.docx', '1'), item('IMG_0001.JPG', '2'), item('README', '3'), item('.gitignore', '4')]
    const p = buildPreview(inputs, r, '2026-09-11', { [KEY]: inputs.map((i) => i.fromName) }, false)
    const extOf = ['docx', 'JPG', '', '']
    p.items.forEach((out, i) => {
      const ext = extOf[i] === '' ? '' : `.${extOf[i]}`
      expect(out.newName).toBe(out.newStem + ext)
    })
  })
})

describe('preview · 序号跟随列表顺序（{n}）', () => {
  it('序号按传入顺序递增，起始值与补零生效', () => {
    const r = rule({ mode: 'rule' }, { suffix: '-{n}', seqEnabled: true, seqStart: 1, seqPad: 3 })
    const inputs = [item('c.txt', '1'), item('a.txt', '2'), item('b.txt', '3')]
    const p = buildPreview(inputs, r, '2026-09-11', { [KEY]: [] }, false)
    expect(p.items.map((i) => i.newName)).toEqual(['c-001.txt', 'a-002.txt', 'b-003.txt'])
  })
})

describe('preview · 性能预算（技术方案 §6.1 / TC-15 的预览侧）', () => {
  it('1000 项预览计算 < 200ms', () => {
    const inputs: ResolveInput[] = Array.from({ length: 1000 }, (_, i) =>
      item(`【某某公众号】第${i}课.pdf`, `id-${i}`),
    )
    const snapshot = { [KEY]: inputs.map((i) => i.fromName) }
    const r = del('【某某公众号】')

    // 预热一次，排除首次 JIT 的偶然开销
    buildPreview(inputs, r, '2026-09-11', snapshot, false)
    const result = buildPreview(inputs, r, '2026-09-11', snapshot, false)

    expect(result.stats.changed).toBe(1000)
    expect(result.elapsedMs).toBeLessThan(200)
  })

  it('1000 项「全部撞名」的最坏情况也 < 200ms', () => {
    const inputs: ResolveInput[] = Array.from({ length: 1000 }, (_, i) => item(`x${i}.txt`, `id-${i}`))
    const snapshot = { [KEY]: inputs.map((i) => i.fromName) }
    const r = rule({ mode: 'rule' }, { prefix: '同', keepOriginal: false }) // 全部 → 同.txt
    buildPreview(inputs, r, '2026-09-11', snapshot, false)
    const result = buildPreview(inputs, r, '2026-09-11', snapshot, false)
    expect(result.stats.changed).toBe(1)
    expect(result.stats.conflict).toBe(999)
    expect(result.elapsedMs).toBeLessThan(200)
  })
})

describe('rename-plan · 计划构建与自检', () => {
  it('把结果分成 ready / skipped / invalid 三份清单', () => {
    const r = rule({ mode: 'delete', delete: { text: '广告' } })
    const plan = buildRenamePlan(
      [item('a广告.txt', '1'), item('b.txt', '2'), item('广告.txt', '3')],
      r,
      '2026-09-11',
      { [KEY]: ['a广告.txt', 'b.txt', '广告.txt'] },
      false,
    )
    expect(plan.ready.map((e) => e.toName)).toEqual(['a.txt'])
    // 无变化项落在 skipped（执行时不给它分配临时名）
    expect(plan.skipped.map((e) => e.fromName)).toEqual(['b.txt'])
    expect(plan.invalid.map((e) => e.fromName)).toEqual(['广告.txt'])
  })

  it('★ 目标名被「不会被改走的邻居」占用 → 判 disk 冲突并跳过（绝不覆盖）', () => {
    // abc广告.txt → abc.txt，而 abc.txt 就在同一目录、且本次不改它
    const r = rule({ mode: 'delete', delete: { text: '广告' } })
    const plan = buildRenamePlan(
      [item('abc广告.txt', '1'), item('abc.txt', '2')],
      r,
      '2026-09-11',
      { [KEY]: ['abc广告.txt', 'abc.txt'] },
      false,
    )
    expect(plan.ready).toHaveLength(0)
    expect(plan.skipped.find((e) => e.fromName === 'abc广告.txt')?.code).toBe('E_CONFLICT_DISK')
  })

  it('P-08：目标名永远是「纯名称」，不含任何路径分隔符', () => {
    const r = rule({ mode: 'rule' }, { prefix: 'P-', suffix: '-S' })
    const plan = buildRenamePlan([item('a.txt', '1')], r, '2026-09-11', { [KEY]: ['a.txt'] }, false)
    expect(plan.ready[0].toName).not.toContain('\\')
    expect(plan.ready[0].toName).not.toContain('/')
    expect(() => assertPlanIsSafe(plan)).not.toThrow()
  })

  it('assertPlanIsSafe 在目标名含分隔符时抛错（计划层最后一道断言）', () => {
    const plan = {
      ready: [
        {
          id: '1',
          dirPath: DIR,
          fromName: 'a.txt',
          isDir: false,
          ext: '.txt',
          attemptedName: 'x\\y.txt',
          toName: 'x\\y.txt',
          newStem: 'x\\y',
          outcome: 'ready' as const,
          status: 'changed' as const,
          conflictKind: 'none' as const,
          diffRange: null,
        },
      ],
      skipped: [],
      invalid: [],
    }
    expect(() => assertPlanIsSafe(plan)).toThrow()
  })

  it('toPlanEntry 输出对外形状', () => {
    const plan = buildRenamePlan([item('a.txt', '1')], del('a'), '2026-09-11', { [KEY]: ['a.txt'] }, false)
    expect(toPlanEntry(plan.invalid[0])).toMatchObject({
      id: '1',
      dirPath: DIR,
      fromName: 'a.txt',
      outcome: 'invalid',
      code: 'E_EMPTY_NAME',
    })
  })
})

describe('preview · resolveItems 的 outcome 分类（执行侧复用）', () => {
  it('无变化项 outcome = skipped（执行器不会给它分配临时名）', () => {
    const r = del('广告')
    const out = resolveItems([item('abc.txt', '1')], r, '2026-09-11', { [KEY]: ['abc.txt'] }, false)
    expect(out[0].outcome).toBe('skipped')
    expect(out[0].code).toBe('E_NO_CHANGE')
  })

  it('冲突未加序号项 outcome = skipped（绝不覆盖，DEC-05）', () => {
    const r = rule({ mode: 'replace', replace: { find: 'a', to: 'b' } })
    const out = resolveItems([item('a.txt', '1')], r, '2026-09-11', { [KEY]: ['a.txt', 'b.txt'] }, false)
    expect(out[0].outcome).toBe('skipped')
    expect(out[0].code).toBe('E_CONFLICT_DISK')
  })

  it('case-only 项 outcome = ready（允许执行）', () => {
    const r = rule({ mode: 'replace', replace: { find: 'a', to: 'A' } })
    const out = resolveItems([item('a.txt', '1')], r, '2026-09-11', { [KEY]: ['a.txt'] }, false)
    expect(out[0].outcome).toBe('ready')
    expect(out[0].toName).toBe('A.txt')
  })
})
