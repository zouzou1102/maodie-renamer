<script setup lang="ts">
/**
 * R-05 规则设置区（EL-040 ~ EL-055）。
 *
 * DEC-02：三种模式**互斥单选**；规则化页签内五个要素可叠加。
 * EL-044「区分大小写」只在删除 / 替换模式下出现 —— 规则化模式不涉及匹配。
 *
 * 所有变更都是「改 store → files 里的 watch 触发 200ms 防抖重算」，
 * 组件里**不写**预览刷新逻辑，保证刷新入口只有一处。
 */
import { computed, nextTick, ref, watch } from 'vue'
import MdIcon from './MdIcon.vue'
import { useRuleStore } from '../stores/rule'
import { useFilesStore } from '../stores/files'
import {
  CASE_TRANSFORM_OPTIONS,
  DATE_FORMAT_OPTIONS,
  EXT_MODE_OPTIONS,
  SEQ_KIND_OPTIONS,
  SEQ_POSITION_OPTIONS,
  SIZE_UNIT_OPTIONS,
} from '@shared/labels'
import { ATTR_VARS } from '@shared/attr-vars'
import { REGEX_CHEATSHEET, REGEX_DEMO_FILE } from '@shared/regex-cheatsheet'
import { RULE_TEMPLATES, templateAppliedMessage, type RuleTemplate } from '@shared/templates'
import { joinName, splitName } from '@shared/name-split'
import { applyDelete, applyInsert, applyReplace, applyRuleMode, dateText, sizeText } from '@shared/rule-engine'
import { todayYmd } from '@shared/today'
import type {
  CaseTransform,
  DateFormat,
  ExtMode,
  RuleMode,
  SeqKind,
  SeqPosition,
  SizeUnit,
} from '@shared/types'

const rule = useRuleStore()
/** 套用模板后要给状态栏一句话，用既有的 3 秒轻提示位（不弹窗、不打断）*/
const files = useFilesStore()

/**
 * P3-4 · EL-134「清除导入」：去掉全部 `override`，那些项**立刻回到按规则算**。
 *
 * ⚠️ 只清「名字的来源」，**列表里的文件一个都不删** —— 所以不需要二次确认。
 *   这与「清空列表」是完全不同的两件事，别把两者混成一句话。
 */
function clearImported(): void {
  const n = files.clearOverride()
  if (n > 0) files.showTransient(`已清除 ${n} 项表格导入的名字，它们回到按规则算`)
}

/**
 * P2-B EL-120 / IX-106：点一下 chip = 套用整份模板。
 *
 * 状态栏那句「已套用模板：X（已自动开启正则）」必须在**组件层**发起：
 * `rule` store 刻意不 import `files` store（依赖方向只有 files → rule 一条，
 * 见该文件开头），所以让 store 去弹提示会把依赖绕成环。
 */
function useTemplate(t: RuleTemplate): void {
  rule.applyTemplate(t)
  files.showTransient(templateAppliedMessage(t))
}

/**
 * ★ P3-5：模式从 3 个变成 5 个，标签从四字改成**两字**（一排里更站得开）。
 *
 * ⚠️ 界面上「自定义」= 代码里的 `rule`（枚举值刻意不改名，设计 §5.①）。
 *   老用户打开软件：`自定义` 就在原来 `规则化` 的位置上。
 */
const TABS: Array<{ mode: RuleMode; label: string }> = [
  { mode: 'delete', label: '删除' },
  { mode: 'replace', label: '替换' },
  { mode: 'rule', label: '自定义' },
  { mode: 'insert', label: '插入' },
  { mode: 'import', label: '导入' },
]

const isRuleMode = computed(() => rule.rule.mode === 'rule')
/**
 * ★ P3-5：用**正面判断**替换掉从前的 `!isRuleMode`（反向判断）。
 * 反向判断会把「插入 / 导入」也算成「删除 / 替换那一类」—— 于是「区分大小写」
 * 「正则」「进阶设置」出现在插入 / 导入下，而**引擎根本不看它们**（设计 §7.5 第 4 行）。
 */
const isMatchMode = computed(() => rule.rule.mode === 'delete' || rule.rule.mode === 'replace')
const isInsertMode = computed(() => rule.rule.mode === 'insert')
const isImportMode = computed(() => rule.rule.mode === 'import')
/** 进阶设置（正则 / 大小写）只在「删除 / 替换 / 自定义」出现 —— 插入 / 导入都不涉及匹配 */
const showAdvanced = computed(
  () => rule.rule.mode === 'delete' || rule.rule.mode === 'replace' || rule.rule.mode === 'rule',
)

/**
 * F-10 / F-11 的「进阶设置」折叠区。
 * 展开 / 收起是**纯 UI 状态**，不进 RuleConfig、不进 IPC（设计 §10.1）。
 */
const advancedOpen = ref(false)
/** 正则开关只在删除 / 替换模式出现 —— 与「区分大小写」同一条规则（正面判断）*/
const regexOn = computed(() => isMatchMode.value && rule.rule.regexEnabled)
/** 已启用的进阶项数量（折起态也要能看出「开了东西」）*/
const advancedCount = computed(
  () =>
    (regexOn.value ? 1 : 0) +
    (showAdvanced.value && rule.rule.caseTransform !== 'none' ? 1 : 0),
)

/**
 * EL-103「? 看不懂？」小抄卡的开合。
 * 与折叠条同理：**纯 UI 状态**，不进 RuleConfig、不进 IPC（设计 §10.1）。
 */
const helpOpen = ref(false)

/** EL-104 照抄表：按当前模式过滤 —— 删除模式没有「替换框」，带 $1 的写法在那里没意义 */
const cheatRows = computed(() => REGEX_CHEATSHEET.filter((r) => r.modes.includes(rule.rule.mode)))

/** 演示用示例名的拆分（扩展名永不参与规则）*/
const DEMO_PARTS = splitName(REGEX_DEMO_FILE, false)

/**
 * EL-105 当场演示的结果；null = 现在没什么可演示（正则没开 / 写法有错 / 还没填内容）。
 *
 * 用 `applyDelete` / `applyReplace` —— 与真正改名、与预览 Worker **同一个函数**
 * （ADR-001 预览 ≡ 执行），所以演示结果不可能和实际执行结果不一致。
 */
const demoTo = computed<string | null>(() => {
  if (!regexOn.value || rule.regexError) return null
  const r = rule.rule
  const stem =
    r.mode === 'delete'
      ? r.delete.text === ''
        ? null
        : applyDelete(DEMO_PARTS.stem, r.delete.text, r.caseSensitive, true)
      : r.replace.find === ''
        ? null
        : applyReplace(DEMO_PARTS.stem, r.replace.find, r.replace.to, r.caseSensitive, true)
  return stem === null ? null : joinName(stem, DEMO_PARTS.ext)
})

/** 填了内容，但这条示例名字一个字都没变 —— 得说清楚，不能假装演示成功 */
const demoUnchanged = computed(() => demoTo.value === REGEX_DEMO_FILE)

