<script setup lang="ts">
/**
 * SCR-07 设置弹窗（P2-A · 设计确认 §3）。
 *
 * 只放三项：主题 / 音效 / 减少动画。**即改即生效**，所以底部只有一个「完成」，
 * 点它即关闭（不刷新、不跳转、不二次确认），与点遮罩、按 Esc 三者等价。
 *
 * 两点刻意为之：
 *  · 「二次确认阈值」不暴露 —— PRD 从头到尾没要求过这个旋钮，它是内部常量。
 *    按 YAGNI 不做，顺带避免给非技术用户多一个看不懂的开关。
 *  · 主题三选一**复用页签的视觉**（`.md-tabs` / `.md-tab`），零新视觉；
 *    ARIA 用的是「单选按钮组」而不是 `role="tablist"` —— 这里真的是一次三选一，
 *    底下没有可切换的内容面板，用 tab 语义会承诺一个不存在的面板关系。
 *
 * 顺带补上一个 P0 遗留缺口：交互说明 §9 与设计规范 §8 都要求「设置中提供
 * 『减少动画』开关」，但此前界面上根本没有设置入口 —— 开关写好了、也能生效，
 * 用户却打不开。这个弹窗把它补上了。
 */
import { onMounted, ref, computed, watch } from 'vue'
import AppModal from './AppModal.vue'
import { THEME_OPTIONS } from '@shared/labels'
import type { AppInfo } from '@shared/types'
import type { Theme } from '@shared/theme'
import { usePrefsStore } from '../stores/prefs'
import { useTaskStore } from '../stores/task'

const prefs = usePrefsStore()
const task = useTaskStore()

function setTheme(t: Theme): void {
  void prefs.patch({ theme: t })
}

/* ── P2-C · EL-114 ~ EL-116 命令行入口 ────────────────────────────────
 * 折起 / 展开是**纯 UI 状态**，不写任何偏好（IX-102）。
 * 「复制程序路径」解决的是进阶用户最大的障碍 —— **不知道程序装在哪**
 * （Electron 默认装在用户目录深处）。这一条比写一百行文档有用。 */
const appInfo = ref<AppInfo | null>(null)
const cliOpen = ref(false)

/**
 * ★ 关窗即归位：本组件是**常驻挂载**的（App.vue 里不带 v-if），
 * 所以 `cliOpen` 会一直活在内存里 —— 用户展开命令行、关掉设置、再打开，
 * 会看到它还是展开的。那是个**状态泄漏**，不是特性：
 * 「折起 / 展开」是临时 UI 状态（IX-102 明确不写偏好），
 * 重开时就该回到设计稿画的那个默认样子。
 *
 * 踩到的教训：这条一开始没有，直到 P2-C 增量的冒烟用例发现
 * 「上一条用例展开过 → 下一条断言『默认折起』就会红」——
 * 也就是说这个泄漏**早就存在**，只是此前只有一个用例碰它，没暴露出来。
 */
watch(
  () => task.modal,
  (now) => {
    if (now !== 'settings') cliOpen.value = false
  },
)

onMounted(async () => {
  appInfo.value = await window.maodie.app.getInfo()
})

/** 只给一条示例命令（决策 4），并带上本机完整程序路径 */
const cliCommand = computed(() => {
  const exe = appInfo.value?.execPath ?? 'maodie.exe'
  return `${exe} --rename --dir "D:\\下载\\素材" --delete "广告" --yes`
})

/**
 * 复制到剪贴板。
 *
 * ★ 为什么不直接用 `navigator.clipboard.writeText` 就完事：
 *   它是**异步剪贴板 API**，Chromium 要求**文档处于聚焦状态**，否则抛
 *   `NotAllowedError`（DOMException）。实测在「窗口不抢焦点」的场景下必然失败
 *   （自动化冒烟就是这样起的窗口）。
 *   不接异常的话：界面既没提示、控制台又抛一个未处理异常 —— 正是本项目最忌讳的
 *   「用户点了没反应、界面却看不出异常」。
 *   所以：先试异步 API，失败就退回 `execCommand('copy')`（它对聚焦不敏感），
 *   两条都不行就**如实告诉用户复制没成功**，让他手动选中复制。
 *
 * ★ 为什么不用 IPC 走主进程剪贴板：设计明确「不加通道」（接口文档的通道数是冻结的，
 *   复制属于渲染层能力）。加一条通道只为一件事，代价与收益不成比例。
 */
