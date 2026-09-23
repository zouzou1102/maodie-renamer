/**
 * 路径工具 —— **自己实现，不用 node:path**。
 *
 * 为什么：shared 层必须能被渲染进程的 Worker import，而渲染层零 Node 权限
 * （ADR-001 / 技术方案 §1.4）。代价是这约 60 行代码；换来的是「预览与执行
 * 物理上共用同一份逻辑」。
 *
 * 约定：所有函数只做**字符串级**处理，不碰文件系统、不做 IO。
 * 绝对路径的规范化（`path.resolve`）由主进程负责——shared 不知道 cwd。
 */

/** 统一分隔符为反斜杠（Windows 绝对路径形式） */
export function normalizeSeparators(p: string): string {
  return p.replace(/\//g, '\\')
}

/** 去掉末尾分隔符；盘符根（`C:\`）与 UNC 根保留 */
export function stripTrailingSep(p: string): string {
  let out = p
  while (out.length > 1 && out.endsWith('\\')) {
    if (/^[A-Za-z]:\\$/.test(out)) break
    out = out.slice(0, -1)
  }
  return out
}

/** 取所在目录。无分隔符时返回空串 */
export function dirName(p: string): string {
  const s = stripTrailingSep(normalizeSeparators(p))
  const i = s.lastIndexOf('\\')
  if (i < 0) return ''
  if (i === 0) return '\\'
  const head = s.slice(0, i)
  // 'C:' → 'C:\'（盘符根必须带回分隔符，否则 'C:' 的语义是「盘符当前目录」）
  return /^[A-Za-z]:$/.test(head) ? `${head}\\` : head
}

/** 取文件名（最后一段） */
export function baseName(p: string): string {
  const s = stripTrailingSep(normalizeSeparators(p))
  const i = s.lastIndexOf('\\')
  return i < 0 ? s : s.slice(i + 1)
}

/**
 * ★ P3-6：取「文件夹名」—— 供 `{文件夹}` 变量用（设计 §3.2）。
 *
 * 直接复用 `baseName()`。唯一的例外是**裸盘符**（`D:`，没有分隔符）：
 * `baseName('D:')` 会得到 `'D:'`，而**冒号在 Windows 文件名里非法** → 这种形态返回空串。
 *
 * ⚠️ 而 `D:\`（**带分隔符**的盘符根，也就是 `dirName()` 真正会产出的那种形态）
 *    `baseName` **天然**就得到空串 —— 不需要额外处理（2026-09-23 实测）。
 */
export function folderNameOf(dirPath: string): string {
  const name = baseName(dirPath)
  return /^[A-Za-z]:$/.test(name) ? '' : name
}

/** 拼接「目录 + 名称」 */
export function joinPath(dir: string, name: string): string {
  const d = normalizeSeparators(dir)
  if (d === '') return name
  return d.endsWith('\\') ? d + name : `${d}\\${name}`
}

/**
 * 用于**比较 / 去重 / 做 Map 键**的归一化形式。
 *
 * 注意：这会把大小写一并抹平（Windows 文件系统不区分大小写）。
 * 因此**不要**用它生成要显示给用户或要落盘的路径。
 */
export function normalizeForCompare(p: string): string {
  return stripTrailingSep(normalizeSeparators(p)).toLowerCase()
}

/** 目录快照的键：目录路径的归一化形式 */
export const dirKey = normalizeForCompare

/** 判断是否 Windows 绝对路径（`C:\...` 或 `\\server\...`） */
export function isAbsoluteWinPath(p: string): boolean {
  const s = normalizeSeparators(p)
  return /^[A-Za-z]:\\/.test(s) || s.startsWith('\\\\')
}

/** 完整路径长度：目录字符数 + 1 个分隔符 + 名称字符数 */
export function fullPathLength(dirPath: string, name: string): number {
  return dirPath.length + 1 + name.length
}
