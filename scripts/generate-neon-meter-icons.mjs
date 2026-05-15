import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { deflateSync } from 'node:zlib'

const execFileAsync = promisify(execFile)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.join(__dirname, '..')
const assetsDir = path.join(projectRoot, 'src', 'assets')
const tmpDir = path.join(projectRoot, '.icon-build')

/**
 * Generates all runtime icon assets.
 * @returns {Promise<void>}
 */
async function main() {
    await mkdir(assetsDir, { recursive: true })
    await writePng(path.join(assetsDir, 'neon-meter-icon.png'), renderIcon(512))
    await writePng(path.join(assetsDir, 'neon-meter-tray.png'), renderIcon(32))
    await writePng(
        path.join(assetsDir, 'neon-meter-tray-template.png'),
        renderTrayTemplate(32)
    )
    await writeIco(path.join(assetsDir, 'neon-meter-icon.ico'))

    if (process.platform === 'darwin') {
        await createIcns()
    }

    await rm(tmpDir, { recursive: true, force: true })
}

/**
 * Creates a macOS ICNS from PNG iconset members.
 * @returns {Promise<void>}
 */
async function createIcns() {
    const iconset = path.join(tmpDir, 'neon-meter-icon.iconset')
    await rm(tmpDir, { recursive: true, force: true })
    await mkdir(iconset, { recursive: true })

    const members = [
        ['icon_16x16.png', 16],
        ['icon_16x16@2x.png', 32],
        ['icon_32x32.png', 32],
        ['icon_32x32@2x.png', 64],
        ['icon_128x128.png', 128],
        ['icon_128x128@2x.png', 256],
        ['icon_256x256.png', 256],
        ['icon_256x256@2x.png', 512],
        ['icon_512x512.png', 512],
        ['icon_512x512@2x.png', 1024]
    ]

    for (const [fileName, size] of members) {
        await writePng(path.join(iconset, fileName), renderIcon(size))
    }

    await execFileAsync('iconutil', [
        '-c',
        'icns',
        iconset,
        '-o',
        path.join(assetsDir, 'neon-meter-icon.icns')
    ])
}

/**
 * Renders the Neon Meter icon into RGBA pixels.
 * @param {number} size
 * @returns {{ width: number, height: number, data: Uint8Array }}
 */
function renderIcon(size) {
    return renderImage(size, colorAt)
}

/**
 * Renders the macOS menu bar template icon into RGBA pixels.
 * @param {number} size
 * @returns {{ width: number, height: number, data: Uint8Array }}
 */
function renderTrayTemplate(size) {
    return renderImage(size, trayTemplateColorAt)
}

/**
 * Renders an antialiased icon image into RGBA pixels.
 * @param {number} size
 * @param {(x: number, y: number) => number[]} colorForPoint
 * @returns {{ width: number, height: number, data: Uint8Array }}
 */
function renderImage(size, colorForPoint) {
    const samples = size >= 1024 ? 2 : 3
    const data = new Uint8Array(size * size * 4)
    const scale = 512 / size
    let outputIndex = 0

    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const total = [0, 0, 0, 0]

            for (let sy = 0; sy < samples; sy += 1) {
                for (let sx = 0; sx < samples; sx += 1) {
                    const px = (x + (sx + 0.5) / samples) * scale
                    const py = (y + (sy + 0.5) / samples) * scale
                    const color = colorForPoint(px, py)

                    total[0] += color[0]
                    total[1] += color[1]
                    total[2] += color[2]
                    total[3] += color[3]
                }
            }

            const count = samples * samples
            data[outputIndex] = Math.round(total[0] / count)
            data[outputIndex + 1] = Math.round(total[1] / count)
            data[outputIndex + 2] = Math.round(total[2] / count)
            data[outputIndex + 3] = Math.round(total[3] / count)
            outputIndex += 4
        }
    }

    return { width: size, height: size, data }
}

/**
 * Returns the monochrome mask color for the macOS tray template icon.
 * @param {number} x
 * @param {number} y
 * @returns {number[]}
 */
function trayTemplateColorAt(x, y) {
    const alpha = [
        arcColor(x, y, 164, 34, -Math.PI, 0, [0, 0, 0, 255]),
        segmentColor(
            x,
            y,
            [194, 358],
            [320, 148],
            34,
            [0, 0, 0],
            [0, 0, 0],
            255
        ),
        circleColor(x, y, 194, 358, 28, [0, 0, 0, 255]),
        circleColor(x, y, 333, 139, 18, [0, 0, 0, 255]),
        circleColor(x, y, 128, 342, 10, [0, 0, 0, 220]),
        circleColor(x, y, 384, 342, 10, [0, 0, 0, 220]),
        segmentColor(
            x,
            y,
            [128, 408],
            [384, 408],
            16,
            [0, 0, 0],
            [0, 0, 0],
            245
        )
    ].reduce((max, color) => Math.max(max, color[3]), 0)

    return [0, 0, 0, alpha]
}

/**
 * Returns the icon color at a 512-unit coordinate.
 * @param {number} x
 * @param {number} y
 * @returns {number[]}
 */
