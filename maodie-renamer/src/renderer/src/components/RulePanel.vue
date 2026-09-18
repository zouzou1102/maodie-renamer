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
import { computed, ref } from 'vue'
import MdIcon from './MdIcon.vue'
import { useRuleStore } from '../stores/rule'
import { useFilesStore } from '../stores/files'
import { CASE_TRANSFORM_OPTIONS } from '@shared/labels'
import { REGEX_CHEATSHEET, REGEX_DEMO_FILE } from '@shared/regex-cheatsheet'
import { RULE_TEMPLATES, templateAppliedMessage, type RuleTemplate } from '@shared/templates'
import { joinName, splitName } from '@shared/name-split'
import { applyDelete, applyReplace } from '@shared/rule-engine'
import type { CaseTransform, DateFormat, RuleMode, SeqPosition } from '@shared/types'

const rule = useRuleStore()
/** 套用模板后要给状态栏一句话，用既有的 3 秒轻提示位（不弹窗、不打断）*/
const files = useFilesStore()

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

const TABS: Array<{ mode: RuleMode; label: string }> = [
  { mode: 'delete', label: '删除字符' },
  { mode: 'replace', label: '替换字符' },
  { mode: 'rule', label: '规则化' },
]

const isRuleMode = computed(() => rule.rule.mode === 'rule')

/**
 * F-10 / F-11 的「进阶设置」折叠区。
 * 展开 / 收起是**纯 UI 状态**，不进 RuleConfig、不进 IPC（设计 §10.1）。
 */
const advancedOpen = ref(false)
/** 正则开关只在删除 / 替换模式出现 —— 与「区分大小写」沿用同一条规则（规则化不涉及匹配）*/
const regexOn = computed(() => !isRuleMode.value && rule.rule.regexEnabled)
/** 已启用的进阶项数量（折起态也要能看出「开了东西」）*/
const advancedCount = computed(
  () => (regexOn.value ? 1 : 0) + (rule.rule.caseTransform !== 'none' ? 1 : 0),
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

function setNumber(key: 'seqStart' | 'seqStep' | 'seqPad', raw: string): void {
  const n = Number(raw)
  rule.patchInner({ [key]: Number.isFinite(n) ? n : 0 } as Partial<typeof rule.rule.rule>)
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

      <!-- ── 规则化模式（五个要素可叠加）── -->
      <template v-else>
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

        <p class="md-hint md-rulepanel__varhint">
          支持变量 <code>{n}</code> 序号、<code>{d}</code> 日期 —— 变量需先勾选下方对应开关
        </p>

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

          <div class="md-rulepanel__nums">
            <label class="md-rulepanel__numitem">
              <span>起始</span>
              <input
                class="md-input md-input--num"
                type="number"
                min="0"
                :disabled="!rule.rule.rule.seqEnabled"
                :value="rule.rule.rule.seqStart"
                @input="setNumber('seqStart', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label class="md-rulepanel__numitem">
              <span>步长</span>
              <input
                class="md-input md-input--num"
                type="number"
                min="1"
                :disabled="!rule.rule.rule.seqEnabled"
                :value="rule.rule.rule.seqStep"
                @input="setNumber('seqStep', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label class="md-rulepanel__numitem">
              <span>补零</span>
              <input
                class="md-input md-input--num"
                type="number"
                min="0"
                max="6"
                :disabled="!rule.rule.rule.seqEnabled"
                :value="rule.rule.rule.seqPad"
                @input="setNumber('seqPad', ($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>

          <label class="md-rulepanel__picker">
            <span>序号位置</span>
            <select
              class="md-select"
              :disabled="!rule.rule.rule.seqEnabled"
              :value="rule.rule.rule.seqPosition"
              @change="rule.patchInner({ seqPosition: ($event.target as HTMLSelectElement).value as SeqPosition })"
            >
              <option value="suffix">排在最后</option>
              <option value="prefix">排在最前</option>
            </select>
          </label>
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
              :disabled="!rule.rule.rule.dateEnabled"
              :value="rule.rule.rule.dateFormat"
              @change="rule.patchInner({ dateFormat: ($event.target as HTMLSelectElement).value as DateFormat })"
            >
              <option value="YYYY-MM-DD">2026-09-11</option>
              <option value="YYYYMMDD">20260911</option>
              <option value="YYYY年MM月DD日">2026年09月11日</option>
            </select>
          </label>
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

      <!-- EL-044 区分大小写：规则化模式下不出现（该模式不涉及匹配）-->
      <label v-if="!isRuleMode" class="md-check md-rulepanel__span">
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
    <div class="md-adv">
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
        <template v-if="!isRuleMode">
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
</style>
