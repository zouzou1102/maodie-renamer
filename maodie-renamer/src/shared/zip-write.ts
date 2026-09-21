/**
 * 最小 ZIP 打包器 —— 只做 store（不压缩）。P3-2 / 第 2 批。
 *
 * ── 为什么自己写，不引第三方 ──────────────────────────────────────────
 * 本批要产出 `.xlsx` 与 `.docx`，两者的**容器层完全一样**（都是 ZIP）。
 * 为一个几 KB 的清单引一个压缩库，等于给「零运行时依赖」这条底线开个口子。
 *
 * ── 为什么只做 store、不做 deflate ───────────────────────────────────
 * 清单是几 KB 的纯文本，压缩省不了多少；而要把 deflate 结果正确塞进 ZIP，
 * 会多出一条**最容易写错**的路径：
 *   · `deflateRaw` 之后要分别记 compressed / uncompressed 两个长度；
 *   · **CRC32 必须算在「未压缩」数据上**（算错的话要到解压时才报错，
 *     而我们的单测只看结构，抓不到）。
 * ——**先做对，再谈小。**
 *
 * ── 契约 ─────────────────────────────────────────────────────────────
 * 纯函数、零 IO：输入「路径 + 文本」数组，输出字节。所以能直接 `node --test`。
 * ⚠️ 不 import electron / fs / path / zlib —— `shared/` 的纯净是「预览 ≡ 执行」的地基。
 */

const enc = new TextEncoder()

/* ── CRC32（ZIP 规范要求的标准多项式 0xEDB88320，反射式查表法）───────── */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/**
 * 标准 CRC32。
 *
 * ⚠️ 末尾用 `>>> 0` 而不是 `| 0`：`| 0` 会把 >0x7fffffff 的结果变成负数，
 * 而 ZIP 头里这个字段是无符号 32 位 —— 负值写进 DataView 会原样落成
 * 补码（数值恰好正确），但**单测里跟已知向量比对时就会「看着不等」**，
 * 白白浪费一轮排查。
 */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

/* ── ZIP 结构与常量 ─────────────────────────────────────────────────── */

/** 本地文件头签名 `PK\x03\x04` */
const SIG_LOCAL = 0x04034b50
/** 中央目录头签名 `PK\x01\x02` */
const SIG_CENTRAL = 0x02014b50
/** 中央目录结束记录签名 `PK\x05\x06` */
const SIG_EOCD = 0x06054b50

const LOCAL_HEADER_SIZE = 30
const CENTRAL_HEADER_SIZE = 46
const EOCD_SIZE = 22

/** 2.0 —— store 方式所需的最低版本，也是各打包器的通行写法 */
const VERSION = 20

/**
 * 固定时间戳：DOS 日期 `0x0021` = 1980-01-01，时间 0（DOS 时间的 0 点）。
 *
 * ★ 刻意**不用「当前时间」**：那样同样的输入会产出不同的字节，
 *   单测就没法对整段字节做断言、产物也不可复现。
 *   而清单文件本来就不需要真实时间戳（文件本身的时间由文件系统记）。
 */
const DOS_DATE = 0x0021
const DOS_TIME = 0

export interface ZipEntry {
  /**
   * ZIP 内部的路径，一律**正斜杠**，如 `xl/worksheets/sheet1.xml`。
   * 必须是 ASCII —— 所以不置「UTF-8 文件名」通用标志位（第 11 位），
   * 这样对老解压器的兼容面最大。
   */
  path: string
  /** 文本内容，按 UTF-8 编码后写入 */
  content: string
}

/**
 * 把若干文本条目打成一个 ZIP（store / 不压缩）。
 *
 * 布局：`[本地头 + 数据] × N` → `[中央目录头] × N` → `[EOCD]`
 * 所有多字节整数一律**小端**（ZIP 规范如此）。
 */
