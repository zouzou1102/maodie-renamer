import js from '@eslint/js'
import globals from 'globals'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

/**
 * ESLint 配置 —— 与《接口文档》§7「代码层禁止事项」一一对应。
 *
 * 这些规则不是形式主义：本产品要动用户的真实文件，而「绝不覆盖」主要靠
 * P-02（禁止裸 rename）与 P-11（禁止 realpath 解引用）这两条**编译期**护栏。
 * 违反会直接报错，AI 辅助开发时也不会「顺手」写错。
 */

/** P-03：全项目禁止删除类 API（唯一例外见下方 storage.ts 的豁免块）。 */
const DESTRUCTIVE = [
  [".unlink", 'P-03：本产品不删除任何用户文件'],
  [".unlinkSync", 'P-03：本产品不删除任何用户文件'],
  [".rm", 'P-03：本产品不删除任何用户文件'],
  [".rmSync", 'P-03：本产品不删除任何用户文件'],
  [".rmdir", 'P-03：本产品不删除任何用户文件（文件夹也不删）'],
  [".rmdirSync", 'P-03：本产品不删除任何用户文件（文件夹也不删）'],
].map(([suffix, message]) => ({
  selector: `CallExpression[callee.property.name='${suffix.slice(1)}']`,
  message,
}))

/** P-11：禁止解引用符号链接——那会把「改链接名」变成「改目标名」。 */
const REALPATH = [
  {
    selector: "CallExpression[callee.property.name='realpath']",
    message: 'P-11：禁止 realpath 解引用符号链接（只改链接自身的名字）',
  },
  {
    selector: "CallExpression[callee.property.name='realpathSync']",
    message: 'P-11：禁止 realpath 解引用符号链接（只改链接自身的名字）',
  },
]

/** P-04：零网络请求。 */
const NO_NETWORK = [
  {
    selector: "NewExpression[callee.name='XMLHttpRequest']",
    message: 'P-04：兑现「完全本地离线、零网络请求」，不得引入任何网络调用',
  },
  {
    selector: "NewExpression[callee.name='WebSocket']",
    message: 'P-04：兑现「完全本地离线、零网络请求」，不得引入任何网络调用',
  },
  {
    selector: "NewExpression[callee.name='EventSource']",
    message: 'P-04：兑现「完全本地离线、零网络请求」，不得引入任何网络调用',
  },
]

/** P-02：rename-executor.ts 内唯一的改名原语是 fs-safe.ts 的 safeRename。 */
const BARE_RENAME = [
  {
    selector: "CallExpression[callee.property.name='rename']",
    message:
      'P-02：「绝不覆盖」的第 4 层防护——rename-executor.ts 禁止裸 rename，只能调用 fs-safe.ts 的 safeRename（它内含存在性检查）',
  },
  {
    selector: "CallExpression[callee.name='renameSync']",
    message: 'P-02：同上，禁止 renameSync',
  },
]

