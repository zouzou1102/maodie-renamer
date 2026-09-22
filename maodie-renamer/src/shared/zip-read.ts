/**
 * 最小 ZIP 读取器 —— 与 `zip-write.ts` **配对**（一个写、一个读）。P3-4 / 第 4 批。
 *
 * ── 为什么读这边**必须**支持 deflate，写那边却只做 store ────────────────
 * P3-2 我们**写** xlsx/docx 时只用 `store`（不压缩）：内容是自己生成的几 KB
 * 纯文本，压缩省不了多少，却会多出一条最容易写错的路径（见 `zip-write.ts` 头注）。
 * 但**别人生成**的 xlsx **一定是 deflate 压的** —— 而本批要读的正是别人的表。
 * 所以读这边不能用「反正我们自己写的都是 store」糊过去（设计 §7.3 第 1 条）。
 *
 * ── 为什么 deflate 是「注入」进来的，而不是 `import 'node:zlib'` ────────
 * `shared/` 的纯净（不 import node:*）是「预览 ≡ 执行」的地基，也是单测能
 * `node --test` 直接跑、渲染层能安全 import 的前提 —— 渲染层里根本没有
 * `node:zlib`。于是把解压函数做成**参数**：主进程传 `zlib.inflateRawSync`，
 * 单测传同一份实现（或自造的桩）。
 * **协议与结构解析全在本文件里，压缩库只是一把螺丝刀。**
 *
 * ── 为什么顺手校验 CRC32 与原始长度 ───────────────────────────────────
 * 「容器声明与实际内容不一致」在这个项目里已经踩过一次（P3-2 的
 * `[Content_Types].xml` 漏声明 → Word 报「文件已损坏」而单测全绿）。
 * 读方向上对应的形态是**静默读出错误的内容** —— 名字错位、索引数字当文件名，
 * 而界面上「看着挺整齐」。CRC32 是 ZIP 自带的、零成本的一致性判据，
 * 用它把「文件在传输/保存过程中坏了」这类问题挡在读表之前。
 *
 * ── 契约 ─────────────────────────────────────────────────────────────
 * 纯函数、零 IO、不 import 任何 `node:*`；出错一律抛 `MdError`，
 * 错误码固定是 `E_TABLE_UNREADABLE`（EX-18）—— 让调用方只做一次映射。
 */

import { MD_ERROR, MdError } from './errors'
import { crc32 } from './zip-write'

/** 解压函数（deflate 那一路用），由调用方注入 */
export type InflateRaw = (data: Uint8Array) => Uint8Array

export interface ZipReadOptions {
  /** `compressionMethod === 8`（deflate）时用来解压；不传就**明确报错**，绝不静默返回空 */
  inflate?: InflateRaw
}

/* ── 结构与常量（与 `zip-write.ts` 同一套定义）────────────────────────── */

/** 本地文件头签名 `PK\x03\x04` */
const SIG_LOCAL = 0x04034b50
/** 中央目录头签名 `PK\x01\x02` */
const SIG_CENTRAL = 0x02014b50
/** 中央目录结束记录签名 `PK\x05\x06` */
const SIG_EOCD = 0x06054b50

const LOCAL_HEADER_SIZE = 30
const CENTRAL_HEADER_SIZE = 46
const EOCD_SIZE = 22

/** 通用标志位第 0 位 = 加密 */
const FLAG_ENCRYPTED = 0x1

const METHOD_STORE = 0
const METHOD_DEFLATE = 8

/** EOCD 结尾可能跟着一段注释，最长 65535 字节 —— 倒查范围的上界 */
const MAX_COMMENT = 0xffff

const ZIP64_SENTINEL_16 = 0xffff
const ZIP64_SENTINEL_32 = 0xffffffff

function unreadable(detail: string): MdError {
  return new MdError(MD_ERROR.E_TABLE_UNREADABLE, detail)
}

function u16(dv: DataView, off: number): number {
  return dv.getUint16(off, true)
}

function u32(dv: DataView, off: number): number {
  return dv.getUint32(off, true)
}

/** ZIP 内部路径一律按 UTF-8 解（我们自己写的都是 ASCII，别人的也可能是中文） */
export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}

/**
 * 从后往前找 EOCD（中央目录结束记录）。
 *
 * 之所以要「找」而不是直接读最后 22 字节：EOCD 后面**允许跟一段注释**，
 * 所以它的位置是不定的。注释最长 65535，因此倒查范围有上界。
 */
function findEocd(dv: DataView, len: number): number {
  const lowest = Math.max(0, len - EOCD_SIZE - MAX_COMMENT)
  for (let i = len - EOCD_SIZE; i >= lowest; i--) {
    if (u32(dv, i) === SIG_EOCD) return i
  }
  return -1
}

