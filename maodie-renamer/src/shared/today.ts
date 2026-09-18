/**
 * 「本机今天」的 `YYYY-MM-DD`（**本地时区**）。
 *
 * 为什么不能用 `new Date().toISOString().slice(0, 10)`：那个取的是 **UTC** 日期，
 * 在东八区每天早上 8 点之前它给的是**昨天**。改名的「执行当天」取错一天，
 * 是一整批文件全错，而且用户当场很难发现。
 *
 * ⚠️ 分工要划清：**规则引擎不许读时钟**（ADR-001 / DEC-03），日期一律由调用方
 *    作为参数传进去 —— 所以 `rule-engine.ts` 里没有、也不该有对它的 import。
 *    这个函数只服务于「界面填默认值」这一种场景。
 */
export function todayYmd(d: Date = new Date()): string {
  const p = (v: number): string => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