function colorAt(x, y) {
    let color = [0, 0, 0, 0]
    if (roundedRectDistance(x, y, 0, 0, 512, 512, 112) > 0) {
        return color
    }

    color = blend(color, backgroundColor(x, y, 255))

    color = blend(
        color,
        arcColor(x, y, 164, 42, -Math.PI, 0, [26, 49, 70, 245])
    )
    color = blend(
        color,
        arcColor(x, y, 164, 34, -Math.PI, -0.48, [0, 245, 255, 45])
    )
    color = blend(
        color,
        arcColor(x, y, 164, 18, -Math.PI, -0.48, [0, 245, 255, 235])
    )
    color = blend(
        color,
        segmentColor(
            x,
            y,
            [194, 358],
            [320, 148],
            54,
            [0, 245, 255],
            [255, 106, 0],
            34
        )
    )
    color = blend(
        color,
        segmentColor(
            x,
            y,
            [194, 358],
            [320, 148],
            34,
            [0, 245, 255],
            [255, 106, 0],
            245
        )
    )
    color = blend(color, circleColor(x, y, 194, 358, 33, [0, 245, 255, 245]))
    color = blend(color, circleColor(x, y, 194, 358, 19, [3, 8, 15, 255]))
    color = blend(color, circleColor(x, y, 333, 139, 30, [255, 106, 0, 55]))
    color = blend(color, circleColor(x, y, 333, 139, 18, [255, 106, 0, 255]))
    color = blend(color, circleColor(x, y, 128, 342, 10, [126, 252, 255, 220]))
    color = blend(color, circleColor(x, y, 384, 342, 10, [255, 176, 95, 220]))
    color = blend(
        color,
        segmentColor(
            x,
            y,
            [128, 408],
            [384, 408],
            16,
            [45, 74, 98],
            [45, 74, 98],
            245
        )
    )

    return color
}

/**
 * Calculates the signed distance from a rounded rectangle.
 * @param {number} x
 * @param {number} y
 * @param {number} rectX
 * @param {number} rectY
 * @param {number} width
 * @param {number} height
 * @param {number} radius
 * @returns {number}
 */
function roundedRectDistance(x, y, rectX, rectY, width, height, radius) {
    const cx = rectX + width / 2
    const cy = rectY + height / 2
    const qx = Math.abs(x - cx) - (width / 2 - radius)
    const qy = Math.abs(y - cy) - (height / 2 - radius)
    return (
        Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
        Math.min(Math.max(qx, qy), 0) -
        radius
    )
}

/**
 * Creates the icon background gradient color.
 * @param {number} x
 * @param {number} y
 * @param {number} alpha
 * @returns {number[]}
 */
function backgroundColor(x, y, alpha) {
    const t = clamp((x * 0.45 + y * 0.7) / 512, 0, 1)
    return [mix(20, 3, t), mix(35, 8, t), mix(55, 15, t), alpha]
}

/**
 * Returns color contribution for a stroked gauge arc.
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @param {number} width
 * @param {number} start
 * @param {number} end
 * @param {number[]} rgba
 * @returns {number[]}
 */
function arcColor(x, y, radius, width, start, end, rgba) {
    const dx = x - 256
    const dy = y - 342
    const angle = Math.atan2(dy, dx)
    if (angle < start || angle > end) return [0, 0, 0, 0]

    const distance = Math.abs(Math.hypot(dx, dy) - radius)
    const alpha = edgeAlpha(distance, width / 2, 1.4) * rgba[3]
    return [rgba[0], rgba[1], rgba[2], alpha]
}

/**
 * Returns color contribution for a stroked segment.
 * @param {number} x
 * @param {number} y
 * @param {number[]} start
 * @param {number[]} end
 * @param {number} width
 * @param {number[]} startRgb
 * @param {number[]} endRgb
 * @param {number} alpha
 * @returns {number[]}
 */
function segmentColor(x, y, start, end, width, startRgb, endRgb, alpha) {
    const vx = end[0] - start[0]
    const vy = end[1] - start[1]
    const lengthSq = vx * vx + vy * vy
    const t = clamp(
        ((x - start[0]) * vx + (y - start[1]) * vy) / lengthSq,
        0,
        1
    )
    const px = start[0] + vx * t
    const py = start[1] + vy * t
    const distance = Math.hypot(x - px, y - py)
    const shapeAlpha = edgeAlpha(distance, width / 2, 1.6) * alpha

    return [
        mix(startRgb[0], endRgb[0], t),
        mix(startRgb[1], endRgb[1], t),
        mix(startRgb[2], endRgb[2], t),
        shapeAlpha
    ]
}

/**
 * Returns color contribution for a filled circle.
 * @param {number} x
 * @param {number} y
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number[]} rgba
 * @returns {number[]}
 */
function circleColor(x, y, cx, cy, radius, rgba) {
    const distance = Math.hypot(x - cx, y - cy)
    const alpha = edgeAlpha(distance, radius, 1.4) * rgba[3]
    return [rgba[0], rgba[1], rgba[2], alpha]
}

