import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('system window close hides to tray instead of quitting', async () => {
    const main = await readFile(new URL('src/electron/main.mjs', root), 'utf8')

    assert.match(main, /let isQuitting = false/)
    assert.match(
        main,
        /window\.on\('close',\s*\(event\)\s*=>\s*{\s*if \(isQuitting\) return\s*event\.preventDefault\(\)\s*hideMainWindow\(\)\s*}\)/s
    )
    assert.match(
        main,
        /app\.on\('before-quit',\s*\(\)\s*=>\s*{\s*isQuitting = true\s*deviceClient\.disconnect\(\)\s*}\s*\)/s
    )
})

test('tray menu can hide or show Neon Meter and sync the macOS Dock', async () => {
    const main = await readFile(new URL('src/electron/main.mjs', root), 'utf8')

    assert.match(main, /function showMainWindow\(\)/)
    assert.match(main, /function hideMainWindow\(\)/)
    assert.match(main, /app\.dock\.show\(\)/)
    assert.match(main, /app\.dock\.hide\(\)/)
    assert.match(
        main,
        /label:\s*mainWindow\?\.isVisible\(\)\s*\?\s*'Hide Neon Meter'\s*:\s*'Show Neon Meter'/s
    )
    assert.match(
        main,
        /click:\s*\(\)\s*=>\s*(?:\(\s*)?mainWindow\?\.isVisible\(\)\s*\?\s*hideMainWindow\(\)\s*:\s*showMainWindow\(\)\s*(?:\))?/s
    )
})

test('tray menu can hide or show quota status without changing sync', async () => {
    const main = await readFile(new URL('src/electron/main.mjs', root), 'utf8')

    assert.match(main, /isTrayQuotaStatusVisible/)
    assert.match(main, /buildTrayQuotaStatus/)
    assert.match(main, /let trayQuotaStatusVisible = true/)
    assert.match(main, /let latestProviderBundle = null/)
    assert.match(main, /showTrayQuotaStatus/)
    assert.match(main, /Hide quota status/)
    assert.match(main, /Show quota status/)
    assert.match(main, /function setTrayQuotaStatusVisible/)
    assert.match(main, /tray\.setTitle/)
    assert.match(main, /nativeImage\.createFromBuffer/)
    assert.match(main, /imageScaleFactor/)
    assert.match(main, /tray\.setImage\(createTrayIcon\(\)\)/)
    assert.match(main, /latestProviderBundle = bundle/)
})

test('renderer settings saves preserve the main-process tray quota visibility', async () => {
    const main = await readFile(new URL('src/electron/main.mjs', root), 'utf8')

    assert.match(
        main,
        /ipcMain\.handle\('settings:save', async \(_event, settings\) =>\s*writeRendererSettings\(settings\)\s*\)/s
    )
    assert.match(main, /function writeRendererSettings\(settings\)/)
    assert.match(main, /showTrayQuotaStatus: trayQuotaStatusVisible/)
})

test('startup can keep the main window and macOS Dock hidden from persisted settings', async () => {
    const main = await readFile(new URL('src/electron/main.mjs', root), 'utf8')

    assert.match(main, /const settings = await readSettings\(\)/)
    assert.match(main, /startHidden: settings\.startHidden === true/)
    assert.match(
        main,
        /window\.once\('ready-to-show',\s*\(\)\s*=>\s*{\s*if \(startHidden\) {\s*hideMainWindow\(\)\s*return\s*}\s*showMainWindow\(\)\s*}\)/s
    )
})

test('hidden daemon window keeps reconnect timers active', async () => {
    const main = await readFile(new URL('src/electron/main.mjs', root), 'utf8')

    assert.match(main, /backgroundThrottling:\s*false/)
})

test('app quit explicitly disconnects native device transports before process exit', async () => {
    const main = await readFile(new URL('src/electron/main.mjs', root), 'utf8')

    assert.match(
        main,
        /app\.on\('before-quit',\s*\(\)\s*=>\s*{\s*isQuitting = true\s*deviceClient\.disconnect\(\)\s*}\s*\)/s
    )
})
