import { cleanString, unwrapXmp } from './bytes'

/**
 * XMP / IPTC / C2PA reading for JPEG, PNG, WebP, GIF, MP4 and TIFF uploads.
 *
 * We deliberately avoid an XML DOM dependency: the packet is scanned with
 * targeted, case-insensitive matchers so a hostile or truncated packet can at
 * worst yield `found: false`, never an exception or an SSRF fetch of a remote
 * entity. Packets are truncated before parsing; nothing is downloaded.
 */

export type C2paInfo = {
  present: boolean
  /** Claim generator / `dcterms:creator`-style attribution when visible. */
  claimGenerator?: string
  /** Named assertions observed in the manifest reference. */
  assertions: string[]
  signaturePresent: boolean
  validation: 'manifest_present_signature_unvalidated' | 'manifest_present_signature_present' | 'absent'
  rawExcerpt?: string
}

export type XmpInfo = {
  present: boolean
  packetLength: number
  truncated: boolean
  /** Raw producer strings, e.g. `Adobe Photoshop`, `Midjourney`, `Canva`. */
  creators: string[]
  description?: string
  rights?: string
  createDate?: string
  modifyDate?: string
  rating?: string
  label?: string
  /** e.g. ` generativeFill `, `AIGenerated`, `Composed`. */
  historyActions: string[]
  documentId?: string
  /** Photoshop:SupplementalCategories, dc:subject, Lightroom hierarchicalSubject. */
  keywords: string[]
  c2pa: C2paInfo
  provenanceStatements: string[]
  warnings: string[]
}

const MAX_PACKET = 256 * 1024

function firstAttr(packet: string, tag: string, attr: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*?${attr}="([^"]{1,400})"`, 'i')
  const match = packet.match(re)
  return match ? match[1].trim() || undefined : undefined
}

function firstElement(packet: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^<>]*>([^<>]{1,2000})</${tag}>`, 'i')
  const match = packet.match(re)
  return match ? match[1].trim() || undefined : undefined
}

function allElements(packet: string, tag: string, limit = 24): string[] {
  const out: string[] = []
  const re = new RegExp(`<${tag}[^<>]*>([^<>]{1,500})</${tag}>`, 'gi')
  let match: RegExpExecArray | null
  while ((match = re.exec(packet)) !== null && out.length < limit) {
    const value = match[1].trim()
    if (value && !out.includes(value)) out.push(value)
  }
  return out
}

function allAttrs(packet: string, tag: string, attr: string, limit = 24): string[] {
  const out: string[] = []
  const re = new RegExp(`<${tag}[^>]*?${attr}="([^"]{1,300})"`, 'gi')
  let match: RegExpExecArray | null
  while ((match = re.exec(packet)) !== null && out.length < limit) {
    const value = match[1].trim()
    if (value && !out.includes(value)) out.push(value)
  }
  return out
}

function hasTag(packet: string, tag: string): boolean {
  return new RegExp(`<${tag}[\\s>/]`, 'i').test(packet)
}


function readC2pa(packet: string): C2paInfo {
  // C2PA embeds a manifest reference inside XMP: either a `c2pa:manifest`
  // element, a `dcterms:provenance` URI, or a `.c2pa` reference in history.
  const manifestHit =
    /<c2pa:manifest[\s>]|c2pa:claim_generator|dcterms:provenance|c2pa\.manifest/i.test(packet) ||
    (/\bc2pa\b/i.test(packet.slice(0, 4000)) && packet.toLowerCase().includes('manifest'))
  if (!manifestHit) {
    return { present: false, assertions: [], signaturePresent: false, validation: 'absent' }
  }
  const claimGenerator =
    firstAttr(packet, 'c2pa:manifest', 'c2pa:claim_generator') ??
    firstElement(packet, 'c2pa:claim_generator') ??
    firstElement(packet, 'dcterms:creator') ??
    firstElement(packet, 'dc:creator')
  const assertions = [...allAttrs(packet, 'c2pa:assertion', 'c2pa:label'), ...allElements(packet, 'c2pa:label')].slice(0, 24)
  const signaturePresent = /c2pa:signature|c2pa:hash|manifestSignature/i.test(packet)
  const excerpt = packet.slice(0, 600).replace(/\s+/g, ' ').trim()
  return {
    present: true,
    claimGenerator,
    assertions,
    signaturePresent,
    // Honest limitation: without the C2PA validation toolchain we report
    // presence, never cryptographic validity.
    validation: signaturePresent ? 'manifest_present_signature_present' : 'manifest_present_signature_unvalidated',
    rawExcerpt: excerpt,
  }
}