/** 前缀 / 后缀里用了 {d} 但没勾「启用日期」时给个提示（否则会静默展开成空串）*/
const needsDateHint = computed(
  () =>
    isRuleMode.value &&
    !rule.rule.rule.dateEnabled &&
    (rule.rule.rule.prefix.includes('{d}') || rule.rule.rule.suffix.includes('{d}')),
)
const needsSeqHint = computed(
  () =>
    isRuleMode.value &&
    !rule.rule.rule.seqEnabled &&
    (rule.rule.rule.prefix.includes('{n}') || rule.rule.rule.suffix.includes('{n}')),
)

/* ══ P3-1 · 序号组（EL-121 ~ EL-125）═══════════════════════════════════ */

const seqOn = computed(() => rule.rule.rule.seqEnabled)

/* ── P3-3（第 3 批）：属性组（EL-130 / EL-131）────────────────────────── */

/**
 * 属性变量清单（现在是 **4 个**：`{创建}` `{修改}` `{大小}` `{文件夹}`）。
 *
 * ★ P3-6：**不再本地手写** —— 从 `shared/attr-vars.ts` 读，
 *   让「chip」与「前缀提示行」两处**都由同一份数据生成**（设计 §5.①）。
 *   这一次重构就是为「加了变量却忘了改提示行」那个坑做的（已咬过两次）。
 */

/**
 * 点一下把变量追加到**前缀末尾**（IX-112）。
 *
 * 为什么做成可点而不是让用户手打：这三个变量带花括号，手打容易漏括号或写成
 * 全角括号 —— 而**打错的变量名不会报错、会被原样留在文件名里**（设计 §5.④）。
 */
function insertVar(token: string): void {
  rule.patchInner({ prefix: (rule.rule.rule.prefix ?? '') + token })
}

/** 示例用的**固定假属性值**（设计 §3.5）—— 与 P3-1「固定拿【素材】试」同一个思路 */
const DEMO_CREATED = '2026-09-18'
const DEMO_MODIFIED = '2026-09-02'
const DEMO_BYTES = 2516582
/** ★ P3-6：`{文件夹}` 的固定假值（写死「素材」，否则示例里它会空着/原样，用户以为没生效）*/
const DEMO_FOLDER = '素材'

/**
 * 属性示例行。★ 跟着「大小单位」实时重算 —— 改单位，示例立刻从 `2.4MB`
 * 变成 `2516582B`，「单位是干吗的」不用讲、看一眼就懂。
 */
const attrDemo = computed(() => {
  const r = rule.rule.rule
  return [
    dateText(DEMO_CREATED, r.dateFormat),
    dateText(DEMO_MODIFIED, r.dateFormat),
    sizeText(DEMO_BYTES, r.sizeUnit),
  ].join(' · ')
})
const seqKind = computed(() => rule.rule.rule.seqKind)
const seqAtMode = computed(() => rule.rule.rule.seqPosition === 'at')

/** 本机今天（本地时区）。只用于「示例行」——引擎自己从不读时钟（DEC-03）*/
const TODAY = todayYmd()

/**
 * EL-124 示例行：拿固定示例名 `【素材】` 试前三个位置。
 *
 * 三个刻意的选择（设计 §5.2）：
 *  1. **常显在规则化模式**，不藏进进阶折叠 —— 编号是所有人都会配的东西，
 *     参数一改就必须立刻看到结果；藏起来等于让用户去文件列表里自己找。
 *  2. 示例名**固定用 `【素材】`**，不跟随列表里的真实文件 —— 用真实文件的话
 *     示例会跟着列表变，用户想对照「改了参数会怎样」时就失去了参照物。
 *     所以文案里必须**明说**它不是真实预览。
 *  3. 走 `applyRuleMode` —— **与预览 Worker、与主进程执行器同一个函数**
 *     （ADR-001），所以示例不可能与真正改下去的结果不一致。
 */
const DEMO_SEQ_STEM = '【素材】'
const demoSeqNames = computed<string[]>(() =>
  [0, 1, 2].map((i) =>
    applyRuleMode(DEMO_SEQ_STEM, rule.rule.rule, {
      index: i,
      total: 3,
      date: TODAY,
      // P3-3：示例用**固定的假属性值**（与「固定拿【素材】试」同一个思路）
      attrs: { created: DEMO_CREATED, modified: DEMO_MODIFIED, sizeBytes: DEMO_BYTES },
      // ★ P3-6：`{文件夹}` 的假值
      dirName: DEMO_FOLDER,
      // 三个位置用不同的种子：随机字符类型下会显示三个不同的串，而不是把同一个串
      // 贴三遍 —— 后者会让人误以为「所有文件都会被改成同一个名字」
      seedKey: `demo-${i}`,
    }),
  ),
)

/** 选中第三档时把焦点自动送进那个内联数字框（IX-109）*/
const seqAtInput = ref<HTMLInputElement | null>(null)
watch(seqAtMode, async (on) => {
  if (!on) return
  await nextTick()
  seqAtInput.value?.focus()
})

/** EL-121 / IX-107：切换编号类型（切到「时间」且起点为空时由 store 填本机今天）*/
function onSeqKind(e: Event): void {
  rule.switchSeqKind((e.target as HTMLSelectElement).value as SeqKind)
}

/** EL-125 / IX-108：「换一批」= 随机种子 +1（单调递增，所以点一次必然与上一批不同）*/
function onReroll(): void {
  rule.bumpRandomSeed()
}

function onSeqTimeStart(e: Event): void {
  rule.patchInner({ seqTimeStart: (e.target as HTMLInputElement).value })
}

/**
 * 数字框统一入口。越界钳制交给 store 的 `clamp()` —— 组件不自己算，
 * 免得界面一套范围、主进程 `sanitizeRule` 又一套（那就是「预览对、执行错」）。
 */
function setNumber(
  key: 'seqStart' | 'seqStep' | 'seqPad' | 'seqAt' | 'seqRandomLen',
  raw: string,
): void {
  const n = Number(raw)
  rule.patchInner({ [key]: Number.isFinite(n) ? n : 0 } as Partial<typeof rule.rule.rule>)
}

/* ══ P3-5 · 插入模式（EL-136 / IX-117）═══════════════════════════════ */

/** 示例名（与 P3-1 的 `【素材】` 同一个思路：固定、不是你列表里的文件）*/
const INSERT_DEMO_STEM = '【素材】'
/** EL-136 示例行：走 `applyInsert` —— 与真正改名、与预览 Worker **同一个函数** */
const insertDemo = computed(() =>
  applyInsert(INSERT_DEMO_STEM, rule.rule.insert.at, rule.rule.insert.text),
)

/**
 * 插入位置的数字框。⚠️ 下限 0、**不设上限**：越界由引擎自动落到末尾。
 * 钳制交给 store 的 `clamp()`（与主进程 `sanitizeRule` 同一口径，否则「预览对、执行错」）。
 */
