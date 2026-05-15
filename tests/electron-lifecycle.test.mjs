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
