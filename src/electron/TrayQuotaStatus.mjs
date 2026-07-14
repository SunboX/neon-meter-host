import { readFileSync } from 'node:fs'
import { deflateSync, inflateSync } from 'node:zlib'

const DEFAULT_APP_NAME = 'Neon Meter'
const IMAGE_SCALE_FACTOR = 2
const IMAGE_HEIGHT = 32
const ICON_WIDTH = 34
const ICON_GAP = 10
const ICON_TARGET_WIDTH = 34
const ICON_TARGET_HEIGHT = 27
const ICON_TARGET_X = 0
const ICON_TARGET_Y = 2
const LABEL_WIDTH = 14
const LABEL_GAP = 6
const BAR_WIDTH = 78
const BAR_HEIGHT = 24
const BAR_TOP = 4
const BETWEEN_GAUGES = 14
const STROKE = 2

const NEON_HEX = Object.freeze({
    cyan: '#00f5ff',
    orange: '#ff6a00',
    green: '#6dffa8',
    amber: '#ffd75e',
    ink: '#000000',
    warn: '#ff5d5d',
    panel: '#102638',
    template: '#ffffff',
    text: '#dff7ff'
})

const COLORS = Object.freeze({
    cyan: hexColor(NEON_HEX.cyan),
    orange: hexColor(NEON_HEX.orange),
    green: hexColor(NEON_HEX.green),
    amber: hexColor(NEON_HEX.amber),
    ink: hexColor(NEON_HEX.ink),
    warn: hexColor(NEON_HEX.warn),
    panel: hexColor(NEON_HEX.panel),
    template: hexColor(NEON_HEX.template),
    text: hexColor(NEON_HEX.text),
    transparent: [0, 0, 0, 0]
})

const APP_ICON_ALPHA = loadAppIconAlpha()

const GLYPHS = Object.freeze({
    S: ['.XXXX', 'X....', 'X....', '.XXX.', '....X', '....X', 'XXXX.'],
    W: ['X...X', 'X...X', 'X...X', 'X.X.X', 'X.X.X', 'X.X.X', '.X.X.'],
    0: ['.XXX.', 'X...X', 'X..XX', 'X.X.X', 'XX..X', 'X...X', '.XXX.'],
    1: ['..X..', '.XX..', '..X..', '..X..', '..X..', '..X..', '.XXX.'],
    2: ['.XXX.', 'X...X', '....X', '...X.', '..X..', '.X...', 'XXXXX'],
    3: ['.XXX.', 'X...X', '....X', '..XX.', '....X', 'X...X', '.XXX.'],
    4: ['...X.', '..XX.', '.X.X.', 'X..X.', 'XXXXX', '...X.', '...X.'],
    5: ['XXXXX', 'X....', 'XXXX.', '....X', '....X', 'X...X', '.XXX.'],
    6: ['.XXX.', 'X....', 'XXXX.', 'X...X', 'X...X', 'X...X', '.XXX.'],
    7: ['XXXXX', '....X', '...X.', '..X..', '..X..', '..X..', '..X..'],
    8: ['.XXX.', 'X...X', 'X...X', '.XXX.', 'X...X', 'X...X', '.XXX.'],
    9: ['.XXX.', 'X...X', 'X...X', '.XXXX', '....X', '....X', '.XXX.'],
    ':': ['.....', '..X..', '..X..', '.....', '..X..', '..X..', '.....'],
    '%': ['XX..X', 'XX.X.', '..X..', '.X...', 'X.XX.', 'X.XX.', '.....'],
    '!': ['..X..', '..X..', '..X..', '..X..', '..X..', '.....', '..X..']
})

/**
 * Returns whether tray quota/status display should be visible.
 * @param {unknown} settings
 * @returns {boolean}
 */
export function isTrayQuotaStatusVisible(settings) {
    const source = settings && typeof settings === 'object' ? settings : {}
    return source.showTrayQuotaStatus !== false
}