function setInsertAt(e: Event): void {
  const n = Number((e.target as HTMLInputElement).value)
  rule.patch({ insert: { at: Number.isFinite(n) ? n : 0 } })
}

/* ══ P3-5 · 扩展名小组（EL-138 / IX-119）═════════════════════════════ */

/** 勾上「改扩展名」= `extMode !== 'keep'`（不勾就是默认的「保持原样」） */
const extOn = computed(() => rule.rule.extMode !== 'keep')
/** 只有「改成指定扩展名 / 在后面再加一个」才需要输入框 */
const extNeedsValue = computed(() => rule.rule.extMode === 'set' || rule.rule.extMode === 'append')

function onExtToggle(e: Event): void {
  const on = (e.target as HTMLInputElement).checked
  rule.patch({ extMode: on ? 'set' : 'keep' })
}

function onExtMode(e: Event): void {
  rule.patch({ extMode: (e.target as HTMLSelectElement).value as ExtMode })
}
</script>

<template>
  <section class="md-rulepanel">
    <!-- ── P2-B · EL-120 常用规则（F-12 模板库）───────────────────────────
         为什么长在**最上面、页签之前**：它是给「根本不知道该怎么配规则的人」
         准备的一键入口。藏进下面的「⚙ 进阶设置」折叠区，就正好把目的反过来
         —— 折叠区是给进阶用户做隔离用的（P2-B 设计 §2.1 / DEC-14）。
         规格：小标题 12px Medium ink-3；chip 高 26px、内边距 4×11px、
         圆角复用 --md-radius-chip 9px；底色橙三件套，**本批零新增令牌**。 -->
    <div class="md-tpl" data-rule-templates>
      <span class="md-tpl__title">常用规则</span>
      <div class="md-tpl__row">
        <button
          v-for="t in RULE_TEMPLATES"
          :key="t.id"
          type="button"
          class="md-tpl__chip"
          :data-template="t.id"
          :title="t.hint"
          @click="useTemplate(t)"
        >
          {{ t.name }}
        </button>
      </div>
    </div>

    <!-- ── P3-4 · EL-134 名字来源提示条 ──────────────────────────────
         为什么必须有：被导入的项**不再受规则影响**（表格给的 override 优先）。
         不说明的话，用户改了规则发现「怎么有几个没变」—— 又是一个
         「界面无异常但行为不对」的迷局（设计 §2.3）。这条把真相摆在原地。
         位置与 P2-B 模板条同一处逻辑：**常显、不进折叠**。 -->
    <!-- ★ P3-5：只在**导入模式**下显示 —— 第 4 批它是「叠加覆盖层」，本批收回成
         五选一互斥：选了别的模式，表格整个不生效，这条提示就不该出现（设计 §3.3）。 -->
    <div v-if="isImportMode && files.overrideCount > 0" class="md-srcbar" data-import-bar>
      <span class="md-srcbar__text">
        本批有 {{ files.overrideCount }} 个名字来自「{{ files.overrideSource }}」，规则不影响它们
      </span>
      <button class="md-srcbar__btn" data-import-clear @click="clearImported">清除导入</button>
    </div>

    <!-- EL-040 页签组（三选一，互斥）-->
    <div class="md-tabs" role="tablist">
      <button
        v-for="t in TABS"
        :key="t.mode"
        class="md-tab"
        :class="{ 'md-tab--active': rule.activeMode === t.mode }"
        role="tab"
        :aria-selected="rule.activeMode === t.mode"
        @click="rule.setMode(t.mode)"
      >
        {{ t.label }}
      </button>
    </div>

    <div class="md-rulepanel__form">
      <!-- ── 删除模式 ── -->
      <template v-if="rule.rule.mode === 'delete'">
        <label class="md-rulepanel__label">待删字符串</label>
        <input
          class="md-input"
          :class="{ 'md-input--mono': regexOn, 'md-input--error': !!rule.regexError }"
          placeholder="例如：【某某公众号】"
          :value="rule.rule.delete.text"
          @input="rule.patch({ delete: { text: ($event.target as HTMLInputElement).value } })"
        />
        <p v-if="rule.regexError" class="md-hint md-rulepanel__regerr md-rulepanel__span">
          {{ rule.regexError }}
        </p>
      </template>

      <!-- ── 替换模式 ── -->
      <template v-else-if="rule.rule.mode === 'replace'">
        <label class="md-rulepanel__label">查找</label>
        <input
          class="md-input"
          :class="{ 'md-input--mono': regexOn, 'md-input--error': !!rule.regexError }"
          placeholder="例如：最终版"
          :value="rule.rule.replace.find"
          @input="rule.patch({ replace: { find: ($event.target as HTMLInputElement).value } })"
        />
        <p v-if="rule.regexError" class="md-hint md-rulepanel__regerr md-rulepanel__span">
          {{ rule.regexError }}
        </p>
        <label class="md-rulepanel__label">替换为</label>
        <input
          class="md-input"
          :class="{ 'md-input--mono': regexOn }"
          placeholder="留空 = 删除"
          :value="rule.rule.replace.to"
          @input="rule.patch({ replace: { to: ($event.target as HTMLInputElement).value } })"
        />
      </template>

      <!-- ── 插入模式（P3-5 · EL-136）──────────────────────────────────
           在名字的第 N 个字符后插入一段任意文字。它与「自定义」里的「插在第 n 个
           字符后」不重叠：这里插任意文字，那里是「把序号/日期插到中间」（设计 §1.4）。 -->
      <template v-else-if="isInsertMode">
        <div class="md-rulepanel__group" data-insert-group>
          <div class="md-rulepanel__seqline">
            <label class="md-rulepanel__picker">
              <span>在第</span>
              <input
                class="md-input md-input--num md-input--at"
                data-insert-at
                type="number"
                min="0"
                aria-label="插在第几个字符后"
                :value="rule.rule.insert.at"
                @input="setInsertAt"
              />
              <span>个字符后插入</span>
            </label>
            <input
              class="md-input"
              data-insert-text
              placeholder="如 2026"
              :value="rule.rule.insert.text"
              @input="rule.patch({ insert: { text: ($event.target as HTMLInputElement).value } })"
            />
          </div>
          <p class="md-hint md-rulepanel__span">
            数字超出名字长度时会自动放到末尾；填 0 等于加在最前面。插入的文字里<b>不认识变量</b>（<code>{n}</code>、<code>{d}</code> 会原样插进去）。
          </p>
          <!-- EL-136 示例行：走 applyInsert —— 与真正改名、与预览 Worker 同一个函数 -->
          <p class="md-hint md-rulepanel__span" data-insert-demo>
            示例（拿「{{ INSERT_DEMO_STEM }}」这个名字试的，不是你列表里的文件）：
            {{ INSERT_DEMO_STEM }} → {{ insertDemo }}
          </p>
        </div>
      </template>

      <!-- ── 导入模式（P3-5 · EL-137）──────────────────────────────────
           这个模式**本身没有输入框**，它是一个「入口 + 状态」：名字由表格决定，
           规则引擎完全不参与（设计 §2.2 / §1.5）。 -->
      <template v-else-if="isImportMode">
        <div class="md-rulepanel__group" data-import-group>
          <p class="md-hint md-rulepanel__span">名字由表格决定，规则引擎不参与。</p>
          <button
            type="button"
            class="md-btn md-btn--secondary"
            data-import-pick
            @click="files.pickTable()"
          >
            {{ files.overrideCount > 0 ? '重新选表格' : '选表格并导入…' }}
          </button>
          <template v-if="files.overrideCount > 0">
            <p class="md-hint md-rulepanel__span" data-import-status>
              已导入「{{ files.overrideSource }}」：{{ files.overrideCount }} 个文件有名字
            </p>
            <!-- ★ 这句必须写：不写的话用户会以为「我导入了，那其余文件也该改点什么」 -->
            <p
              v-if="files.importOutsideIds.size > 0"
              class="md-hint md-rulepanel__span"
              data-import-outside-note
            >
              另外 {{ files.importOutsideIds.size }} 个文件表里没有 —— 它们保持原名不动
            </p>
          </template>
          <p v-else class="md-hint md-rulepanel__span" data-import-empty>
            导入模式：还没选表格 —— 这一步每一项都不会改名。
          </p>
        </div>
      </template>

      <!-- ── 自定义模式（= 代码里的 `rule`；五个要素可叠加）── -->
      <template v-else-if="isRuleMode">
        <label class="md-rulepanel__label">前缀</label>
        <input
          class="md-input"
          placeholder="如 {d}-发票-"
          :value="rule.rule.rule.prefix"
          @input="rule.patchInner({ prefix: ($event.target as HTMLInputElement).value })"
        />
        <label class="md-rulepanel__label">后缀</label>
        <input
          class="md-input"
          placeholder="加在扩展名之前"
          :value="rule.rule.rule.suffix"
          @input="rule.patchInner({ suffix: ($event.target as HTMLInputElement).value })"
        />

        <!-- ★ P3-3：这行**不改就等于功能不存在** —— 三个属性变量完全正常工作、
             测试全绿、界面一点异常都没有，**只是没有任何用户知道有它们**。
             这不是代码 bug，而是「功能等于不存在」。 -->
        <!-- ★★ P3-6：这一行**改成由 `ATTR_VARS` 生成**（不再是手写的一串 <code>）。
             不这么做的后果已经发生过两次：功能完全正常、测试全绿、界面无异常，
             **就是没有任何用户知道有新变量**（设计 §2.2 / §5.① / §7.3 第 1 行）。 -->
        <p class="md-hint md-rulepanel__varhint" data-var-hint>
          支持变量 <code>{n}</code> 序号、<code>{d}</code> 日期（<b>需先勾选下方对应开关</b>）<template
            v-for="v in ATTR_VARS"
            :key="v.token"
          >、<code>{{ v.token }}</code> {{ v.label }}</template>（<b>写上就生效，不用开关</b>）
        </p>

        <!-- ── 序号组（EL-121 ~ EL-125）────────────────────────────────────
             P3-1 的组内顺序：启用序号 → 位置 → 类型 → 参数（随类型）→ 示例。
             位置放在类型上面：沿用 P0 的排布（改动最小），也正是列需求时的语序。
             组标题仍叫「启用序号」—— 它是这个组的开关，不跟着类型改名。 -->
        <div class="md-rulepanel__group">
          <label class="md-check">
            <input
              type="checkbox"
              :checked="rule.rule.rule.seqEnabled"
              @change="rule.patchInner({ seqEnabled: ($event.target as HTMLInputElement).checked })"
            />
            <span class="md-check__box"><MdIcon name="check" :size="11" /></span>
            <span class="md-check__label">启用序号</span>
          </label>

          <!-- EL-123 位置（三档）。选中第三档时就地长出一个数字框，**不另开一行**；
               选别的两档这个框**不显示**（不是置灰）—— 它只对第三档有意义，
               摆一个常驻的灰框会让人以为「填了就能用」。 -->
          <div class="md-rulepanel__seqline">
            <label class="md-rulepanel__picker">
              <span>位置</span>
              <select
                class="md-select"
                data-seq-position
                :disabled="!seqOn"
                :value="rule.rule.rule.seqPosition"
                @change="rule.patchInner({ seqPosition: ($event.target as HTMLSelectElement).value as SeqPosition })"
              >
                <option v-for="o in SEQ_POSITION_OPTIONS" :key="o.value" :value="o.value">
                  {{ o.label }}
                </option>
              </select>
            </label>
            <input
              v-if="seqAtMode"
              ref="seqAtInput"
              class="md-input md-input--num md-input--at"
              data-seq-at
              type="number"
              min="1"
              max="200"
              aria-label="插在第几个字符后"
              :disabled="!seqOn"
              :value="rule.rule.rule.seqAt"
              @input="setNumber('seqAt', ($event.target as HTMLInputElement).value)"
            />
          </div>
          <!-- 一句话把越界规则说在前面，省掉一次「为什么没生效」 -->
          <p v-if="seqAtMode" class="md-hint md-rulepanel__span" data-seq-at-hint>
            数字超出名字长度时，会自动放到末尾。
          </p>

          <!-- EL-121 编号类型。它是规则化模式**内部**的参数（与位置 / 起始同级），
               不是第四种模式 —— 等到第 5 批把模式拆成五个，这个下拉照样待在这儿。 -->
          <label class="md-rulepanel__picker">
            <span>类型</span>
            <select
              class="md-select"
              data-seq-kind
              :disabled="!seqOn"
              :value="rule.rule.rule.seqKind"
              @change="onSeqKind"
            >
              <option v-for="o in SEQ_KIND_OPTIONS" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </select>
          </label>

          <!-- EL-122 参数行：随类型切换。「位数」在三种类型下**不显示**（不是置灰）——
               字母没有补零、随机字符的长度是另一个字段、时间的补零由样式决定；
               摆一个填了也没用的框，只会让人怀疑自己填错了。 -->
          <div class="md-rulepanel__nums" data-seq-params>
            <template v-if="seqKind === 'number' || seqKind === 'letter'">
              <label class="md-rulepanel__numitem">
                <span>起始</span>
                <input
                  class="md-input md-input--num"
                  data-seq-start
                  type="number"
                  min="0"
                  :disabled="!seqOn"
                  :value="rule.rule.rule.seqStart"
                  @input="setNumber('seqStart', ($event.target as HTMLInputElement).value)"
                />
              </label>
              <label class="md-rulepanel__numitem">
                <span>增量</span>
                <input
                  class="md-input md-input--num"
                  data-seq-step
                  type="number"
                  min="1"
                  :disabled="!seqOn"
                  :value="rule.rule.rule.seqStep"
                  @input="setNumber('seqStep', ($event.target as HTMLInputElement).value)"
                />
              </label>
            </template>

            <label v-if="seqKind === 'number'" class="md-rulepanel__numitem">
              <span>位数</span>
              <input
                class="md-input md-input--num"
                data-seq-pad
                type="number"
                min="0"
                max="6"
                :disabled="!seqOn"
                :value="rule.rule.rule.seqPad"
                @input="setNumber('seqPad', ($event.target as HTMLInputElement).value)"
              />
            </label>

            <template v-if="seqKind === 'random'">
              <label class="md-rulepanel__numitem">
                <span>长度</span>
                <input
                  class="md-input md-input--num"
                  data-seq-len
                  type="number"
                  min="1"
                  max="16"
                  :disabled="!seqOn"
                  :value="rule.rule.rule.seqRandomLen"
                  @input="setNumber('seqRandomLen', ($event.target as HTMLInputElement).value)"
                />
              </label>
              <button
                type="button"
                class="md-seqbtn"
                data-seq-reroll
                :disabled="!seqOn"
                @click="onReroll"
              >
                换一批
              </button>
            </template>

            <template v-if="seqKind === 'time'">
              <label class="md-rulepanel__numitem">
                <span>起点</span>
                <input
                  class="md-input md-input--date"
                  data-seq-timestart
                  type="date"
                  :disabled="!seqOn"
                  :value="rule.rule.rule.seqTimeStart"
                  @input="onSeqTimeStart"
                />
              </label>
              <label class="md-rulepanel__picker">
                <span>样式</span>
                <select
                  class="md-select"
                  data-seq-timeformat
                  :disabled="!seqOn"
                  :value="rule.rule.rule.seqTimeFormat"
                  @change="rule.patchInner({ seqTimeFormat: ($event.target as HTMLSelectElement).value as DateFormat })"
                >
                  <option v-for="o in DATE_FORMAT_OPTIONS" :key="o.value" :value="o.value">
                    {{ o.label }}
                  </option>
                </select>
              </label>
              <label class="md-rulepanel__numitem">
                <span>增量（天）</span>
                <input
                  class="md-input md-input--num"
                  data-seq-daystep
                  type="number"
                  min="1"
                  :disabled="!seqOn"
                  :value="rule.rule.rule.seqStep"
                  @input="setNumber('seqStep', ($event.target as HTMLInputElement).value)"
                />
              </label>
            </template>
          </div>

          <!-- EL-124 示例行。未勾「启用序号」时整块不显示（没启用就没什么可示例的）-->
          <div v-if="seqOn" class="md-rulepanel__demo" data-seq-demo>
            <p class="md-rulepanel__demotitle">
              示例（拿「{{ DEMO_SEQ_STEM }}」这个名字试的，不是你列表里的文件）
            </p>
            <p class="md-rulepanel__demoline">
              <template v-for="(name, i) in demoSeqNames" :key="i">
                <span v-if="i > 0" class="md-rulepanel__demodot" aria-hidden="true">·</span>
                <code class="md-rulepanel__demonew">{{ name }}</code>
              </template>
            </p>
          </div>
        </div>

        <div class="md-rulepanel__group">
          <label class="md-check">
            <input
              type="checkbox"
              :checked="rule.rule.rule.dateEnabled"
              @change="rule.patchInner({ dateEnabled: ($event.target as HTMLInputElement).checked })"
            />
            <span class="md-check__box"><MdIcon name="check" :size="11" /></span>
            <span class="md-check__label">启用日期（取执行当天）</span>
          </label>

          <label class="md-rulepanel__picker">
            <span>日期格式</span>
            <select
              class="md-select"
              data-date-format
              :disabled="!rule.rule.rule.dateEnabled"
              :value="rule.rule.rule.dateFormat"
              @change="rule.patchInner({ dateFormat: ($event.target as HTMLSelectElement).value as DateFormat })"
            >
              <option v-for="o in DATE_FORMAT_OPTIONS" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </select>
          </label>
        </div>

        <!-- P3-1 §6 跨天提示。做成常显：「启用日期」取的是**执行当天**，
             23:58 预览、00:01 执行就会差一天；好在主进程有挡板（`date` 必须
             等于本机今天），跨过零点后会要求重新预览。这条行为此前只活在主进程的
             一行校验里，文档与界面都没有 —— 现在把它显式讲出来。 -->
        <p class="md-hint md-rulepanel__span" data-date-hint>
          日期取的是你点「开始改名」那天；如果中途跨过了零点，需要重新预览一次。
        </p>

        <!-- ── 属性组（EL-130 / EL-131 · P3-3）─────────────────────────
             三个属性变量是**规则化模式里的变量**，不是第四种模式
             （与 P3-1 把编号类型放进序号组同一个判断）。
             ★ 它们**没有启用开关** —— 属性只有「用户写了才出现」，
               不像序号 / 日期那样还有一个自动位置。加一个勾只会让人
               以为「勾上就会自动加进名字」（设计 §1.2 / §5.①）。 -->
        <div class="md-rulepanel__group">
          <div class="md-attr__vars">
            <span class="md-attr__label">属性</span>
            <div class="md-attr__list">
              <button
                v-for="v in ATTR_VARS"
                :key="v.token"
                type="button"
                class="md-attr__var"
                :data-attr-insert="v.token"
                @click="insertVar(v.token)"
              >
                <span>{{ v.label }}</span>
                <code class="md-attr__token">{{ v.token }}</code>
              </button>
            </div>
          </div>

          <!-- 常显说明：日期格式两处共用一份
               —— 不写的话，用户不启用日期就找不到那个下拉 -->
          <p class="md-hint md-rulepanel__span">
            注：创建 / 修改日期用的是上面「日期格式」那一档 —— 改那里，三处一起变。
          </p>

          <label class="md-rulepanel__picker">
            <span>大小</span>
            <select
              class="md-select"
              data-size-unit
              :value="rule.rule.rule.sizeUnit"
              @change="rule.patchInner({ sizeUnit: ($event.target as HTMLSelectElement).value as SizeUnit })"
            >
              <option v-for="o in SIZE_UNIT_OPTIONS" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </select>
          </label>

          <p class="md-hint md-rulepanel__span" data-attr-demo>
            示例（假的文件名 + 假的属性值，不是你列表里的文件）：{{ attrDemo }}
          </p>

          <p class="md-hint md-rulepanel__span">
            属性是你把文件拖进来那一刻读的，之后不再刷新。
          </p>

          <!-- ★ P3-6 §2.3：只填 {文件夹} 会撞名 —— 说在前面，
               省得用户看到「一半标红」以为软件坏了（其实那是既有的冲突保护）。 -->
          <p class="md-hint md-rulepanel__span" data-folder-hint>
            只填 <code>{文件夹}</code> 的话，同一个文件夹里的同类文件会重名 —— 建议配上
            <code>{n}</code> 序号。
          </p>
        </div>

        <label class="md-check md-rulepanel__span">
          <input
            type="checkbox"
            :checked="rule.rule.rule.keepOriginal"
            @change="rule.patchInner({ keepOriginal: ($event.target as HTMLInputElement).checked })"
          />
          <span class="md-check__box"><MdIcon name="check" :size="11" /></span>
          <span class="md-check__label">保留原文件名（取消则丢弃原主体）</span>
        </label>

        <p v-if="needsDateHint" class="md-hint md-rulepanel__warn">
          名称里用了 <code>{d}</code>，但「启用日期」没勾 —— 日期会展开成空
        </p>
        <p v-if="needsSeqHint" class="md-hint md-rulepanel__warn">
          名称里用了 <code>{n}</code>，但「启用序号」没勾 —— 序号会展开成空
        </p>
      </template>

      <!-- ── EL-138 扩展名小组（P3-5）────────────────────────────────────
           ★ 放在「进阶设置」折叠区**外面**：它虽然默认关，但要能被看见 ——
           藏进折叠区就等于没有（P2-C 的教训：有开关没入口 = 等于没有，设计 §2.3 / §5.②）。
           ★ 它不是第六个模式，而是与「大小写转换」同级的「结果处理」（设计 §1.6）。 -->
      <div class="md-rulepanel__group" data-ext-group>
        <label class="md-check">
          <input type="checkbox" data-ext-toggle :checked="extOn" @change="onExtToggle" />
          <span class="md-check__box"><MdIcon name="check" :size="11" /></span>
          <span class="md-check__label">改扩展名</span>
        </label>
        <div v-if="extOn" class="md-rulepanel__seqline">
          <select class="md-select" data-ext-mode :value="rule.rule.extMode" @change="onExtMode">
            <option v-for="o in EXT_MODE_OPTIONS" :key="o.value" :value="o.value">
              {{ o.label }}
            </option>
          </select>
          <input
            v-if="extNeedsValue"
            class="md-input md-input--ext"
            data-ext-value
            placeholder="如 pdf"
            :value="rule.rule.extValue"
            @input="rule.patch({ extValue: ($event.target as HTMLInputElement).value })"
          />
        </div>
        <p class="md-hint md-rulepanel__span" data-ext-hint>
          与「全部小写」互不影响：扩展名按你写的样子来（写 <code>PDF</code> 就是 <code>.PDF</code>）。
        </p>
      </div>

      <!-- EL-044 区分大小写：只在删除 / 替换模式出现（正面判断，P3-5 修）-->
      <label v-if="isMatchMode" class="md-check md-rulepanel__span">
        <input
          type="checkbox"
          :checked="rule.rule.caseSensitive"
          @change="rule.patch({ caseSensitive: ($event.target as HTMLInputElement).checked })"
        />
        <span class="md-check__box"><MdIcon name="check" :size="11" /></span>
        <span class="md-check__label">区分大小写</span>
      </label>
    </div>

    <!-- EL-056 进阶设置折叠条（默认折起；有启用项时高亮 + 徽标）-->
    <div v-if="showAdvanced" class="md-adv">
      <button
        type="button"
        class="md-adv__bar"
        :class="{ 'md-adv__bar--on': advancedCount > 0 }"
        :aria-expanded="advancedOpen"
        @click="advancedOpen = !advancedOpen"
      >
        <MdIcon name="gear" :size="14" />
        <span class="md-adv__title">进阶设置</span>
        <span class="md-adv__right">
          <span v-if="advancedCount > 0" class="md-adv__badge">已启用 {{ advancedCount }} 项</span>
          <span class="md-adv__caret" :class="{ 'md-adv__caret--open': advancedOpen }" aria-hidden="true" />
        </span>
      </button>

      <div v-if="advancedOpen" class="md-adv__body">
        <!-- EL-057 正则匹配开关：仅删除 / 替换模式出现 -->
        <template v-if="isMatchMode">
          <!-- 「?」按钮必须待在 <label> **外面** —— 塞进 label 里点它会连带勾选复选框 -->
          <div class="md-adv__switchrow">
            <label class="md-check">
              <input
                type="checkbox"
                :checked="rule.rule.regexEnabled"
                @change="rule.patch({ regexEnabled: ($event.target as HTMLInputElement).checked })"
              />
              <span class="md-check__box"><MdIcon name="check" :size="11" /></span>
              <span class="md-check__label">用正则匹配</span>
            </label>
            <button
              type="button"
              class="md-adv__helpbtn"
              :aria-expanded="helpOpen"
              @click="helpOpen = !helpOpen"
            >
              ? 看不懂？
            </button>
          </div>

          <p class="md-hint md-adv__why">
            不用正则：你填什么就找一模一样的字 —— 填 <code>2026-08-01</code>，换个日期就找不着了。<br />
            用正则：你说「长什么样」，数字换了也认得出 —— 填 <code>\d+</code>，一串数字不管几位都能找到。
          </p>

          <!-- EL-104 照抄表（默认收起，点 EL-103 打开）-->
          <div v-if="helpOpen" class="md-adv__cheat">
            <ul class="md-adv__cheatlist">
              <li v-for="row in cheatRows" :key="row.goal" class="md-adv__cheatrow">
                <span class="md-adv__cheatgoal">{{ row.goal }}</span>
                <span class="md-adv__cheatfill">
                  查找填 <code>{{ row.find }}</code>
                  <template v-if="rule.rule.mode === 'replace'">
                    ｜ 替换填 <code>{{ row.to === '' ? '（留空）' : row.to }}</code>
                  </template>
                </span>
                <span class="md-adv__cheatex">
                  <code>{{ row.sampleFrom }}</code> → <code>{{ row.sampleTo }}</code>
                </span>
              </li>
            </ul>
            <p v-if="rule.rule.mode === 'replace'" class="md-hint">
              括号 <code>( )</code> = 先圈出来存着；<code>$1</code> = 把圈出来的第 1 段搬过来（<code>$2</code>
              就是第 2 段）。替换框留空 = 直接删掉。
            </p>
          </div>

          <!-- EL-105 当场演示：拿上面填的内容，对固定示例名字实时算一遍 -->
          <div v-if="regexOn && !rule.regexError" class="md-adv__demo">
            <p class="md-adv__demotitle">当场看看（拿这条示例名字试的，不是你列表里的文件）</p>
            <template v-if="demoTo !== null">
              <p class="md-adv__demoline">
                <code>{{ REGEX_DEMO_FILE }}</code>
                <span class="md-adv__demoarrow" aria-hidden="true">→</span>
                <code class="md-adv__demonew" :class="{ 'md-adv__demonew--same': demoUnchanged }">{{ demoTo }}</code>
              </p>
              <p v-if="demoUnchanged" class="md-hint">
                这条示例里没找到能匹配的内容 —— 换个写法试试。
              </p>
            </template>
            <p v-else class="md-hint">在上面「查找」框里填点什么，这里就会立刻跟着变。</p>
          </div>
        </template>

        <!-- EL-059 大小写转换：三种模式都出现 -->
        <label class="md-rulepanel__picker md-adv__case">
          <span>大小写</span>
          <select
            class="md-select"
            :value="rule.rule.caseTransform"
            @change="rule.patch({ caseTransform: ($event.target as HTMLSelectElement).value as CaseTransform })"
          >
            <option v-for="o in CASE_TRANSFORM_OPTIONS" :key="o.value" :value="o.value">
              {{ o.label }}
            </option>
          </select>
        </label>
      </div>
    </div>

    <!-- EL-055 自动处理重名冲突（DEC-05：默认未勾选）-->
    <footer class="md-rulepanel__foot">
      <label class="md-switch">
        <input
          type="checkbox"
          :checked="rule.rule.autoResolveConflict"
          @change="rule.patch({ autoResolveConflict: ($event.target as HTMLInputElement).checked })"
        />
        <span class="md-switch__track"><span class="md-switch__thumb" /></span>
        <span class="md-switch__label">自动处理重名冲突</span>
      </label>
      <p class="md-hint">
        关闭时冲突项会被跳过。无论开关如何，都「不会覆盖」任何已有文件。当前规则：{{ rule.summary }}
      </p>
    </footer>
  </section>
