import assert from 'node:assert/strict'
import test from 'node:test'
import { inflateSync } from 'node:zlib'
import {
    buildTrayQuotaStatus,
    isTrayQuotaStatusVisible
} from '../src/electron/TrayQuotaStatus.mjs'

test('tray quota status is visible unless explicitly hidden', () => {
    assert.equal(isTrayQuotaStatusVisible({}), true)
    assert.equal(isTrayQuotaStatusVisible({ showTrayQuotaStatus: true }), true)
    assert.equal(
        isTrayQuotaStatusVisible({ showTrayQuotaStatus: false }),
        false
    )
})

test('buildTrayQuotaStatus summarizes provider utilization for the tray', () => {
    const summary = buildTrayQuotaStatus(
        {
            providers: [
                {
                    p: 'claude',
                    title: 'Claude Code',
                    s: 46,
                    sl: 'Session',
                    sr: 120,
                    w: 12,
                    wl: 'Weekly',
                    wr: 3000,
                    st: 'allowed',
                    detail: '5h 46% / 7d 12%',
                    ok: true
                },
                {
                    p: 'chatgpt',
                    title: 'ChatGPT',
                    s: 84,
                    sl: 'Session',
                    sr: -1,
                    w: 91,
                    wl: 'Weekly',
                    wr: 300,
                    st: 'ok',
                    detail: '5h 84% / 7d 91%',
                    ok: true
                }
            ]
        },
        { appName: 'Neon Meter' }
    )

    assert.equal(summary.title, 'S 16% · W 9%')
    assert.equal(typeof summary.imagePngBase64, 'string')
    assert.equal(summary.imageScaleFactor, 2)
    assert.deepEqual(summary.gauges, [
        {
            label: 'S',
            valueText: '16%',
            fillPercent: 16,
            color: '#ff5d5d'
        },
        {
            label: 'W',
            valueText: '9%',
            fillPercent: 9,
            color: '#ff5d5d'
        }
    ])
    assert.deepEqual(
        Buffer.from(summary.imagePngBase64, 'base64').subarray(0, 8),
        Buffer.from('89504e470d0a1a0a', 'hex')
    )
    assert.match(summary.tooltip, /^Neon Meter\nClaude Code: /)
    assert.match(summary.tooltip, /Session 54% \(2h left\)/)
    assert.match(summary.tooltip, /Weekly 9% \(5h left\)/)
    assert.deepEqual(
        summary.menuItems.map((item) => item.label),
        [
            'Quota status',
            'Claude Code: Session 54% / Weekly 88%',
            'ChatGPT: Session 16% / Weekly 9%'
        ]
    )
})

test('buildTrayQuotaStatus omits Session when it is unavailable', () => {
    const summary = buildTrayQuotaStatus({
        providers: [
            {
                p: 'chatgpt',
                title: 'ChatGPT',
                se: false,
                s: 0,
                sl: 'Session',
                sr: -1,
                w: 52,
                wl: 'Weekly',
                wr: 7942,
                st: 'ok',
                detail: '7d 52%',
                ok: true
            }
        ]
    })

    assert.equal(summary.title, 'W 48%')
    assert.deepEqual(summary.gauges, [
        {
            label: 'W',
            valueText: '48%',
            fillPercent: 48,
            color: '#ffd75e'
        }
    ])
    assert.match(summary.tooltip, /ChatGPT: Weekly 48% \(5d 12h left\)/)
    assert.doesNotMatch(summary.tooltip, /Session/)
    assert.equal(summary.menuItems[1].label, 'ChatGPT: Weekly 48%')
})

