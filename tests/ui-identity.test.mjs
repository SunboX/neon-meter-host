import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { promisify } from 'node:util'
import { inflateSync } from 'node:zlib'

const root = new URL('../', import.meta.url)
const execFileAsync = promisify(execFile)

/**
 * Reads a project-relative file.
 * @param {string} relativePath
 * @returns {Promise<string>}
 */
async function source(relativePath) {
    return readFile(new URL(relativePath, root), 'utf8')
}

/**
 * Checks whether a project-relative file exists.
 * @param {string} relativePath
 * @returns {Promise<boolean>}
 */
async function exists(relativePath) {
    try {
        await access(new URL(relativePath, root), constants.F_OK)
        return true
    } catch {
        return false
    }
}

test('renderer exposes Neon Meter identity and icon metadata', async () => {
    const html = await source('src/index.html')

    assert.match(html, /<title>Neon Meter<\/title>/)
    assert.match(html, /rel="icon"/)
    assert.match(html, /neon-meter-icon\.svg/)
    assert.match(html, /class="neon-meter-app"/)
    assert.match(html, /class="brand-icon"/)
    assert.match(html, /src="assets\/neon-meter-icon\.png"/)
    assert.match(html, /<h1>Neon Meter<\/h1>/)
    assert.match(html, /Usage relay/)
    assert.match(html, /Neon Meter CoreS3/)
})