</template>

<style scoped>
.md-rulepanel {
  background: var(--md-bg-card);
  border-radius: var(--md-radius-card);
  box-shadow: var(--md-shadow-card);
  padding: var(--md-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--md-space-3);
  /* ★ 按内容完整展开，**自己不做滚动**（滚动交给外层 .md-main__right-body 整块滚）。
     规则化模式内容再长也只是把整块工作区撑高，不去压缩列表、也不出现嵌套滚动条。 */
  flex: 0 0 auto;
}

/* ── P2-B · EL-120 常用规则条 ────────────────────────────────────────
   与下面「⚙ 进阶设置」是两种相反的东西，视觉上也要分得开：
   这里是常显的一键入口（橘色 chip），那里是折起的进阶开关区。
   下边框把它和页签分开 —— 它是**独立一行**，不是页签组的一部分。 */
.md-tpl {
  display: flex;
  flex-direction: column;
  gap: var(--md-space-1);
  padding-bottom: var(--md-space-3);
  border-bottom: 1px solid var(--md-line);
}

.md-tpl__title {
  font-size: 12px;
  font-weight: 500;
  color: var(--md-ink-3);
}

.md-tpl__row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.md-tpl__chip {
  height: 26px;
  padding: 4px 11px;
  border: 0;
  border-radius: var(--md-radius-chip);
  background: var(--md-orange-soft);
  color: var(--md-orange-dark);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color var(--md-dur-hover) ease,
    color var(--md-dur-hover) ease,
    box-shadow var(--md-dur-hover) ease;
}