/**
 * Builds display-only tray quota/status content from a provider bundle.
 * @param {unknown} bundle
 * @param {{ appName?: string }} [options]
 * @returns {{ title: string, tooltip: string, menuItems: Array<{ label: string, enabled: false }>, gauges?: Array<{ label: string, valueText: string, fillPercent: number, color: string }>, imagePngBase64?: string, imageScaleFactor?: number }}
 */
export function buildTrayQuotaStatus(bundle, options = {}) {
    const appName = String(options.appName || DEFAULT_APP_NAME)
    const providers = providerPayloads(bundle)
    const trayProvider = selectTrayProvider(providers)
    const gauges = trayProvider ? buildGauges(trayProvider) : []

    if (providers.length === 0) {
        return {
            title: '',
            tooltip: appName + '\nQuota status waiting for sync',
            menuItems: [
                {
                    label: 'Quota status waiting for sync',
                    enabled: false
                }
            ]
        }
    }

    return {
        title: gauges.map(titlePart).filter(Boolean).join(' · '),
        tooltip: [appName, ...providers.map(tooltipLine)].join('\n'),
        menuItems: [
            {
                label: 'Quota status',
                enabled: false
            },
            ...providers.map((provider) => ({
                label: menuLine(provider),
                enabled: false
            }))
        ],
        gauges,
        imagePngBase64: renderTrayGaugeImage(gauges),
        imageScaleFactor: IMAGE_SCALE_FACTOR
    }
}

/**
 * Returns valid provider payloads from a bundle.
 * @param {unknown} bundle
 * @returns {object[]}
 */
function providerPayloads(bundle) {
    if (!bundle || typeof bundle !== 'object') return []
    const providers = Array.isArray(bundle.providers) ? bundle.providers : []
    return providers
        .filter((provider) => provider && typeof provider === 'object')
        .slice(0, 2)
}

/**
 * Selects the provider whose session or weekly usage is most urgent.
 * @param {object[]} providers
 * @returns {object | null}
 */
function selectTrayProvider(providers) {
    const candidates = providers.filter((provider) => provider.p !== 'host')
    const usable = candidates.length > 0 ? candidates : providers
    return (
        usable
            .slice()
            .sort((a, b) => providerUrgency(b) - providerUrgency(a))[0] || null
    )
}

/**
 * Returns the highest visible usage percent for a provider.
 * @param {object} provider
 * @returns {number}
 */
function providerUrgency(provider) {
    const values = [usedPercent(provider.w, provider.wr)]
    if (provider.se !== false) {
        values.push(usedPercent(provider.s, provider.sr))
    }
    return Math.max(...values)
}

/**
 * Builds the session and weekly gauges for the tray image.
 * @param {object} provider
 * @returns {Array<{ label: string, valueText: string, fillPercent: number, color: string }>}
 */
function buildGauges(provider) {
    const gauges = []
    if (provider.se !== false) {
        gauges.push(buildGauge('S', provider, 's', 'sr'))
    }
    gauges.push(buildGauge('W', provider, 'w', 'wr'))
    return gauges
}

/**
 * Builds one gauge model.
 * @param {'S' | 'W'} label
 * @param {object} provider
 * @param {'s' | 'w'} percentKey
 * @param {'sr' | 'wr'} resetKey
 * @returns {{ label: string, valueText: string, fillPercent: number, color: string }}
 */
function buildGauge(label, provider, percentKey, resetKey) {
    const fillPercent = remainingPercent(
        provider[percentKey],
        provider[resetKey]
    )
    return {
        label,
        valueText: String(fillPercent) + '%',
        fillPercent,
        color: gaugeColor(fillPercent)
    }
}

/**
 * Formats a compact menu bar title part.
 * @param {{ label: string, valueText: string }} gauge
 * @param {object} provider
 * @returns {string}
 */
function titlePart(gauge) {
    return gauge.label + ' ' + titleValue(gauge.valueText)
}

/**
 * Formats one context-menu status row.
 * @param {object} provider
 * @returns {string}
 */