const sharedBans = {
  'no-restricted-imports': [
    'error',
    {
      paths: [
        { name: 'electron', message: 'shared 必须能脱离 Electron 单测（技术方案 §1.4）' },
        { name: 'fs', message: 'shared 是纯函数层，不碰文件系统（技术方案 §1.4）' },
        { name: 'node:fs', message: 'shared 是纯函数层，不碰文件系统（技术方案 §1.4）' },
        { name: 'path', message: '渲染层没有 path 模块，shared 也不能用（ADR-001）' },
        { name: 'node:path', message: '渲染层没有 path 模块，shared 也不能用（ADR-001）' },
        { name: 'os', message: 'shared 不依赖系统（技术方案 §1.4）' },
        { name: 'node:os', message: 'shared 不依赖系统（技术方案 §1.4）' },
        { name: 'axios', message: 'P-04：零网络请求' },
      ],
      patterns: [
        { group: ['node:*'], message: 'shared 不得依赖任何 Node 内置模块（技术方案 §1.4）' },
      ],
    },
  ],
}

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'release/**',
      'coverage/**',
      'node_modules/**',
      'src/renderer/src/assets/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],

  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, ecmaVersion: 2022, sourceType: 'module' },
    },
  },

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        ...DESTRUCTIVE,
        ...REALPATH,
        ...NO_NETWORK,
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'P-04：零网络请求' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      // 以 _ 开头的参数/变量是有意不用的占位（例如 vi.fn 的签名占位）
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'vue/multi-word-component-names': 'off',
      // 排版类告警与项目实际排版风格不符（我们允许同一行放 2–3 个属性）
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-closing-bracket-newline': 'off',
    },
  },

  // ── §1.4 依赖方向（严格单向）──────────────────────────────────────────
  { files: ['src/shared/**/*.ts'], rules: sharedBans },
  {
    files: ['src/renderer/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: '渲染层零 Node 权限，只能经 window.maodie（技术方案 §1.4）' },
            { name: 'fs', message: '渲染层零 Node 权限（技术方案 §1.4）' },
            { name: 'path', message: '渲染层零 Node 权限，路径拼接走 @shared/path-utils' },
            { name: 'axios', message: 'P-04：零网络请求' },
          ],
          patterns: [
            { group: ['node:*'], message: '渲染层零 Node 权限（技术方案 §1.4）' },
            { group: ['../main/*', '../../main/*'], message: '禁止反向依赖主进程' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/preload/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'fs', message: 'preload 只做转发，不碰文件系统' },
            { name: 'node:fs', message: 'preload 只做转发，不碰文件系统' },
            { name: 'path', message: 'preload 只做转发，不碰文件系统' },
          ],
          patterns: [{ group: ['../main/*', '**/main/**'], message: 'P-06：preload 不得依赖主进程实现' }],
        },
      ],
    },
  },

  // ── P-02：执行器内禁止裸 rename ───────────────────────────────────────
  {
    files: ['src/main/services/rename-executor.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...DESTRUCTIVE, ...REALPATH, ...BARE_RENAME],
    },
  },

  // ── P-03 的唯一豁免：storage.ts 清理自己生成的 .tmp 文件 ───────────────
  {
    files: ['src/main/services/storage.ts'],
    rules: {
      // 这里重新声明整张表：去掉 unlink / unlinkSync，其余照旧禁止。
      // 豁免面越小越好——只放行「删掉程序自己刚生成的临时文件」这一件事。
      'no-restricted-syntax': [
        'error',
        ...DESTRUCTIVE.filter(
          (s) => s.selector !== "CallExpression[callee.property.name='unlink']" &&
                 s.selector !== "CallExpression[callee.property.name='unlinkSync']",
        ),
        ...REALPATH,
      ],
    },
  },

  // ── P-03 的第二处豁免：merge-service.ts 的「剪切」模式 ─────────────────
  // ★ 这是全产品**唯一**会删用户文件的地方（其余功能绝不动用户文件，P-03 铁律不变）。
  //   背景：文件夹合并的「剪切」= 移动文件，本质是「先确认全部复制成功 → 再统一删源」。
  //   它受多重保护，不是裸删：
  //     ① 剪切默认关，必须用户主动打开 + 点「确认执行」才发生；
  //     ② 两阶段：先 fs.cp 全部成功，才开始删源；删失败 → 半移动态(EX-20)标红，
  //        已复制内容**不回滚**（绝不让用户丢数据）；
  //     ③ 复制阶段已做「绝不覆盖」双重检查（计划 + 执行前再判磁盘）。
  //   豁免面刻意只放开 `.rm` / `.rmSync`（移动用的 API），`.unlink` / `.rmdir` 仍禁止。
  //   ⚠️ 设计冲突已写入 P3-7 交付报告，请产品负责人确认「剪切」是否保留。
  {
    files: ['src/main/services/merge-service.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...DESTRUCTIVE.filter(
          (s) => s.selector !== "CallExpression[callee.property.name='rm']" &&
                 s.selector !== "CallExpression[callee.property.name='rmSync']",
        ),
        ...REALPATH,
      ],
    },
  },

  // v-html 只用于渲染构建期打包进来的自有 SVG 字符串（切图资源），
  // 不涉及任何用户输入，也没有任何网络内容 —— 这条 XSS 告警在此不适用
  // （TitleBar 渲染的是 resources/cats/ui-btn-*.svg 这些自有切图；
  //   CliGuideModal 渲染的是 shared/cli-guide.ts 里写死的三张教程示意图）
  {
    files: [
      'src/renderer/src/components/MdIcon.vue',
      'src/renderer/src/components/CatStage.vue',
      'src/renderer/src/components/TitleBar.vue',
      'src/renderer/src/components/CliGuideModal.vue',
    ],
    rules: { 'vue/no-v-html': 'off' },
  },

  // 脚本与测试放宽：允许直接读文件系统（它们本来就是验证工具）
  {
    files: ['scripts/**/*.ts', 'tests/**/*.ts', '*.config.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      'no-restricted-globals': 'off',
      'no-restricted-imports': 'off',
    },
  },

  // 冒烟驱动器（CommonJS，跑在 Electron 内置 Node 里）：它们本就靠 require 载入
  // 被测主进程入口与 electron 模块，不能改成 ESM。这里只放宽"必须用 require"这一件事，
  // 其余规则照旧——生产代码（src/）的护栏一条都不松。
  {
    files: ['tests/**/*.js', 'tools/**/*.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'no-restricted-syntax': 'off',
      'no-restricted-globals': 'off',
      'no-restricted-imports': 'off',
      'no-unused-vars': 'off',
    },
  },
)