/* 悬停：底转品牌橘，字转深棕（橘底上的前景色，对比 8.3:1，两主题同值）*/
.md-tpl__chip:hover {
  background: var(--md-orange-primary);
  color: var(--md-on-brand);
  box-shadow: var(--md-shadow-btn-hover);
}

.md-rulepanel__form {
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr);
  align-items: center;
  gap: var(--md-space-2);
}

.md-rulepanel__label {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--md-ink-2);
}

.md-rulepanel__span {
  grid-column: 1 / -1;
}

.md-rulepanel__varhint,
.md-rulepanel__warn {
  grid-column: 1 / -1;
  margin: 0;
}

.md-rulepanel__warn {
  color: var(--md-warn);
}

/* 正则非法：红字原因（设计 §3.3）—— 与红描边同为「冲突 / 失败」语义色 #E5544B */
.md-rulepanel__regerr {
  color: var(--md-bad);
}

.md-rulepanel__group {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  gap: var(--md-space-2);
  padding: var(--md-space-2);
  border-radius: var(--md-radius-input);
  background: var(--md-bg-warm);
}

.md-rulepanel__nums {
  display: flex;
  gap: var(--md-space-3);
  flex-wrap: wrap;
}

.md-rulepanel__numitem,
.md-rulepanel__picker {
  display: flex;
  align-items: center;
  gap: var(--md-space-2);
  font-size: 12.5px;
  color: var(--md-ink-2);
}