async function copyToClipboard(text: string): Promise<boolean> {
  if (text === '') return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 退回旧接口：需要先选中一段文本才能复制
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

async function copyText(text: string, what: string): Promise<void> {
  const ok = await copyToClipboard(text)
  // 成功/失败都要说话 —— 不静默
  task.setStatusOverride(ok ? `${what}已复制` : `${what}没复制上，请手动选中后按 Ctrl+C`)
}
</script>

<template>
  <AppModal
    v-if="task.modal === 'settings'"
    title="设置"
    :width="480"
    foot="spread"
    @close="task.closeModal()"
  >
    <div class="md-settings">
      <!-- EL-108 主题三选一（默认「始终浅色」，见设计确认 §14 第 4 条）-->
      <div class="md-settings__row">
        <span id="md-settings-theme-label" class="md-settings__label">主题</span>
        <div class="md-tabs md-settings__seg" role="group" aria-labelledby="md-settings-theme-label">
          <button
            v-for="o in THEME_OPTIONS"
            :key="o.value"
            type="button"
            class="md-tab"
            :class="{ 'md-tab--active': prefs.prefs.theme === o.value }"
            :aria-pressed="prefs.prefs.theme === o.value"
            @click="setTheme(o.value)"
          >
            {{ o.label }}
          </button>
        </div>
      </div>
      <p class="md-hint">「跟随系统」会跟着 Windows 的深浅色自动切换。</p>

      <!-- EL-109 音效 -->
      <div class="md-settings__row">
        <span class="md-settings__label">音效</span>
        <label class="md-switch md-settings__switch--sound">
          <input
            type="checkbox"
            aria-label="音效"
            :checked="prefs.prefs.soundEnabled"
            @change="prefs.patch({ soundEnabled: ($event.target as HTMLInputElement).checked })"
          />
          <span class="md-switch__track"><span class="md-switch__thumb" /></span>
        </label>
      </div>

      <!-- EL-110 减少动画（无障碍）-->
      <div class="md-settings__row">
        <span class="md-settings__label">减少动画</span>
        <label class="md-switch md-settings__switch--motion">
          <input
            type="checkbox"
            aria-label="减少动画"
            :checked="prefs.prefs.reduceMotion"
            @change="prefs.patch({ reduceMotion: ($event.target as HTMLInputElement).checked })"
          />
          <span class="md-switch__track"><span class="md-switch__thumb" /></span>
        </label>
      </div>
      <p class="md-hint">开启后猫咪状态切换只换表情、不做位移，动效时长归零。</p>

      <!-- EL-114 命令行（P2-C）。折叠行：标签 + 右侧箭头；折起 / 展开是纯 UI 状态 -->
      <div class="md-settings__row">
        <button
          class="md-cli__bar"
          :aria-expanded="cliOpen"
          @click="cliOpen = !cliOpen"
        >
          <span class="md-settings__label">命令行</span>
          <span class="md-cli__caret" :class="{ 'md-cli__caret--open': cliOpen }" aria-hidden="true" />
        </button>
      </div>

      <!-- EL-115 说明 + 代码块；EL-116 复制按钮组；EL-117 教程入口（P2-C 增量）-->
      <div v-if="cliOpen" class="md-cli__body">
        <!-- EL-117 引导卡：一句话 + 「查看教程」
             ★ 为什么要这一段：原来这里开篇就是「给进阶用户用脚本批量改名」，
               然后直接甩一屏参数。小白读到「进阶用户」四个字就退了，
               而**看懂命令行恰恰是最需要人扶一把的地方**。
               所以这里只说「什么场景下你会需要它」，具体怎么操作交给教程弹窗。 -->
        <div class="md-cli__lead" data-cli-lead>
          <p class="md-cli__lead-text">
            要让别的程序（或定时任务）自动帮你改名时用得上。没接触过命令行也没关系，有图文教程。
          </p>
          <button class="md-btn md-btn--secondary" data-cli-guide-btn @click="task.openCliGuide()">
            查看教程
          </button>
        </div>

        <p class="md-cli__desc">在命令行窗口（或 .bat 文件）里跑下面这条：</p>
        <p class="md-cli__code">{{ cliCommand }}</p>
        <div class="md-cli__btns">
          <button class="md-btn md-btn--secondary" @click="copyText(cliCommand, '命令')">复制命令</button>
          <button
            class="md-btn md-btn--secondary"
            @click="copyText(appInfo?.execPath ?? '', '程序路径')"
          >
            复制程序路径
          </button>
        </div>
        <p class="md-cli__hint">
          「复制命令」会自动带上你机器上的完整程序路径。默认只打印将要做的改动，
          加 <code>--yes</code> 才真正改名。
        </p>
      </div>
    </div>

    <template #foot>
      <span class="md-hint">设置立即生效，不需要重启。</span>
      <button class="md-btn md-btn--primary" @click="task.closeModal()">完成</button>
    </template>
  </AppModal>
</template>

<style scoped>
.md-settings {
  display: flex;
  flex-direction: column;
  gap: var(--md-space-3);
}

.md-settings__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--md-space-3);
  min-height: var(--md-ctrl-h);
}

.md-settings__label {
  font-size: 14px;
  font-weight: 600;
  color: var(--md-ink-1);
}

/* 三选一的宽度：三项等分（288 = 4px 台阶上的值，不用随手数）*/
.md-settings__seg {
  width: 288px;
}

/* <p> 的浏览器默认外边距在这套纵向节奏里会多出一截 */
.md-hint {
  margin: 0;
}

/* ── P2-C · 命令行入口（EL-114 ~ EL-116，设计 §3.2）──────────────────── */

.md-cli__bar {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--md-ink-1);
}

.md-cli__caret {
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 5px solid currentColor;
  transition: transform var(--md-dur-hover) var(--md-ease-pop);
}

.md-cli__caret--open {
  transform: rotate(180deg);
}

.md-cli__body {
  display: flex;
  flex-direction: column;
  gap: var(--md-space-2);  padding: 12px;
  border-radius: 10px;
  background: var(--md-bg-warm);
}

.md-cli__desc {
  margin: 0;
  font-size: 12px;
  color: var(--md-ink-2);
}

/* 命令可能很长：**横向滚动、不换行**，否则会被折成两行看不清 */
.md-cli__code {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--md-bg-sunken);
  font-family: var(--md-font-num);
  font-size: 11.5px;
  font-weight: 500;
  color: var(--md-ink-1);
  overflow-x: auto;
  white-space: nowrap;
}

.md-cli__btns {
  display: flex;
  gap: var(--md-space-2);
}

.md-cli__hint {
  margin: 0;
  font-size: 11.5px;
  line-height: 18px;
  color: var(--md-ink-4);
}

.md-cli__hint code {
  font-family: var(--md-font-num);
}
</style>
