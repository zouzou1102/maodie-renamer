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
/**
 * 毫秒时间戳 → `YYYY-MM-DD`（**本地时区**）。
 *
 * ★ P3-3（第 3 批）新增：文件属性（创建 / 修改）的日期就走这里。
 *
 * 为什么不能写 `new Date(ms).toISOString().slice(0, 10)`：那个取的是 **UTC**。
 * 东八区**凌晨 0:00–8:00** 创建的文件会算成**前一天** ——
 * 而批量改名的日期一旦差一天，是**整批文件都错**，且只在凌晨创建的文件上出现。
 *
 * 说明：设计 §5.⑤ 要求把「今天」与「属性日期」的算法**共用一份**；
 * 而本文件**已经在 `shared/`**（P3-1 建的），所以直接在这里扩展，
 * 不另建一个 `date-ymd.ts` —— 少一个文件、也不用改任何既有 import。
 */
export function ymdFromMs(ms: number): string {
  // 非法输入不抛错：属性取不到时一律展开成空串（设计 §1.4）
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  return todayYmd(d)
}

/**
 * 「本机今天」的 `YYYY-MM-DD`（**本地时区**）。
 *
 * 为什么不能用 `new Date().toISOString().slice(0, 10)`：那个取的是 **UTC** 日期，
 * 在东八区每天早上 8 点之前它给的是**昨天**。改名的「执行当天」取错一天，
 * 是一整批文件全错，而且用户当场很难发现。
 *
 * ⚠️ 分工要划清：**规则引擎不许读时钟**（ADR-001 / DEC-03），日期一律由调用方
 *    作为参数传进去 —— 所以 `rule-engine.ts` 里没有、也不该有对它的 import。
 *    这个函数只服务于「界面填默认值」与「入列时读属性」两种场景。
 */
export function todayYmd(d: Date = new Date()): string {
  const p = (v: number): string => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
