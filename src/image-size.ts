import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'

const MAC_SCREENSHOT_SIZES = new Set([
  '1280x800',
  '1440x900',
  '2560x1600',
  '2880x1800'
])

export type ImageSize = {width: number; height: number; format: 'png' | 'jpeg'}

export function readImageSize(path: string): ImageSize {
  const bytes = readFileSync(path)
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    // PNG IHDR at byte 16
    const width = bytes.readUInt32BE(16)
    const height = bytes.readUInt32BE(20)
    return {width, height, format: 'png'}
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return {...readJpegSize(bytes), format: 'jpeg'}
  }
  throw new Error(
    `Unsupported image format for ${path} (need PNG or JPEG without alpha for App Store screenshots)`
  )
}

function readJpegSize(bytes: Buffer): {width: number; height: number} {
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]
    const length = bytes.readUInt16BE(offset + 2)
    // SOF0 / SOF2
    if (marker === 0xc0 || marker === 0xc2) {
      const height = bytes.readUInt16BE(offset + 5)
      const width = bytes.readUInt16BE(offset + 7)
      return {width, height}
    }
    offset += 2 + length
  }
  throw new Error('Could not read JPEG dimensions')
}

export function assertMacScreenshotSize(path: string): ImageSize {
  const size = readImageSize(path)
  const key = `${size.width}x${size.height}`
  if (!MAC_SCREENSHOT_SIZES.has(key)) {
    throw new Error(
      `Mac screenshot ${path} is ${key}; App Store accepts ${[...MAC_SCREENSHOT_SIZES].join(', ')} (16:10 JPEG/PNG)`
    )
  }
  return size
}

export function md5Hex(path: string): string {
  return createHash('md5').update(readFileSync(path)).digest('hex')
}
