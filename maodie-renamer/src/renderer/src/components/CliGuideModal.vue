<script setup lang="ts">
/**
 * 命令行教程弹窗（P2-C 增量 · SCR-08）。
 *
 * ══ 为什么当初要单独做一个弹窗，而不是塞进设置里 ═══════════════════════
 *
 * 设置弹窗宽 480px，命令行展开区本来就已经有「说明 + 代码块 + 两个按钮 + 小字」。
 * 再往里塞三张「左图右字」的步骤卡，每张卡的图会被压到 100px 出头 ——
 * 那张模拟命令行的示意图会糊成一团，小白反而更看不懂。
 *
 * 所以：**设置里只放一句引导 + 一个按钮**（EL-117），点开进这个弹窗（EL-118~）。
 * 空间宽松了，图能画清楚，字能写完整。
 *
 * ══ 三张图的分工（不是随便凑的三步）═══════════════════════════════════
 *
 * 小白卡在命令行上，卡的从来不是「命令写错了」，而是这三个：
 *  ① **不知道命令行在哪** —— 所以第一步画键盘 + 运行框
 *  ② **不知道命令里哪一段要换** —— 所以第二步把命令拆成四段、标出要改的两段
 *  ③ **怕一跑就把文件改坏** —— 所以第三步专门讲「先不加 --yes 只预览」
 *
 * 第③步尤其重要：这个产品从头到尾的原则是「绝不毁数据」，命令行默认只读
 * 就是把这条原则延伸到了没有预览界面的地方（接口文档 §10）。
 * 教程如果不讲这个，等于教人盲改 —— 那是把产品的立身之本教丢了。
 *
 * ══ 为什么用标签页而不是一屏滚到底 ═════════════════════════════════════
 *
 * 三张卡竖排 + 图，总高会超过 600px，弹窗要么变很高、要么内部滚动。
 * 用页签则是「一次只看一步」，看完点下一步 —— 与小白「一步一步来」的
 * 认知方式一致，也复用了现有的 `.md-tabs` 视觉（零新视觉）。
 */
import { ref, watch } from 'vue'
import AppModal from './AppModal.vue'
import { CLI_GUIDE_INTRO, CLI_GUIDE_STEPS } from '../../../shared/cli-guide'
import { useTaskStore } from '../stores/task'

const task = useTaskStore()
const step = ref(0)

function gotoStep(i: number): void {
  step.value = i
}

/**
 * ★ 关窗即归位：本组件与设置弹窗一样是**常驻挂载**的（App.vue 里不带 v-if），
 * 所以 `step` 会一直活在内存里 —— 用户翻到第 3 步、关掉、下次再打开，
 * 会直接停在第 3 步。那是个状态泄漏：教程是「从头学一遍」的东西，
 * 重开就该回到第一步。
 *
 * 同一个坑在 SettingsModal 的 cliOpen 上也踩过一次（那次是冒烟用例
 * 「上一条展开过 → 下一条断言『默认折起』就红」暴露的）。
 * 教训：**常驻挂载的组件里，任何「临时 UI 状态」都要在关闭时归位。**
 */
watch(
  () => task.modal,
  (now) => {
    if (now !== 'cliGuide') step.value = 0
  },
)
</script>

<template>
  <AppModal
    v-if="task.modal === 'cliGuide'"
    title="命令行怎么用"
    :width="560"
    foot="spread"
    @close="task.closeModal()"
  >
    <p class="md-guide__intro">{{ CLI_GUIDE_INTRO }}</p>

    <!-- EL-119 步骤页签：一次只看一步 -->
    <div class="md-tabs md-guide__tabs" role="group" aria-label="教程步骤">
      <button
        v-for="(s, i) in CLI_GUIDE_STEPS"
        :key="s.title"
        type="button"
        class="md-tab"
        :class="{ 'md-tab--active': step === i }"
        :aria-pressed="step === i"
        @click="gotoStep(i)"
      >
        {{ i + 1 }}
      </button>
    </div>

    <!-- EL-118 步骤卡：左图右字 -->
    <div class="md-guide__card" data-guide-card>
      <div class="md-guide__art" v-html="CLI_GUIDE_STEPS[step].svg" />
      <div class="md-guide__text">
        <h3 class="md-guide__title" data-guide-title>{{ CLI_GUIDE_STEPS[step].title }}</h3>
        <p class="md-guide__body" data-guide-body>{{ CLI_GUIDE_STEPS[step].body }}</p>
      </div>
    </div>

    <template #foot>
      <span class="md-hint">
        第 {{ step + 1 }} / {{ CLI_GUIDE_STEPS.length }} 步
      </span>
      <button
        v-if="step < CLI_GUIDE_STEPS.length - 1"
        class="md-btn md-btn--primary"
        data-guide-next
        @click="gotoStep(step + 1)"
      >
        下一步
      </button>
      <button v-else class="md-btn md-btn--primary" @click="task.closeModal()">知道了</button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ── P2-C 增量 · 教程弹窗（EL-118 / EL-119）────────────────────────────
 * 色值一律走令牌（TC-32）。图里的「命令行窗口」颜色不在这里 ——
 * 那由 shared/cli-guide.ts 里的 CLI_DEMO_COLORS 提供，刻意不随主题翻。 */

.md-guide__intro {
  margin: 0 0 var(--md-space-3);
  font-size: 12.5px;
  line-height: 20px;
  color: var(--md-ink-2);
}

.md-guide__tabs {
  width: fit-content;
  margin-bottom: var(--md-space-3);
}

.md-guide__card {
  display: flex;
  gap: var(--md-space-4);
  align-items: flex-start;
  padding: var(--md-space-4);
  border: 1px solid var(--md-line);
  border-radius: var(--md-radius-input);
  background: var(--md-bg-warm);
}

/* 图固定宽度：三张图 viewBox 都是 240×150，同宽才不会有跳变感 */
.md-guide__art {
  flex: 0 0 200px;
  width: 200px;
  line-height: 0;
}

.md-guide__art :deep(svg) {
  display: block;
  width: 100%;
  height: auto;
}

.md-guide__text {
  flex: 1 1 auto;
  min-width: 0;
}

.md-guide__title {
  margin: 0 0 var(--md-space-2);
  font-size: 13.5px;
  font-weight: 600;
  color: var(--md-ink-1);
}

.md-guide__body {
  margin: 0;
  font-size: 12.5px;
  line-height: 21px;
  color: var(--md-ink-2);
}
</style>