/**
 * 解出一个 ZIP 里的全部条目。
 *
 * 返回 `Map<内部路径, 原始字节>`（路径形如 `xl/worksheets/sheet1.xml`）。
 * 顺序**保持中央目录里的顺序** —— `Map` 保证插入序，而 xlsx 的第一张工作表
 * 就靠这个顺序（图省事时可以只看第一个 `worksheets/*.xml`）。
 */
export function zipRead(bytes: Uint8Array, options: ZipReadOptions = {}): Map<string, Uint8Array> {
  if (bytes.length < EOCD_SIZE) throw unreadable('文件太小了，不是 ZIP')

  // ⚠️ 用 byteOffset / byteLength 显式建视图：入参可能是别人 buffer 的一段切片，
  //    直接 `new DataView(bytes.buffer)` 会从整个 buffer 的 0 开始读 → 全部错位。
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  const eocd = findEocd(dv, bytes.length)
  if (eocd < 0) throw unreadable('找不到 ZIP 的中央目录结尾（文件不是 ZIP，或已损坏）')

  const count = u16(dv, eocd + 10)
  const cdSize = u32(dv, eocd + 12)
  const cdOff = u32(dv, eocd + 16)

  // ZIP64 用的是 0xffff / 0xffffffff 占位 + 一张扩展记录。本批的表不会到 4GB，
  // 与其写一段没人验过的 ZIP64 代码，不如**明确拒绝**。
  if (count === ZIP64_SENTINEL_16 || cdSize === ZIP64_SENTINEL_32 || cdOff === ZIP64_SENTINEL_32) {
    throw unreadable('这是 ZIP64 格式的包，暂不支持')
  }
  if (cdOff + cdSize > bytes.length) throw unreadable('中央目录越界（文件被截断？）')

  const out = new Map<string, Uint8Array>()
  let pos = cdOff

  for (let i = 0; i < count; i++) {
    if (pos + CENTRAL_HEADER_SIZE > bytes.length) throw unreadable('中央目录不完整')
    if (u32(dv, pos) !== SIG_CENTRAL) throw unreadable(`中央目录第 ${i + 1} 条损坏`)

    const flags = u16(dv, pos + 8)
    const method = u16(dv, pos + 10)
    const crc = u32(dv, pos + 16)
    const compSize = u32(dv, pos + 20)
    const rawSize = u32(dv, pos + 24)
    const nameLen = u16(dv, pos + 28)
    const extraLen = u16(dv, pos + 30)
    const commentLen = u16(dv, pos + 32)
    const localOff = u32(dv, pos + 42)

    const nameStart = pos + CENTRAL_HEADER_SIZE
    if (nameStart + nameLen > bytes.length) throw unreadable('中央目录里的文件名越界')
    const name = decodeUtf8(bytes.subarray(nameStart, nameStart + nameLen))

    if ((flags & FLAG_ENCRYPTED) !== 0) {
      throw unreadable(`包里的「${name}」是加密的`)
    }

    // 本地头里的长度字段可能与中央目录不同（有扩展字段），所以**以本地头的
    // nameLen / extraLen 为准**去算数据的起点 —— 这是读 ZIP 最常见的错位来源。
    if (localOff + LOCAL_HEADER_SIZE > bytes.length) throw unreadable('本地文件头越界')
    if (u32(dv, localOff) !== SIG_LOCAL) throw unreadable(`「${name}」的本地文件头损坏`)
    const lNameLen = u16(dv, localOff + 26)
    const lExtraLen = u16(dv, localOff + 28)
    const dataStart = localOff + LOCAL_HEADER_SIZE + lNameLen + lExtraLen
    if (dataStart + compSize > bytes.length) throw unreadable('条目数据越界（文件被截断？）')

    const raw = bytes.subarray(dataStart, dataStart + compSize)

    let data: Uint8Array
    if (method === METHOD_STORE) {
      data = raw
    } else if (method === METHOD_DEFLATE) {
      if (!options.inflate) {
        throw unreadable(`「${name}」是 deflate 压缩的，但这次没有提供解压函数`)
      }
      try {
        data = options.inflate(raw)
      } catch (err) {
        throw unreadable(`解压「${name}」失败（${err instanceof Error ? err.message : String(err)}）`)
      }
    } else {
      throw unreadable(`「${name}」用了暂不支持的压缩方式（method=${method}）`)
    }

    if (data.length !== rawSize) {
      throw unreadable(`「${name}」解出来的长度与声明不符（声明 ${rawSize}，实际 ${data.length}）`)
    }
    if (crc32(data) !== crc) {
      throw unreadable(`「${name}」的数据校验没通过（内容与 ZIP 记录的对不上）`)
    }

    out.set(name, data)
    pos += CENTRAL_HEADER_SIZE + nameLen + extraLen + commentLen
  }

  return out
}

/** 取一个条目并按 UTF-8 解成文本；条目不存在返回 `null`（不抛错 —— 有些部件本来就是可选的） */
export function zipText(entries: Map<string, Uint8Array>, path: string): string | null {
  const bytes = entries.get(path)
  return bytes === undefined ? null : decodeUtf8(bytes)
}