function menuLine(provider) {
    const name = providerName(provider)
    if (provider.ok === false) {
        return name + ': ' + errorDetail(provider)
    }
    if (usedPercent(provider.w, provider.wr) >= 100) {
        return (
            name +
            ': ' +
            windowLabel(provider.wl, 'Weekly') +
            ' limit reached' +
            resetSuffix(provider.wr)
        )
    }
    if (provider.se === false) {
        return name + ': ' + windowPercent(provider, 'w', 'wr', 'Weekly')
    }
    if (usedPercent(provider.s, provider.sr) >= 100) {
        return (
            name +
            ': ' +
            windowLabel(provider.sl, 'Session') +
            ' limit reached' +
            resetSuffix(provider.sr)
        )
    }
    return (
        name +
        ': ' +
        windowPercent(provider, 's', 'sr', 'Session') +
        ' / ' +
        windowPercent(provider, 'w', 'wr', 'Weekly')
    )
}

/**
 * Formats one tooltip detail row.
 * @param {object} provider
 * @returns {string}
 */
function tooltipLine(provider) {
    const name = providerName(provider)
    if (provider.ok === false) return name + ': ' + errorDetail(provider)
    if (provider.se === false) {
        return name + ': ' + windowDetail(provider, 'w', 'wr', 'Weekly')
    }
    return (
        name +
        ': ' +
        windowDetail(provider, 's', 'sr', 'Session') +
        ' / ' +
        windowDetail(provider, 'w', 'wr', 'Weekly')
    )
}

/**
 * Formats a label and percent for compact menu rows.
 * @param {object} provider
 * @param {'s' | 'w'} percentKey
 * @param {'sr' | 'wr'} resetKey
 * @param {string} fallback
 * @returns {string}
 */
function windowPercent(provider, percentKey, resetKey, fallback) {
    return (
        windowLabel(percentKey === 's' ? provider.sl : provider.wl, fallback) +
        ' ' +
        String(remainingPercent(provider[percentKey], provider[resetKey])) +
        '%'
    )
}

/**
 * Formats a label, percent, and optional reset countdown.
 * @param {object} provider
 * @param {'s' | 'w'} percentKey
 * @param {'sr' | 'wr'} resetKey
 * @param {string} fallback
 * @returns {string}
 */
function windowDetail(provider, percentKey, resetKey, fallback) {
    return (
        windowPercent(provider, percentKey, resetKey, fallback) +
        resetSuffix(provider[resetKey])
    )
}

/**
 * Formats a reset suffix when a reset value is available.
 * @param {unknown} value
 * @returns {string}
 */
function resetSuffix(value) {
    const duration = resetDuration(value)
    return duration ? ' (' + duration + ' left)' : ''
}

/**
 * Formats minutes as a compact reset duration.
 * @param {unknown} value
 * @returns {string}
 */
function resetDuration(value) {
    const minutes = Number(value)
    if (!Number.isFinite(minutes) || minutes < 0) return ''
    const rounded = Math.max(0, Math.round(minutes))
    const days = Math.floor(rounded / 1440)
    const hours = Math.floor((rounded % 1440) / 60)
    const restMinutes = rounded % 60

    if (days > 0) {
        return days + 'd' + (hours > 0 ? ' ' + hours + 'h' : '')
    }
    if (hours > 0) {
        return hours + 'h' + (restMinutes > 0 ? ' ' + restMinutes + 'm' : '')
    }
    return String(restMinutes) + 'm'
}

/**
 * Returns a display provider name.
 * @param {object} provider
 * @returns {string}
 */
function providerName(provider) {
    return text(provider.title, defaultProviderName(provider.p))
}

/**
 * Returns default display names for known providers.
 * @param {unknown} provider
 * @returns {string}
 */
function defaultProviderName(provider) {
    const key = String(provider || '').toLowerCase()
    if (key === 'claude') return 'Claude Code'
    if (key === 'chatgpt') return 'ChatGPT'
    return 'Neon Meter'
}

/**
 * Returns a readable usage window label.
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function windowLabel(value, fallback) {
    return text(value, fallback)
}

/**
 * Returns a payload error description.
 * @param {object} provider
 * @returns {string}
 */
function errorDetail(provider) {
    return text(provider.detail, text(provider.st, 'unavailable'))
}

/**
 * Normalizes a percentage value.
 * @param {unknown} value
 * @returns {number}
 */
