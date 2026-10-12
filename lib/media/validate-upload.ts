import sharp from 'sharp'
import { UserFacingError } from '../core/errors'
import { config } from '../core/config'

export function validateUpload(kind: 'image' | 'video' | 'audio', media: { bytes: Uint8Array; mime: string }) {
  const b = Buffer.from(media.bytes), mime = media.mime.toLowerCase()
  if (!b.length || b.length > (kind === 'image' ? config.maxImageBytes : config.maxVideoBytes)) throw new UserFacingError('Upload is empty or exceeds the file size limit.')
  const riff = b.toString('ascii', 0, 4) === 'RIFF'
  const signature = mime === 'image/jpeg' ? b[0] === 255 && b[1] === 216 && b[2] === 255
    : mime === 'image/png' ? b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : mime === 'image/webp' ? riff && b.toString('ascii', 8, 12) === 'WEBP'
    : ['video/mp4', 'video/quicktime', 'audio/mp4', 'audio/x-m4a'].includes(mime) ? b.toString('ascii', 4, 8) === 'ftyp'
    : mime === 'video/webm' ? b.subarray(0,4).equals(Buffer.from([26,69,223,163]))
    : ['audio/wav', 'audio/x-wav'].includes(mime) ? riff && b.toString('ascii',8,12) === 'WAVE'
    : mime === 'audio/ogg' ? b.toString('ascii',0,4) === 'OggS'
    : mime === 'audio/mpeg' ? b.toString('ascii',0,3) === 'ID3' || (b[0] === 255 && (b[1] & 224) === 224) : false
  if (!mime.startsWith(`${kind}/`) || !signature) throw new UserFacingError('Unsupported upload format or file contents do not match the declared media type. Use PNG, JPG, WebP, MP4, MOV, WebM, MP3, WAV, M4A or Ogg.')
}

/** Reject decompression bombs before optional OCR or forensic decoders see the upload. */
export async function validateImageDimensions(media: { bytes: Uint8Array; mime: string }) {
  try {
    const metadata = await sharp(media.bytes, { limitInputPixels: 40_000_000, animated: false }).metadata()
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > 40_000_000 || (metadata.pages ?? 1) > 1) throw new Error('Image dimensions unsupported')
  } catch { throw new UserFacingError('Image could not be safely decoded. Use a still PNG, JPG or WebP image under 40 megapixels. Server setup requires the image decoder shipped with Next.js.') }
}
