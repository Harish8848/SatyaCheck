import sharp from 'sharp'

/** Use the pinned local image processor, without another service.
 * If proportional resizing fails after upload validation, preserve the original upload.
 */
export async function prepareImage(media: { bytes: Uint8Array; mime: string }) {
  try {
    const processor = sharp(media.bytes, { limitInputPixels: 40_000_000, animated: false })
    const metadata = await processor.metadata()
    if (!metadata.width || !metadata.height || Math.max(metadata.width, metadata.height) <= 2400) {
      return { ...media, note: undefined }
    }
    const bytes: Buffer = await processor.rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
    return { bytes: new Uint8Array(bytes), mime: 'image/png', note: 'A proportional copy, at most 2400 pixels per side, was used for cloud reading. Local OCR and authenticity checks use the original. Very small text may need a closer crop.' }
  } catch {
    return { ...media, note: 'Image resizing was unavailable; the original was used for cloud reading.' }
  }
}