function percent(value) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return 0
    return Math.max(0, Math.min(100, Math.round(parsed)))
}

/**
 * Returns a firmware-compatible used percentage for one usage window.
 * @param {unknown} value
 * @param {unknown} resetValue
 * @returns {number}
 */
function usedPercent(value, resetValue) {
    const resetMinutes = Number(resetValue)
    if (Number.isFinite(resetMinutes) && Math.round(resetMinutes) === 0) {
        return 0
    }
    return percent(value)
}

/**
 * Returns the remaining-capacity percentage displayed by Neon Meter.
 * @param {unknown} value
 * @param {unknown} resetValue
 * @returns {number}
 */
function remainingPercent(value, resetValue) {
    return 100 - usedPercent(value, resetValue)
}

/**
 * Returns a Neon Meter gauge color for the rendered fill bucket.
 * @param {number} value
 * @returns {string}
 */
function gaugeColor(value) {
    // Mirror the device's remaining-capacity buckets against the visible fill.
    if (value <= 20) return NEON_HEX.warn
    if (value <= 50) return NEON_HEX.amber
    return NEON_HEX.green
}

/**
 * Formats a gauge value for text fallback outside the bitmap.
 * @param {string} value
 * @returns {string}
 */
function titleValue(value) {
    if (/^\d+:\d{2}$/.test(value)) {
        const [hours, minutes] = value.split(':')
        return String(Number(hours)) + 'h ' + minutes + 'm'
    }
    return value
}

/**
 * Renders S/W gauges as a transparent PNG for the menu bar.
 * @param {Array<{ label: string, valueText: string, fillPercent: number, color: string }>} gauges
 * @returns {string}
 */
function renderTrayGaugeImage(gauges) {
    const width =
        ICON_WIDTH +
        ICON_GAP +
        gauges.length * (LABEL_WIDTH + LABEL_GAP + BAR_WIDTH) +
        Math.max(0, gauges.length - 1) * BETWEEN_GAUGES
    const pixels = createPixels(width, IMAGE_HEIGHT)
    drawAppIcon(pixels, 0, 0)
    let x = ICON_WIDTH + ICON_GAP

    for (const gauge of gauges) {
        drawText(pixels, x, 9, gauge.label, COLORS.text)
        x += LABEL_WIDTH + LABEL_GAP
        drawGauge(pixels, x, BAR_TOP, gauge)
        x += BAR_WIDTH + BETWEEN_GAUGES
    }

    return encodePng(width, IMAGE_HEIGHT, pixels).toString('base64')
}

/**
 * Draws one outlined filled gauge.
 * @param {Array<Array<number[]>>} pixels
 * @param {number} x
 * @param {number} y
 * @param {{ valueText: string, fillPercent: number, color: string }} gauge
 * @returns {void}
 */
function drawGauge(pixels, x, y, gauge) {
    fillRect(pixels, x, y, x + BAR_WIDTH, y + STROKE, COLORS.text)
    fillRect(
        pixels,
        x,
        y + BAR_HEIGHT - STROKE,
        x + BAR_WIDTH,
        y + BAR_HEIGHT,
        COLORS.text
    )
    fillRect(pixels, x, y, x + STROKE, y + BAR_HEIGHT, COLORS.text)
    fillRect(
        pixels,
        x + BAR_WIDTH - STROKE,
        y,
        x + BAR_WIDTH,
        y + BAR_HEIGHT,
        COLORS.text
    )
    for (const [cx, cy] of [
        [x, y],
        [x + BAR_WIDTH - 1, y],
        [x, y + BAR_HEIGHT - 1],
        [x + BAR_WIDTH - 1, y + BAR_HEIGHT - 1]
    ]) {
        pixels[cy][cx] = COLORS.transparent
    }

    fillRect(
        pixels,
        x + STROKE + 1,
        y + STROKE + 1,
        x + BAR_WIDTH - STROKE - 1,
        y + BAR_HEIGHT - STROKE - 1,
        COLORS.panel
    )

    const innerWidth = BAR_WIDTH - STROKE * 2 - 2
    const fillWidth = Math.round(
        (innerWidth * Math.max(0, Math.min(100, gauge.fillPercent))) / 100
    )
    if (fillWidth > 0) {
        fillRect(
            pixels,
            x + STROKE + 1,
            y + STROKE + 1,
            x + STROKE + 1 + fillWidth,
            y + BAR_HEIGHT - STROKE - 1,
            hexColor(gauge.color)
        )
    }

    const textWidth = measureText(gauge.valueText)
    drawContrastText(
        pixels,
        x + Math.floor((BAR_WIDTH - textWidth) / 2),
        y + Math.floor((BAR_HEIGHT - 14) / 2),
        gauge.valueText
    )
}