test('buildTrayQuotaStatus mirrors Neon Meter remaining capacity gauges', () => {
    const summary = buildTrayQuotaStatus({
        providers: [
            {
                p: 'claude',
                title: 'Claude Code',
                s: 7,
                sl: 'Session',
                sr: 120,
                w: 1,
                wl: 'Weekly',
                wr: 3000,
                st: 'allowed',
                detail: '5h 7% / 7d 1%',
                ok: true
            }
        ]
    })

    assert.equal(summary.title, 'S 93% · W 99%')
    assert.deepEqual(summary.gauges, [
        {
            label: 'S',
            valueText: '93%',
            fillPercent: 93,
            color: '#6dffa8'
        },
        {
            label: 'W',
            valueText: '99%',
            fillPercent: 99,
            color: '#6dffa8'
        }
    ])

    const image = decodePng(Buffer.from(summary.imagePngBase64, 'base64'))
    const firstBarX = 64
    const secondBarX = 176
    const iconBounds = opaqueBounds(image, 0, 0, 38, image.height)

    assert.ok(iconBounds)
    assert.ok(iconBounds.width >= 32)
    assert.ok(iconBounds.height >= 25)
    assert.equal(gapBetween(iconBounds, opaqueBounds(image, 34, 0, 64, 20)), 10)
    assert.deepEqual(rgb(pixel(image, 20, 8)), [255, 255, 255])
    assert.deepEqual(rgb(pixel(image, firstBarX + 6, 16)), [109, 255, 168])
    assert.deepEqual(rgb(pixel(image, firstBarX + 73, 16)), [16, 38, 56])
    assert.deepEqual(rgb(pixel(image, secondBarX + 46, 16)), [109, 255, 168])
    assert.deepEqual(rgb(pixel(image, firstBarX + 24, 10)), [0, 0, 0])
})

test('buildTrayQuotaStatus renders exhausted windows as empty capacity', () => {
    const summary = buildTrayQuotaStatus({
        providers: [
            {
                p: 'claude',
                title: 'Claude Code',
                s: 100,
                sl: 'Session',
                sr: 268,
                w: 88,
                wl: 'Weekly',
                wr: 1440,
                st: 'limited',
                detail: '5h 100% / 7d 88%',
                ok: true
            }
        ]
    })

    assert.equal(summary.title, 'S 0% · W 12%')
    assert.equal(summary.gauges[0].label, 'S')
    assert.equal(summary.gauges[0].valueText, '0%')
    assert.equal(summary.gauges[0].fillPercent, 0)
    assert.equal(summary.gauges[0].color, '#ff5d5d')
    assert.match(
        summary.menuItems[1].label,
        /Claude Code: Session limit reached \(4h 28m left\)/
    )
})

test('buildTrayQuotaStatus uses percent when an exhausted reset is unavailable', () => {
    const summary = buildTrayQuotaStatus({
        providers: [
            {
                p: 'claude',
                title: 'Claude Code',
                s: 100,
                sl: 'Session',
                sr: -1,
                w: 20,
                wl: 'Weekly',
                wr: -1,
                st: 'limited',
                detail: '5h 100% / 7d 20%',
                ok: true
            }
        ]
    })

    assert.equal(summary.title, 'S 0% · W 80%')
})

test('buildTrayQuotaStatus renders used percent as remaining capacity', () => {
    const summary = buildTrayQuotaStatus({
        providers: [
            {
                p: 'claude',
                title: 'Claude Code',
                s: 2,
                sl: 'Session',
                sr: 31 * 60 + 32,
                w: 56,
                wl: 'Weekly',
                wr: 2400,
                st: 'limited',
                detail: '5h 98% / 7d 56%',
                ok: true
            }
        ]
    })

    assert.equal(summary.title, 'S 98% · W 44%')
    assert.deepEqual(summary.gauges, [
        {
            label: 'S',
            valueText: '98%',
            fillPercent: 98,
            color: '#6dffa8'
        },
        {
            label: 'W',
            valueText: '44%',
            fillPercent: 44,
            color: '#ffd75e'
        }
    ])

    const image = decodePng(Buffer.from(summary.imagePngBase64, 'base64'))
    const firstBarX = 64
    const secondBarX = 176

    assert.ok(image.width >= 240)
    assert.ok(pixel(image, 20, 8).a > 0)
    assert.deepEqual(rgb(pixel(image, 20, 8)), [255, 255, 255])
    assert.deepEqual(rgb(pixel(image, firstBarX + 6, 16)), [109, 255, 168])
    assert.deepEqual(rgb(pixel(image, firstBarX + 24, 10)), [0, 0, 0])
    assert.deepEqual(rgb(pixel(image, secondBarX + 6, 16)), [255, 215, 94])
    assert.deepEqual(rgb(pixel(image, secondBarX + 28, 10)), [0, 0, 0])
    assert.deepEqual(rgb(pixel(image, secondBarX + 40, 10)), [223, 247, 255])
    assert.deepEqual(rgb(pixel(image, secondBarX + 60, 16)), [16, 38, 56])
})