export function zipStore(entries: ZipEntry[]): Uint8Array {
  const prepared = entries.map((e) => {
    const name = enc.encode(e.path)
    const data = enc.encode(e.content)
    return { name, data, crc: crc32(data) }
  })

  let localTotal = 0
  let centralTotal = 0
  for (const p of prepared) {
    localTotal += LOCAL_HEADER_SIZE + p.name.length + p.data.length
    centralTotal += CENTRAL_HEADER_SIZE + p.name.length
  }

  const out = new Uint8Array(localTotal + centralTotal + EOCD_SIZE)
  const dv = new DataView(out.buffer)
  let off = 0

  /* ① 本地文件头 + 数据 */
  const localOffsets: number[] = []
  for (const p of prepared) {
    localOffsets.push(off)

    dv.setUint32(off, SIG_LOCAL, true)
    off += 4
    dv.setUint16(off, VERSION, true) // 解压所需版本
    off += 2
    dv.setUint16(off, 0, true) // 通用标志位：0 = 文件名是 ASCII、无加密
    off += 2
    dv.setUint16(off, 0, true) // 压缩方式：0 = store
    off += 2
    dv.setUint16(off, DOS_TIME, true)
    off += 2
    dv.setUint16(off, DOS_DATE, true)
    off += 2
    dv.setUint32(off, p.crc, true)
    off += 4
    dv.setUint32(off, p.data.length, true) // 压缩后大小（store 时两者相等）
    off += 4
    dv.setUint32(off, p.data.length, true) // 原始大小
    off += 4
    dv.setUint16(off, p.name.length, true)
    off += 2
    dv.setUint16(off, 0, true) // 扩展字段长度
    off += 2

    out.set(p.name, off)
    off += p.name.length
    out.set(p.data, off)
    off += p.data.length
  }

  /* ② 中央目录头（每条要在本地头前面，所以先记下偏移） */
  const centralStart = off
  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i]

    dv.setUint32(off, SIG_CENTRAL, true)
    off += 4
    dv.setUint16(off, VERSION, true) // version made by
    off += 2
    dv.setUint16(off, VERSION, true) // version needed
    off += 2
    dv.setUint16(off, 0, true) // 标志位
    off += 2
    dv.setUint16(off, 0, true) // 压缩方式
    off += 2
    dv.setUint16(off, DOS_TIME, true)
    off += 2
    dv.setUint16(off, DOS_DATE, true)
    off += 2
    dv.setUint32(off, p.crc, true)
    off += 4
    dv.setUint32(off, p.data.length, true)
    off += 4
    dv.setUint32(off, p.data.length, true)
    off += 4
    dv.setUint16(off, p.name.length, true)
    off += 2
    dv.setUint16(off, 0, true) // 扩展字段
    off += 2
    dv.setUint16(off, 0, true) // 注释
    off += 2
    dv.setUint16(off, 0, true) // 起始磁盘号
    off += 2
    dv.setUint16(off, 0, true) // 内部属性
    off += 2
    dv.setUint32(off, 0, true) // 外部属性
    off += 4
    dv.setUint32(off, localOffsets[i], true) // ★ 本地头在本文件中的偏移
    off += 4

    out.set(p.name, off)
    off += p.name.length
  }
  const centralSize = off - centralStart

  /* ③ 中央目录结束记录 */
  dv.setUint32(off, SIG_EOCD, true)
  off += 4
  dv.setUint16(off, 0, true) // 当前磁盘号
  off += 2
  dv.setUint16(off, 0, true) // 中央目录所在磁盘号
  off += 2
  dv.setUint16(off, prepared.length, true) // 本磁盘上的条目数
  off += 2
  dv.setUint16(off, prepared.length, true) // ★ 总条目数（单测要断言这个）
  off += 2
  dv.setUint32(off, centralSize, true)
  off += 4
  dv.setUint32(off, centralStart, true)
  off += 4
  dv.setUint16(off, 0, true) // 注释长度
  off += 2

  return out
}