/**
 * Draws a compact Neon Meter mark next to the gauges.
 * @param {Array<Array<number[]>>} pixels
 * @param {number} x
 * @param {number} y
 * @returns {void}
 */
function drawAppIcon(pixels, x, y) {
    if (!APP_ICON_ALPHA) return

    for (let targetY = 0; targetY < ICON_TARGET_HEIGHT; targetY += 1) {
        for (let targetX = 0; targetX < ICON_TARGET_WIDTH; targetX += 1) {
            const alpha = Math.round(
                sampleAlpha(
                    APP_ICON_ALPHA,
                    sourceCoordinate(
                        targetX,
                        ICON_TARGET_WIDTH,
                        APP_ICON_ALPHA.width
                    ),
                    sourceCoordinate(
                        targetY,
                        ICON_TARGET_HEIGHT,
                        APP_ICON_ALPHA.height
                    )
                )
            )
            if (alpha === 0) continue

            const pixelY = y + ICON_TARGET_Y + targetY
            const pixelX = x + ICON_TARGET_X + targetX
            if (!pixels[pixelY] || !pixels[pixelY][pixelX]) continue
            pixels[pixelY][pixelX] = [
                COLORS.template[0],
                COLORS.template[1],
                COLORS.template[2],
                alpha
            ]
        }
    }
}

/**
 * Creates transparent RGBA pixel rows.
 * @param {number} width
 * @param {number} height
 * @returns {Array<Array<number[]>>}
 */
function createPixels(width, height) {
    return Array.from({ length: height }, () =>
        Array.from({ length: width }, () => COLORS.transparent)
    )
}

/**
 * Draws text with the pixel font.
 * @param {Array<Array<number[]>>} pixels
 * @param {number} x
 * @param {number} y
 * @param {string} value
 * @param {number[]} color
 * @returns {void}
 */
function drawText(pixels, x, y, value, color) {
    let cursor = x
    for (const char of String(value).toUpperCase()) {
        drawGlyph(pixels, cursor, y, char, color)
        cursor += 12
    }
}

/**
 * Draws text with per-pixel contrast against the gauge fill below it.
 * @param {Array<Array<number[]>>} pixels
 * @param {number} x
 * @param {number} y
 * @param {string} value
 * @returns {void}
 */
function drawContrastText(pixels, x, y, value) {
    let cursor = x
    for (const char of String(value).toUpperCase()) {
        drawContrastGlyph(pixels, cursor, y, char)
        cursor += 12
    }
}

/**
 * Draws one glyph.
 * @param {Array<Array<number[]>>} pixels
 * @param {number} x
 * @param {number} y
 * @param {string} char
 * @param {number[]} color
 * @returns {void}
 */
function drawGlyph(pixels, x, y, char, color) {
    const glyph = GLYPHS[char] || GLYPHS['!']
    for (let row = 0; row < glyph.length; row += 1) {
        for (let column = 0; column < glyph[row].length; column += 1) {
            if (glyph[row][column] !== 'X') continue
            fillRect(
                pixels,
                x + column * 2,
                y + row * 2,
                x + column * 2 + 2,
                y + row * 2 + 2,
                color
            )
        }
    }
}

/**
 * Draws one glyph using dark ink over bar fill and light ink over track.
 * @param {Array<Array<number[]>>} pixels
 * @param {number} x
 * @param {number} y
 * @param {string} char
 * @returns {void}
 */