test('buildTrayQuotaStatus treats reset-due windows as fresh capacity', () => {
    const summary = buildTrayQuotaStatus({
        providers: [
            {
                p: 'chatgpt',
                title: 'ChatGPT',
                s: 100,
                sl: 'Session',
                sr: 0,
                w: 87,
                wl: 'Weekly',
                wr: 5,
                st: 'ok',
                ok: true
            }
        ]
    })

    assert.equal(summary.title, 'S 100% · W 13%')
    assert.equal(summary.gauges[0].fillPercent, 100)
    assert.equal(summary.gauges[0].color, '#6dffa8')
    assert.equal(summary.gauges[1].fillPercent, 13)
    assert.equal(summary.gauges[1].color, '#ff5d5d')
})

test('buildTrayQuotaStatus falls back before the first provider sync', () => {
    const summary = buildTrayQuotaStatus(null, { appName: 'Neon Meter' })

    assert.equal(summary.title, '')
    assert.equal(Object.hasOwn(summary, 'imagePngBase64'), false)
    assert.equal(summary.tooltip, 'Neon Meter\nQuota status waiting for sync')
    assert.deepEqual(summary.menuItems, [
        {
            label: 'Quota status waiting for sync',
            enabled: false
        }
    ])
})

/**
 * Decodes a non-interlaced RGBA PNG.
 * @param {Buffer} buffer
 * @returns {{ width: number, height: number, data: Uint8Array }}
 */
function decodePng(buffer) {
    assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')

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
        assert.equal(inflated[sourceOffset], 0)
        data.set(
            inflated.subarray(sourceOffset + 1, sourceOffset + 1 + rowLength),
            y * rowLength
        )
    }

    return { width, height, data }
}

/**
 * Reads one RGBA pixel.
 * @param {{ width: number, data: Uint8Array }} image
 * @param {number} x
 * @param {number} y
 * @returns {{ r: number, g: number, b: number, a: number }}
 */
function pixel(image, x, y) {
    const offset = (y * image.width + x) * 4
    return {
        r: image.data[offset],
        g: image.data[offset + 1],
        b: image.data[offset + 2],
        a: image.data[offset + 3]
    }
}

/**
 * Returns RGB components for assertions.
 * @param {{ r: number, g: number, b: number }} value
 * @returns {number[]}
 */
function rgb(value) {
    return [value.r, value.g, value.b]
}

/**
 * Returns the non-transparent bounds within a region.
 * @param {{ width: number, height: number, data: Uint8Array }} image
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
function opaqueBounds(image, x0, y0, x1, y1) {
    let minX = x1
    let maxX = x0 - 1
    let minY = y1
    let maxY = y0 - 1

    for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
            if (pixel(image, x, y).a === 0) continue
            minX = Math.min(minX, x)
            maxX = Math.max(maxX, x)
            minY = Math.min(minY, y)
            maxY = Math.max(maxY, y)
        }
    }

    if (maxX < minX || maxY < minY) return null
    return {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1
    }
}

/**
 * Returns horizontal transparent pixels between two opaque bounds.
 * @param {{ x: number, width: number }} left
 * @param {{ x: number, width: number } | null} right
 * @returns {number}
 */
function gapBetween(left, right) {
    assert.ok(right)
    return right.x - (left.x + left.width)
}
