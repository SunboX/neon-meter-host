import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import test from 'node:test'

const root = new URL('../', import.meta.url)

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

/**
 * Verifies mandatory project files.
 */
test('required project files exist', async () => {
    const required = [
        'README.md',
        'AGENTS.md',
        'package.json',
        'spec/web-app-specification.md',
        'specs/host-daemon.md',
        'docs/getting-started.md',
        'docs/ble-protocol.md',
        'docs/providers.md',
        'docs/architecture.md',
        'docs/testing.md',
        'docs/security.md',
        'docs/troubleshooting.md',
        'src/index.html',
        'src/main.mjs',
        'src/style.css',
        'src/server.mjs',
        'src/electron/main.mjs',
        'src/electron/preload.cjs',
        'src/ble/WebBluetoothAiMeterClient.mjs',
        'src/core/AppState.mjs',
        'src/core/FirmwarePayload.mjs',
        'src/core/ProviderBundle.mjs',
        'src/providers/ClaudeCodeUsageProvider.mjs',
        'src/providers/ChatGptUsageProvider.mjs',
        'src/ui/AppView.mjs',
        'scripts/run-tests.mjs',
        'tests/app-state.test.mjs',
        'tests/project-structure.test.mjs',
        'tests/mjs-line-limit.test.mjs',
        'src/I18n.mjs',
        'src/i18n/en.json',
        'src/i18n/de.json'
    ]

    for (const relativePath of required) {
        assert.equal(
            await exists(relativePath),
            true,
            'Missing file: ' + relativePath
        )
    }
})

/**
 * Verifies core npm scripts are present.
 */
test('package scripts include start and test', async () => {
    const raw = await readFile(new URL('package.json', root), 'utf8')
    const pkg = JSON.parse(raw)

    assert.equal(typeof pkg.scripts?.start, 'string')
    assert.equal(typeof pkg.scripts?.test, 'string')
    assert.equal(pkg.scripts.start, 'node scripts/start-neon-meter.mjs')
    assert.equal(pkg.scripts.dev, 'node scripts/start-neon-meter.mjs')
    assert.equal(pkg.scripts.test, 'node scripts/run-tests.mjs')
})
