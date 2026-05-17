import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('system window close quits instead of hiding to tray', async () => {
    const main = await readFile(new URL('src/electron/main.mjs', root), 'utf8')

    assert.doesNotMatch(main, /window\.on\('close'/)
    assert.doesNotMatch(main, /event\.preventDefault\(\)/)
    assert.doesNotMatch(main, /window\.hide\(\)/)
    assert.match(
        main,
        /app\.on\('window-all-closed',\s*\(\)\s*=>\s*{\s*app\.quit\(\)\s*}\s*\)/s
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
        /app\.on\('before-quit',\s*\(\)\s*=>\s*{\s*deviceClient\.disconnect\(\)\s*}\s*\)/s
    )
})
