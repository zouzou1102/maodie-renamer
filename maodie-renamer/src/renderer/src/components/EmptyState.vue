<script setup lang="ts">
/**
 * EL-037 空状态引导（PRD §4.3 空状态）。
 *
 * 插画走 `resources/illustration` 的 @2x PNG —— 但它不出现在渲染层可访问的
 * 路径上（渲染层没有 fs）。这里用 CSS 画出等价的「引导卡」形态，
 * 并保留一句与需求一致的文案。
 *
 * 说明：本组件刻意不引插画文件，是为了不引入自注册协议 / 放宽 CSP 的复杂度；
 * 等真的要上插画时，把它作为 `assets/` 资源 import 进来即可（一行改动）。
 */
import MdIcon from './MdIcon.vue'
</script>

<template>
  <div class="md-empty">
    <div class="md-empty__art" aria-hidden="true">
      <span class="md-empty__blob" />
      <MdIcon name="folder" :size="16" />
    </div>
    <!-- ★ 施工单 §八：按钮搬进标题栏后，空态文案跟着改（规格书 §08 定死）-->
    <p class="md-empty__title">点左上角的「添加文件」，或者直接拖进来</p>
    <p class="md-empty__hint">支持文件和文件夹混着拖 · 单批最多 1 万个</p>
  </div>
</template>

<style scoped>
.md-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--md-space-2);
  padding: var(--md-space-6);
  text-align: center;
}

.md-empty__art {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  background: var(--md-bg-warm);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  margin-bottom: var(--md-space-2);
}

.md-empty__blob {
  position: absolute;
  inset: 12px;
  border-radius: 50%;
  background: var(--md-bg-sunken);
}

.md-empty__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--md-ink-2);
}

.md-empty__hint {
  margin: 0;
  font-size: 11.5px;
  color: var(--md-ink-4);
}
</style>