test('minimal neon theme tokens and surfaces are present', async () => {
    const core = await source('src/styles/00-core.css')
    const layout = await source('src/styles/10-layout.css')

    assert.match(core, /--bg-primary:\s*#050914/)
    assert.match(core, /--accent-cyan:\s*#00f5ff/)
    assert.match(core, /--accent-orange:\s*#ff6a00/)
    assert.match(core, /body\.neon-meter-app/)
    assert.match(core, /repeating-linear-gradient/)
    assert.match(layout, /\.brand-icon/)
    assert.doesNotMatch(layout, /\.brand-mark::before/)
    assert.match(layout, /#payloadPreview/)
    assert.match(layout, /box-shadow:\s*0 0 18px/)
})

test('project includes runtime icon assets', async () => {
    assert.equal(await exists('src/assets/neon-meter-icon.svg'), true)
    assert.equal(await exists('src/assets/neon-meter-icon.png'), true)
    assert.equal(await exists('src/assets/neon-meter-tray.png'), true)
    assert.equal(await exists('src/assets/neon-meter-tray-template.png'), true)
    assert.equal(await exists('src/assets/neon-meter-icon.icns'), true)
})

test('runtime icon png uses transparent corners without white matte', async () => {
    const icon = decodePng(
        await readFile(new URL('src/assets/neon-meter-icon.png', root))
    )
    const tray = decodePng(
        await readFile(new URL('src/assets/neon-meter-tray.png', root))
    )
    const trayTemplate = decodePng(
        await readFile(new URL('src/assets/neon-meter-tray-template.png', root))
    )

    assert.equal(icon.width, 512)
    assert.equal(icon.height, 512)
    assert.equal(tray.width, 32)
    assert.equal(tray.height, 32)
    assert.equal(trayTemplate.width, 32)
    assert.equal(trayTemplate.height, 32)
    assert.equal(pixel(icon, 0, 0).a, 0)
    assert.equal(pixel(icon, icon.width - 1, 0).a, 0)
    assert.equal(pixel(icon, 0, icon.height - 1).a, 0)
    assert.equal(pixel(icon, icon.width - 1, icon.height - 1).a, 0)
    assert.ok(pixel(icon, 256, 256).a > 240)
    assert.equal(pixel(tray, 0, 0).a, 0)
    assert.ok(pixel(tray, 16, 16).a > 220)
    assert.equal(pixel(trayTemplate, 0, 0).a, 0)
    assert.equal(pixel(trayTemplate, 2, 16).a, 0)
    assert.equal(pixel(trayTemplate, 16, 29).a, 0)
    assert.ok(pixel(trayTemplate, 12, 22).a > 160)
    assert.ok(pixel(trayTemplate, 16, 16).a > 160)
    assert.ok(pixel(trayTemplate, 20, 9).a > 160)
})

test('electron runtime uses Neon Meter name and icon assets', async () => {
    const main = await source('src/electron/main.mjs')

    assert.match(main, /const APP_NAME = 'Neon Meter'/)
    assert.match(main, /function getIconPath/)
    assert.match(main, /app\.setName\(APP_NAME\)/)
    assert.match(main, /title: APP_NAME/)
    assert.match(main, /backgroundColor:\s*'#050914'/)
    assert.match(main, /icon: getIconPath\('neon-meter-icon\.png'\)/)
    assert.match(main, /app\.dock\.setIcon/)
    assert.match(main, /function createTrayIcon/)
    assert.match(main, /neon-meter-tray-template\.png/)
    assert.match(main, /trayIcon\.setTemplateImage\(true\)/)
    assert.match(main, /new Tray\(trayIcon\)/)
    assert.match(main, /tray\.setToolTip\(APP_NAME\)/)
    assert.match(main, /Show Neon Meter/)
})

test('package metadata exposes Neon Meter product name', async () => {
    const raw = await source('package.json')
    const pkg = JSON.parse(raw)

    assert.equal(pkg.productName, 'Neon Meter')
    assert.equal(pkg.scripts.start, 'node scripts/start-neon-meter.mjs')
    assert.equal(pkg.scripts.dev, 'node scripts/start-neon-meter.mjs')
    assert.equal(
        pkg.scripts['assets:icons'],
        'node scripts/generate-neon-meter-icons.mjs'
    )
})

test('dev launcher prepares a renamed Electron app bundle for macOS Dock labels', async () => {
    const launcher = await source('scripts/start-neon-meter.mjs')

    assert.match(launcher, /\$\{APP_NAME\}\.app/)
    assert.doesNotMatch(
        launcher,
        /const targetApp = path\.join\(runtimeDir, 'ElectronRuntime\.app'\)/
    )
    assert.match(launcher, /CFBundleDisplayName/)
    assert.match(launcher, /CFBundleName/)
    assert.match(launcher, /CFBundleExecutable/)
    assert.match(launcher, /CFBundleIdentifier/)
    assert.match(launcher, /neon-meter-icon\.icns/)
    assert.match(launcher, /ELECTRON_RUN_AS_NODE/)
    assert.match(launcher, /getDarwinOpenArgs/)
    assert.match(launcher, /\/usr\/bin\/open/)
    assert.doesNotMatch(launcher, /OPENAI_ADMIN_KEY/)
    assert.match(launcher, /verbatimSymlinks:\s*true/)
    assert.match(launcher, /BUNDLE_COPY_MODE = 'verbatim-symlinks'/)
    assert.match(launcher, /bundleCopyMode:\s*BUNDLE_COPY_MODE/)
})

test('prepared macOS runtime bundle exposes Neon Meter identity to Launch Services', async (t) => {
    if (process.platform !== 'darwin') {
        t.skip('macOS app bundle metadata only exists on Darwin')
        return
    }

    await execFileAsync(process.execPath, [
        'scripts/start-neon-meter.mjs',
        '--prepare-only'
    ])

    const appBundle = new URL('.electron-runtime/Neon Meter.app/', root)
    const infoPlist = fileURLToPath(new URL('Contents/Info.plist', appBundle))
    const executable = new URL('Contents/MacOS/Neon Meter', appBundle)

    const plistValue = async (key) => {
        const { stdout } = await execFileAsync('/usr/libexec/PlistBuddy', [
            '-c',
            `Print :${key}`,
            infoPlist
        ])
        return stdout.trim()
    }

    assert.equal(await plistValue('CFBundleDisplayName'), 'Neon Meter')
    assert.equal(await plistValue('CFBundleName'), 'Neon Meter')
    assert.equal(await plistValue('CFBundleExecutable'), 'Neon Meter')
    await access(executable, constants.X_OK)
})

test('default rendered hardware label names Neon Meter CoreS3', async () => {
    const view = await source('src/ui/AppView.mjs')

    assert.match(view, /snapshot\.ble\.deviceName \|\| 'Neon Meter CoreS3'/)
})

test('settings are edited through a persistent settings dialog', async () => {
    const html = await source('src/index.html')
    const view = await source('src/ui/AppView.mjs')
    const controller = await source('src/AppController.mjs')

    assert.match(html, /<dialog id="settingsDialog"/)
    assert.match(html, /id="settingsForm"/)
    assert.match(html, /id="settingsButton"/)
    assert.match(html, /id="settingsSaveButton"/)
    assert.match(html, /id="rotationSecondsInput"/)
    assert.match(html, /id="startHiddenInput"/)
    assert.match(html, /Start hidden by default/)
    assert.match(html, /Auto-detect/)
    assert.doesNotMatch(html, /id="providerSelect"/)
    assert.doesNotMatch(html, /OpenAI Admin Key/)
    assert.doesNotMatch(html, /manual estimate/)
    assert.match(view, /openSettingsDialog\(\)/)
    assert.match(view, /bindSettingsSave/)
    assert.match(view, /#startHiddenInput/)
    assert.match(view, /startHidden: this\.\#checked\('#startHiddenInput'\)/)
    assert.doesNotMatch(view, /openAiAdminKey/)
    assert.match(controller, /normalizePersistedSettings/)
    assert.match(controller, /createPersistedSettings/)
    assert.match(controller, /fetchProviderBundle/)
    assert.doesNotMatch(controller, /persisted\.isFirstRun/)
    assert.doesNotMatch(controller, /saveOpenAiKey/)
    assert.doesNotMatch(controller, /ManualUsageProvider/)
})

test('mobile header stacks brand and toolbar to preserve title width', async () => {
    const layout = await source('src/styles/10-layout.css')

    assert.match(
        layout,
        /@media \(max-width: 860px\)[\s\S]*\.topbar\s*{[\s\S]*flex-direction:\s*column/
    )
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
    let bitDepth = 0
    let colorType = 0
    const idat = []

    while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset)
        const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
        const data = buffer.subarray(offset + 8, offset + 8 + length)
        offset += 12 + length

        if (type === 'IHDR') {
            width = data.readUInt32BE(0)
            height = data.readUInt32BE(4)
            bitDepth = data[8]
            colorType = data[9]
        } else if (type === 'IDAT') {
            idat.push(data)
        } else if (type === 'IEND') {
            break
        }
    }

    assert.equal(bitDepth, 8)
    assert.equal(colorType, 6)

    const channels = 4
    const stride = width * channels
    const inflated = inflateSync(Buffer.concat(idat))
    const pixels = new Uint8Array(width * height * channels)
    let inputOffset = 0
    let outputOffset = 0
    let previous = new Uint8Array(stride)

    for (let y = 0; y < height; y += 1) {
        const filter = inflated[inputOffset]
        inputOffset += 1
        const row = Uint8Array.from(
            inflated.subarray(inputOffset, inputOffset + stride)
        )
        inputOffset += stride

        unfilterRow(row, previous, filter, channels)
        pixels.set(row, outputOffset)
        previous = row
        outputOffset += stride
    }

    return { width, height, data: pixels }
}

/**
 * Applies PNG scanline unfiltering in place.
 * @param {Uint8Array} row
 * @param {Uint8Array} previous
 * @param {number} filter
 * @param {number} bytesPerPixel
 * @returns {void}
 */
function unfilterRow(row, previous, filter, bytesPerPixel) {
    for (let index = 0; index < row.length; index += 1) {
        const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0
        const up = previous[index] || 0
        const upLeft =
            index >= bytesPerPixel ? previous[index - bytesPerPixel] || 0 : 0

        if (filter === 1) {
            row[index] = (row[index] + left) & 0xff
        } else if (filter === 2) {
            row[index] = (row[index] + up) & 0xff
        } else if (filter === 3) {
            row[index] = (row[index] + Math.floor((left + up) / 2)) & 0xff
        } else if (filter === 4) {
            row[index] = (row[index] + paeth(left, up, upLeft)) & 0xff
        } else {
            assert.equal(filter, 0)
        }
    }
}

/**
 * PNG Paeth predictor.
 * @param {number} left
 * @param {number} up
 * @param {number} upLeft
 * @returns {number}
 */
function paeth(left, up, upLeft) {
    const estimate = left + up - upLeft
    const leftDistance = Math.abs(estimate - left)
    const upDistance = Math.abs(estimate - up)
    const upLeftDistance = Math.abs(estimate - upLeft)

    if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
        return left
    }
    if (upDistance <= upLeftDistance) return up
    return upLeft
}

/**
 * Returns an RGBA pixel.
 * @param {{ width: number, data: Uint8Array }} image
 * @param {number} x
 * @param {number} y
 * @returns {{ r: number, g: number, b: number, a: number }}
 */
function pixel(image, x, y) {
    const index = (y * image.width + x) * 4
    return {
        r: image.data[index],
        g: image.data[index + 1],
        b: image.data[index + 2],
        a: image.data[index + 3]
    }
}