.md-rulepanel__foot {
  border-top: 1px solid var(--md-line);
  padding-top: var(--md-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--md-space-1);
}

code {
  font-family: var(--md-font-num);
  background: var(--md-bg-sunken);
  border-radius: 4px;
  padding: 0 4px;
}

/* ── F-10 / F-11 进阶设置折叠区（设计 §2.1）───────────────────────── */
.md-adv {
  display: flex;
  flex-direction: column;
  gap: var(--md-space-2);
}

.md-adv__bar {
  display: flex;
  align-items: center;
  gap: var(--md-space-2);
  width: 100%;
  padding: var(--md-space-1) 0;
  border: 0;
  background: none;
  cursor: pointer;
  color: var(--md-ink-3);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  transition: color var(--md-dur-hover) ease;
}

/* 有启用项时整体变橘 —— 齿轮与箭头都是 currentColor，随之变色 */
.md-adv__bar--on {
  color: var(--md-orange-dark);
}

.md-adv__title {
  font-weight: 500;
}

.md-adv__right {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: var(--md-space-2);
}

.md-adv__badge {
  background: var(--md-orange-soft);
  color: var(--md-orange-dark);
  border-radius: var(--md-radius-badge);
  padding: 3px 8px;
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
}

.md-adv__caret {
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 5px solid currentColor;
  transition: transform var(--md-dur-hover) var(--md-ease-pop);
}

