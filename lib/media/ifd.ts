import { u16, u32 } from './bytes'

export type IfdCtx = { view: DataView; le: boolean; base: number }

export type ParsedIfd = { texts: Map<number, string>; numbers: Map<number, number[]>; nextIfd: number }

const TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }

export function readIfdValue(ctx: IfdCtx, type: number, count: number, valueOffset: number): { text: string; numbers?: number[] } | undefined {
  const { view, le, base } = ctx
  const size = TYPE_SIZES[type]
  if (!size || count === 0 || count > 1_000_000) return undefined
  const total = size * count
  let start = valueOffset
  if (total > 4) {
    const pointed = u32(view, valueOffset, le)
    if (pointed === undefined) return undefined
    start = base + pointed
  }
  if (start < 0 || start + total > view.byteLength) return undefined

  if (type === 2) {
    return { text: decodeAscii(view, start, total) }
  }
  if (type === 7) {
    return { text: decodeAscii(view, start, Math.min(total, 64)) }
  }
  if (type === 1) {
    const numbers: number[] = []
    for (let i = 0; i < count; i += 1) numbers.push(view.getUint8(start + i))
    return { text: numbers.slice(0, 32).join(', '), numbers }
  }
  if (type === 3) {
    const numbers: number[] = []
    for (let i = 0; i < count; i += 1) {
      const v = u16(view, start + i * 2, le)
      if (v === undefined) return undefined
      numbers.push(v)
    }
    return { text: count === 1 ? String(numbers[0]) : numbers.slice(0, 32).join(', '), numbers }
  }
  if (type === 4 || type === 9) {
    const numbers: number[] = []
    for (let i = 0; i < count; i += 1) {
      const v = u32(view, start + i * 4, le)
      if (v === undefined) return undefined
      numbers.push(type === 9 && v >= 0x80000000 ? v - 0x100000000 : v)
    }
    return { text: count === 1 ? String(numbers[0]) : numbers.slice(0, 32).join(', '), numbers }
  }
  if (type === 5 || type === 10) {
    const texts: string[] = []
    const numbers: number[] = []
    for (let i = 0; i < count; i += 1) {
      const num = u32(view, start + i * 8, le)
      const den = u32(view, start + i * 8 + 4, le)
      if (num === undefined || den === undefined) return undefined
      const signed = (v: number) => (type === 10 && v >= 0x80000000 ? v - 0x100000000 : v)
      const n = signed(num)
      const d = signed(den)
      texts.push(d === 1 ? String(n) : `${n}/${d}`)
      numbers.push(d === 0 ? Number.NaN : n / d)
    }
    return { text: texts.slice(0, 8).join(', '), numbers }
  }
  return undefined
}

function decodeAscii(view: DataView, start: number, length: number): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + start, length)
  const end = bytes.indexOf(0)
  const slice = end === -1 ? bytes : bytes.subarray(0, end)
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(slice).trim()
  } catch {
    return Array.from(slice, (b) => String.fromCharCode(b)).join('').trim()
  }
}

export function parseIfd(ctx: IfdCtx, ifdOffset: number): ParsedIfd {
  const empty: ParsedIfd = { texts: new Map(), numbers: new Map(), nextIfd: 0 }
  const count = u16(ctx.view, ifdOffset, ctx.le)
  if (count === undefined || count > 512) return empty
  for (let i = 0; i < count; i += 1) {
    const entry = ifdOffset + 2 + i * 12
    const tag = u16(ctx.view, entry, ctx.le)
    const type = u16(ctx.view, entry + 2, ctx.le)
    const num = u32(ctx.view, entry + 4, ctx.le)
    if (tag === undefined || type === undefined || num === undefined || num === 0) continue
    const parsed = readIfdValue(ctx, type, num, entry + 8)
    if (!parsed) continue
    if (!empty.texts.has(tag)) empty.texts.set(tag, parsed.text)
    if (parsed.numbers && !empty.numbers.has(tag)) empty.numbers.set(tag, parsed.numbers)
  }
  empty.nextIfd = u32(ctx.view, ifdOffset + 2 + count * 12, ctx.le) ?? 0
  return empty
}

export function firstNumber(map: Map<number, number[]>, tag: number): number | undefined {
  const list = map.get(tag)
  return list && list.length ? list[0] : undefined
}

export function firstText(map: Map<number, string>, tag: number): string | undefined {
  const text = map.get(tag)
  return text && text.length ? text : undefined
}