function drawContrastGlyph(pixels, x, y, char) {
    const glyph = GLYPHS[char] || GLYPHS['!']
    for (let row = 0; row < glyph.length; row += 1) {
        for (let column = 0; column < glyph[row].length; column += 1) {
            if (glyph[row][column] !== 'X') continue
            drawContrastBlock(
                pixels,
                x + column * 2,
                y + row * 2,
                x + column * 2 + 2,
                y + row * 2 + 2
            )
        }
    }
}

/**
 * Measures pixel-font text width.
 * @param {string} value
 * @returns {number}
 */
function measureText(value) {
    const length = String(value).length
    return length === 0 ? 0 : length * 10 + (length - 1) * 2
}

/**
 * Fills a rectangle in pixel coordinates.
 * @param {Array<Array<number[]>>} pixels
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {number[]} color
 * @returns {void}
 */
function fillRect(pixels, x0, y0, x1, y1, color) {
    for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
            pixels[y][x] = color
        }
    }
}

/**
 * Draws a glyph block with contrast selected per destination pixel.
 * @param {Array<Array<number[]>>} pixels
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @returns {void}
 */
function drawContrastBlock(pixels, x0, y0, x1, y1) {
    for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
            pixels[y][x] = isGaugeFillPixel(pixels[y][x])
                ? COLORS.ink
                : COLORS.text
        }
    }
}

/**
 * Returns whether a text pixel currently sits on a filled gauge segment.
 * @param {number[]} pixel
 * @returns {boolean}
 */
function isGaugeFillPixel(pixel) {
    return (
        pixel[3] > 0 &&
        !sameRgb(pixel, COLORS.panel) &&
        !sameRgb(pixel, COLORS.text)
    )
}

/**
 * Compares RGB channels.
 * @param {number[]} left
 * @param {number[]} right
 * @returns {boolean}
 */
function sameRgb(left, right) {
    return left[0] === right[0] && left[1] === right[1] && left[2] === right[2]
}

/**
 * Maps a destination pixel coordinate to the source mask coordinate.
 * @param {number} targetPosition
 * @param {number} targetSize
 * @param {number} sourceSize
 * @returns {number}
 */
function sourceCoordinate(targetPosition, targetSize, sourceSize) {
    if (targetSize <= 1 || sourceSize <= 1) return 0
    return (targetPosition * (sourceSize - 1)) / (targetSize - 1)
}

/**
 * Samples alpha from a mask with bilinear interpolation.
 * @param {{ width: number, height: number, data: Uint8Array }} mask
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
function sampleAlpha(mask, x, y) {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const x1 = Math.min(mask.width - 1, x0 + 1)
    const y1 = Math.min(mask.height - 1, y0 + 1)
    const tx = x - x0
    const ty = y - y0

    const top = lerp(alphaAt(mask, x0, y0), alphaAt(mask, x1, y0), tx)
    const bottom = lerp(alphaAt(mask, x0, y1), alphaAt(mask, x1, y1), tx)
    return lerp(top, bottom, ty)
}

/**
 * Returns one alpha value from a mask.
 * @param {{ width: number, data: Uint8Array }} mask
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
function alphaAt(mask, x, y) {
    return mask.data[y * mask.width + x]
}

/**
 * Interpolates between two numeric values.
 * @param {number} left
 * @param {number} right
 * @param {number} amount
 * @returns {number}
 */
function lerp(left, right, amount) {
    return left + (right - left) * amount
}

/**
 * Encodes RGBA pixels as a PNG buffer.
 * @param {number} width
 * @param {number} height
 * @param {Array<Array<number[]>>} pixels
 * @returns {Buffer}
 */
function encodePng(width, height, pixels) {
    const raw = Buffer.concat(
        pixels.map((row) =>
            Buffer.concat([
                Buffer.from([0]),
                Buffer.from(row.flatMap((pixel) => pixel))
            ])
        )
    )
    return Buffer.concat([
        Buffer.from('89504e470d0a1a0a', 'hex'),
        pngChunk('IHDR', ihdr(width, height)),
        pngChunk('IDAT', deflateSync(raw)),
        pngChunk('IEND', Buffer.alloc(0))
    ])
}