.md-adv__caret--open {
  transform: rotate(180deg);
}

.md-adv__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: var(--md-space-3);
  border-radius: var(--md-radius-input);
  background: var(--md-bg-warm);
}

/* ── EL-103 / EL-104 / EL-105 小白化说明区 ───────────────────────────
   为什么不再用「语法：. 任意字符 · \d 数字 …」那套：那是给**已经会正则的人**查的，
   新手看完仍不知道自己要填什么。改成「想做什么 → 填什么 → 变成什么」的照抄表。 */

/* 开关行：复选框在左、小抄按钮在右（按钮必须待在 <label> 外，见模板注释）*/
.md-adv__switchrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--md-space-2);
}

.md-adv__helpbtn {
  flex: 0 0 auto;
  border: 1px solid var(--md-line-strong);
  background: var(--md-bg-card);
  color: var(--md-ink-2);
  border-radius: var(--md-radius-badge);
  padding: 3px 8px;
  font-family: inherit;
  font-size: 11.5px;
  line-height: 1.4;
  cursor: pointer;
  transition:
    color var(--md-dur-hover) ease,
    border-color var(--md-dur-hover) ease;
}

.md-adv__helpbtn:hover,
.md-adv__helpbtn[aria-expanded='true'] {
  color: var(--md-orange-dark);
  border-color: var(--md-orange-dark);
}

.md-adv__why {
  margin: 0;
  line-height: 1.75;
}

/* 照抄表：一行 = 一个场景，读起来就是「想做什么 → 填什么 → 变成什么」 */
.md-adv__cheat {
  display: flex;
  flex-direction: column;
  gap: var(--md-space-2);
  padding: var(--md-space-2) var(--md-space-3);
  border-radius: var(--md-radius-input);
  background: var(--md-bg-card);
  border: 1px solid var(--md-line);
}

.md-adv__cheatlist {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--md-space-2);
}