/**
 * Calculates antialiased alpha for a distance field.
 * @param {number} distance
 * @param {number} radius
 * @param {number} feather
 * @returns {number}
 */
function edgeAlpha(distance, radius, feather) {
    return clamp((radius + feather - distance) / (feather * 2), 0, 1)
}

/**
 * Blends source over destination.
 * @param {number[]} destination
 * @param {number[]} source
 * @returns {number[]}
 */
function blend(destination, source) {
    const sourceAlpha = source[3] / 255
    const destinationAlpha = destination[3] / 255
    const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha)

    if (outputAlpha <= 0) return [0, 0, 0, 0]

    return [
        (source[0] * sourceAlpha +
            destination[0] * destinationAlpha * (1 - sourceAlpha)) /
            outputAlpha,
        (source[1] * sourceAlpha +
            destination[1] * destinationAlpha * (1 - sourceAlpha)) /
            outputAlpha,
        (source[2] * sourceAlpha +
            destination[2] * destinationAlpha * (1 - sourceAlpha)) /
            outputAlpha,
        outputAlpha * 255
    ]
}

/**
 * Writes a PNG file.
 * @param {string} filePath
 * @param {{ width: number, height: number, data: Uint8Array }} image
 * @returns {Promise<void>}
 */
async function writePng(filePath, image) {
    await writeFile(filePath, pngBuffer(image))
}

/**
 * Writes a Windows ICO file.
 * @param {string} filePath
 * @returns {Promise<void>}
 */
async function writeIco(filePath) {
    const images = [16, 32, 48, 256].map((size) => ({
        size,
        data: pngBuffer(renderIcon(size))
    }))
    const header = Buffer.alloc(6 + images.length * 16)
    let imageOffset = header.length

    header.writeUInt16LE(0, 0)
    header.writeUInt16LE(1, 2)
    header.writeUInt16LE(images.length, 4)

    for (const [index, image] of images.entries()) {
        const entryOffset = 6 + index * 16
        header[entryOffset] = image.size === 256 ? 0 : image.size
        header[entryOffset + 1] = image.size === 256 ? 0 : image.size
        header[entryOffset + 2] = 0
        header[entryOffset + 3] = 0
        header.writeUInt16LE(1, entryOffset + 4)
        header.writeUInt16LE(32, entryOffset + 6)
        header.writeUInt32LE(image.data.length, entryOffset + 8)
        header.writeUInt32LE(imageOffset, entryOffset + 12)
        imageOffset += image.data.length
    }

    await writeFile(
        filePath,
        Buffer.concat([header, ...images.map((i) => i.data)])
    )
}

/**
 * Builds PNG file bytes.
 * @param {{ width: number, height: number, data: Uint8Array }} image
 * @returns {Buffer}
 */
function pngBuffer(image) {
    const rawStride = image.width * 4 + 1
    const raw = new Uint8Array(rawStride * image.height)

    for (let y = 0; y < image.height; y += 1) {
        const rawOffset = y * rawStride
        const imageOffset = y * image.width * 4
        raw[rawOffset] = 0
        raw.set(
            image.data.subarray(imageOffset, imageOffset + image.width * 4),
            rawOffset + 1
        )
    }

    return Buffer.concat([
        Buffer.from('89504e470d0a1a0a', 'hex'),
        chunk('IHDR', ihdr(image.width, image.height)),
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0))
    ])
}

/**
 * Builds PNG IHDR data.
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
function ihdr(width, height) {
    const buffer = Buffer.alloc(13)
    buffer.writeUInt32BE(width, 0)
    buffer.writeUInt32BE(height, 4)
    buffer[8] = 8
    buffer[9] = 6
    buffer[10] = 0
    buffer[11] = 0
    buffer[12] = 0
    return buffer
}

/**
 * Builds a PNG chunk.
 * @param {string} type
 * @param {Buffer | Uint8Array} data
 * @returns {Buffer}
 */
function chunk(type, data) {
    const typeBuffer = Buffer.from(type, 'ascii')
    const dataBuffer = Buffer.from(data)
    const length = Buffer.alloc(4)
    length.writeUInt32BE(dataBuffer.length, 0)
    const crcBuffer = Buffer.alloc(4)
    crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, dataBuffer])), 0)
    return Buffer.concat([length, typeBuffer, dataBuffer, crcBuffer])
}

/**
 * Calculates CRC32.
 * @param {Buffer} buffer
 * @returns {number}
 */
function crc32(buffer) {
    let crc = 0xffffffff
    for (const byte of buffer) {
        crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
    }
    return (crc ^ 0xffffffff) >>> 0
}

const crcTable = Array.from({ length: 256 }, (_value, index) => {
    let crc = index
    for (let bit = 0; bit < 8; bit += 1) {
        crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
    }
    return crc >>> 0
})

/**
 * Clamps a number.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value))
}

/**
 * Interpolates between two values.
 * @param {number} start
 * @param {number} end
 * @param {number} t
 * @returns {number}
 */
function mix(start, end, t) {
    return start + (end - start) * t
}

await main()