function readProvenance(packet: string): string[] {
  const statements: string[] = []
  for (const tag of ['dcterms:provenance', 'dcterms:source', 'xmpMM:History', 'dc:source', 'plus:ImageCreator']) {
    if (hasTag(packet, tag)) statements.push(tag)
  }
  const history = allAttrs(packet, 'rdf:li', 'stEvt:action').concat(allElements(packet, 'stEvt:action'))
  for (const action of history.slice(0, 12)) {
    if (action && !statements.includes(`history:${action}`)) statements.push(`history:${action}`)
  }
  return statements
}

/** Parse an XMP packet held as raw bytes. */
export function parseXmpBytes(raw: Uint8Array): XmpInfo {
  const empty: XmpInfo = {
    present: false,
    packetLength: raw.length,
    truncated: false,
    creators: [],
    historyActions: [],
    keywords: [],
    c2pa: { present: false, assertions: [], signaturePresent: false, validation: 'absent' },
    provenanceStatements: [],
    warnings: [],
  }
  if (!raw.length) return empty
  const bytes = raw.length > MAX_PACKET ? raw.subarray(0, MAX_PACKET) : raw
  const text = cleanString(bytes)
  if (!text || !(text.includes('xmpmeta') || text.includes('x:xmpmeta'))) return empty
  return parseXmpText(unwrapXmp(text), raw.length > MAX_PACKET)
}

/** Parse XMP already decoded to a string (e.g. PNG iTXt payloads). */
export function parseXmpText(packet: string, truncated = false): XmpInfo {
  const full: XmpInfo = {
    present: true,
    packetLength: packet.length,
    truncated,
    creators: [],
    historyActions: [],
    keywords: [],
    c2pa: readC2pa(packet),
    provenanceStatements: readProvenance(packet),
    warnings: [],
  }
  full.creators = [
    ...allAttrs(packet, 'rdf:Description', 'xmp:CreatorTool'),
    ...allElements(packet, 'xmp:CreatorTool'),
    ...allElements(packet, 'tiff:Make'),
  ].slice(0, 12)
  full.description = firstElement(packet, 'dc:description') ?? firstElement(packet, 'xmp:Description')
  full.rights = firstElement(packet, 'dc:rights') ?? firstElement(packet, 'xmp:Rights')
  full.createDate = firstAttr(packet, 'rdf:Description', 'xmp:CreateDate') ?? firstElement(packet, 'xmp:CreateDate')
  full.modifyDate = firstAttr(packet, 'rdf:Description', 'xmp:ModifyDate') ?? firstElement(packet, 'xmp:ModifyDate')
  full.rating = firstAttr(packet, 'rdf:Description', 'xmp:Rating') ?? firstElement(packet, 'xmp:Rating')
  full.label = firstAttr(packet, 'rdf:Description', 'xmp:Label') ?? firstElement(packet, 'xmp:Label')
  full.documentId = firstAttr(packet, 'rdf:Description', 'xmpMM:DocumentID') ?? firstElement(packet, 'xmpMM:DocumentID')
  full.historyActions = allAttrs(packet, 'rdf:li', 'stEvt:action').concat(allElements(packet, 'stEvt:action')).slice(0, 24)
  full.keywords = [
    ...allElements(packet, 'dc:subject'),
    ...allElements(packet, 'lr:hierarchicalSubject'),
    ...allElements(packet, 'photoshop:SupplementalCategories'),
  ].slice(0, 40)

  if (truncated) full.warnings.push('XMP packet exceeded the parse ceiling and was truncated before reading.')
  return full
}