.md-adv__cheatrow {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.md-adv__cheatgoal {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--md-ink-1);
}

.md-adv__cheatfill,
.md-adv__cheatex {
  font-size: 12px;
  color: var(--md-ink-2);
  word-break: break-all;
}

/* 当场演示 */
.md-adv__demo {
  display: flex;
  flex-direction: column;
  gap: var(--md-space-1);
  padding: var(--md-space-2) var(--md-space-3);
  border-radius: var(--md-radius-input);
  background: var(--md-bg-sunken);
}

.md-adv__demotitle {
  margin: 0;
  font-size: 12px;
  color: var(--md-ink-3);
}

.md-adv__demoline {
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--md-space-2);
  flex-wrap: wrap;
  font-size: 12.5px;
}

.md-adv__demoarrow {
  color: var(--md-ink-4);
}

/* 演示区底色比代码块深，把 code 提亮回卡片色才读得清 */
.md-adv__demo code {
  background: var(--md-bg-card);
}

/* 新名用「变了」的橘色 —— 与文件列表里新名高亮同色（animations.css 的 .md-diff-add）*/
.md-adv__demonew {
  color: var(--md-orange-dark);
  background: var(--md-highlight-bg);
}

/* 一个字都没变时不能还亮着橘色 —— 那等于在骗人说"变了" */
.md-adv__demonew--same {
  color: var(--md-ink-4);
  background: var(--md-bg-card);
}

.md-adv__case {
  margin-top: var(--md-space-1);
}

/* 正则开启：输入框切等宽（技术信息字体）*/
.md-input--mono {
  font-family: var(--md-font-num);
}

/* 正则非法：2px 红描边（设计 §3.3）。
   box-sizing 全局为 border-box，改 border-width 不会改变外框尺寸 → 不会抖动，
   所以直接写 2px（而不是用内阴影假装第 2px）。同时顶掉 :focus 的橘色描边与光晕。*/
.md-input--error,
.md-input--error:focus {
  border-width: 2px;
  border-color: var(--md-bad);
  box-shadow: none;
}

/* ══ P3-1 · 序号组的新控件（设计 §7.4）═════════════════════════════════
   规格要点：**零新增令牌、零新增色值** —— 下面全部复用既有令牌，
   所以 `tokens.css` 的深色块里一个值都不用补（也就不会漏补）。 */

/* 「位置」与第三档的内联数字框同一行 —— 选中第三档时就地长出来，不另开一行 */
.md-rulepanel__seqline {
  display: flex;
  align-items: center;
  gap: var(--md-space-2);
  flex-wrap: wrap;
}

/* 「第 n 个字符后」的框：64px、居中。
   （数字很短，左对齐会看着像「还没填」；`.md-input--num` 给的 104px 太宽）*/
.md-input--at {
  width: 64px;
  text-align: center;
}

/* 时间类型的「起点」日期框 */
.md-input--date {
  width: 142px;
  font-family: var(--md-font-num);
}

/* ★ P3-5：扩展名输入框宽 120px（够 pdf / bak / tar.gz，设计 §7.6） */
.md-input--ext {
  width: 120px;
}

/* EL-125「换一批」。高 28px 是**单独给的**：既有按钮类只有 22px，够不上
   WCAG 2.5.8 AA 要求的 24×24 CSS px —— 所以这个新按钮不复用它们的高度。 */
.md-seqbtn {
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--md-line-strong);
  border-radius: var(--md-radius-badge);
  background: var(--md-bg-card);
  color: var(--md-ink-2);
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1;
  cursor: pointer;
  transition:
    color var(--md-dur-hover) ease,
    border-color var(--md-dur-hover) ease;
}

.md-seqbtn:hover:not(:disabled) {
  color: var(--md-orange-dark);
  border-color: var(--md-orange-dark);
}

.md-seqbtn:disabled {
  cursor: default;
  opacity: 0.5;
}

/* EL-124 示例行。凹槽规格与 P1 的「当场演示」(.md-adv__demo) **完全同构**，
   刻意不新造样式：凹槽底 bg-sunken、圆角 radius-input、槽内 code 提亮回 bg-card。 */
.md-rulepanel__demo {
  display: flex;
  flex-direction: column;
  gap: var(--md-space-1);
  padding: var(--md-space-2) var(--md-space-3);
  border-radius: var(--md-radius-input);
  background: var(--md-bg-sunken);
}

.md-rulepanel__demotitle {
  margin: 0;
  font-size: 12px;
  color: var(--md-ink-3);
}

.md-rulepanel__demoline {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 12.5px;
}

.md-rulepanel__demodot {
  color: var(--md-ink-4);
}

.md-rulepanel__demo code {
  background: var(--md-bg-card);
}

/* ★ 选择器**刻意写成两级**（`code.md-rulepanel__demonew`）。
   `.md-rulepanel__demo code` 的特异性是 (0,1,1)，单写 `.md-rulepanel__demonew`
   只有 (0,1,0) —— 会被上面那条盖掉，橘色高亮底根本不生效。
   （P1 的「当场演示」就有这个现象；那是既有界面，本批不动，只保证**新的这一处**是对的。）*/
.md-rulepanel__demo code.md-rulepanel__demonew {
  color: var(--md-orange-dark);
  background: var(--md-highlight-bg);
}
/* ── P3-3：属性组（零新增令牌 / 零新增色值，全部用既有变量）───── */

.md-attr__vars {
  display: flex;
  align-items: flex-start;
  gap: var(--md-space-3);
}

.md-attr__label {
  flex: none;
  font-size: 12.5px;
  line-height: var(--md-ctrl-h);
  color: var(--md-ink-2);
}

.md-attr__list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--md-space-2);
}

.md-attr__var {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid var(--md-line);
  border-radius: var(--md-radius-badge);
  background: var(--md-bg-card);
  font-size: 12.5px;
  color: var(--md-ink-2);
  cursor: pointer;
}

.md-attr__var:hover {
  border-color: var(--md-orange-dark);
  color: var(--md-orange-dark);
}

.md-attr__token {
  padding: 0 4px;
  border-radius: var(--md-radius-badge);
  background: var(--md-bg-sunken);
  font-family: var(--md-font-num);
}


/* ── P3-4 · EL-134 名字来源提示条 ─────────────────────────────────────
   与 P2-B 模板条同一处逻辑：**常显、不进折叠**。因为「被导入的项不再受规则影响」
   这件事不说明，就是一个「界面无异常但行为不对」的迷局（设计 §2.3）。 */
.md-srcbar {
  display: flex;
  align-items: center;
  gap: var(--md-space-3);
  padding: var(--md-space-2) var(--md-space-3);
  background: var(--md-bg-warm);
  border-radius: var(--md-radius-input);
}

.md-srcbar__text {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12.5px;
  line-height: 18px;
  color: var(--md-ink-2);
}

.md-srcbar__btn {
  flex: none;
  border: none;
  background: none;
  padding: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--md-orange-dark);
  cursor: pointer;
}

</style>