/**
 * Creates an IHDR chunk body.
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
function ihdr(width, height) {
    const body = Buffer.alloc(13)
    body.writeUInt32BE(width, 0)
    body.writeUInt32BE(height, 4)
    body[8] = 8
    body[9] = 6
    return body
}

/**
 * Creates a PNG chunk.
 * @param {string} type
 * @param {Buffer} data
 * @returns {Buffer}
 */
function pngChunk(type, data) {
    const typeBuffer = Buffer.from(type, 'ascii')
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length, 0)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
    return Buffer.concat([length, typeBuffer, data, crc])
}

/**
 * Calculates PNG CRC32.
 * @param {Buffer} buffer
 * @returns {number}
 */
function crc32(buffer) {
    let crc = 0xffffffff
    for (const byte of buffer) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
    }
    return (crc ^ 0xffffffff) >>> 0
}

const CRC_TABLE = Array.from({ length: 256 }, (_value, index) => {
    let crc = index
    for (let bit = 0; bit < 8; bit += 1) {
        crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
    }
    return crc >>> 0
})

/**
 * Loads the real tray template alpha mask so the composite status image uses
 * the same mark as the normal app tray icon.
 * @returns {{ width: number, height: number, data: Uint8Array } | null}
 */
function loadAppIconAlpha() {
    try {
        const image = decodeRgbaPng(
            readFileSync(
                new URL(
                    '../assets/neon-meter-tray-template.png',
                    import.meta.url
                )
            )
        )
        return croppedAlphaMask(image)
    } catch {
        return null
    }
}

/**
 * Decodes the simple RGBA PNG format used by the checked-in tray template.
 * @param {Buffer} buffer
 * @returns {{ width: number, height: number, data: Uint8Array }}
 */
function decodeRgbaPng(buffer) {
    if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
        throw new Error('Unsupported icon PNG')
    }

    let offset = 8
    let width = 0
    let height = 0
    const idat = []

    while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset)
        const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
        const data = buffer.subarray(offset + 8, offset + 8 + length)
        offset += 12 + length

        if (type === 'IHDR') {
            width = data.readUInt32BE(0)
            height = data.readUInt32BE(4)
            if (data[8] !== 8 || data[9] !== 6) {
                throw new Error('Unsupported icon color type')
            }
        } else if (type === 'IDAT') {
            idat.push(data)
        } else if (type === 'IEND') {
            break
        }
    }

    const inflated = inflateSync(Buffer.concat(idat))
    const rowLength = width * 4
    const data = new Uint8Array(width * height * 4)

    for (let y = 0; y < height; y += 1) {
        const sourceOffset = y * (rowLength + 1)
        if (inflated[sourceOffset] !== 0) {
            throw new Error('Unsupported icon PNG filter')
        }
        data.set(
            inflated.subarray(sourceOffset + 1, sourceOffset + 1 + rowLength),
            y * rowLength
        )
    }

    return { width, height, data }
}

/**
 * Extracts the non-transparent icon alpha without template padding.
 * @param {{ width: number, height: number, data: Uint8Array }} image
 * @returns {{ width: number, height: number, data: Uint8Array } | null}
 */
function croppedAlphaMask(image) {
    let minX = image.width
    let maxX = -1
    let minY = image.height
    let maxY = -1

    for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
            const alpha = image.data[(y * image.width + x) * 4 + 3]
            if (alpha === 0) continue
            minX = Math.min(minX, x)
            maxX = Math.max(maxX, x)
            minY = Math.min(minY, y)
            maxY = Math.max(maxY, y)
        }
    }

    if (maxX < minX || maxY < minY) return null

    const width = maxX - minX + 1
    const height = maxY - minY + 1
    const data = new Uint8Array(width * height)

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            data[y * width + x] =
                image.data[((minY + y) * image.width + minX + x) * 4 + 3]
        }
    }

    return { width, height, data }
}

/**
 * Converts a hex color to RGBA.
 * @param {string} value
 * @returns {number[]}
 */
function hexColor(value) {
    const hex = value.replace('#', '')
    return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        255
    ]
}

/**
 * Normalizes short display text.
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function text(value, fallback) {
    const normalized = String(value ?? '').trim()
    return normalized || fallback
}
