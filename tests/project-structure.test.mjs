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
        'src/ble/IpcBleClient.mjs',
        'src/ble/NativeNobleAiMeterClient.mjs',
        'src/core/AppState.mjs',
        'src/core/FirmwarePayload.mjs',
        'src/core/ProviderBundle.mjs',
        'src/electron/NativeBleIpc.mjs',
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

test('native BLE packaging is configured for restart reconnect', async () => {
    const rawPackage = await readFile(new URL('package.json', root), 'utf8')
    const preload = await readFile(
        new URL('src/electron/preload.cjs', root),
        'utf8'
    )
    const main = await readFile(new URL('src/electron/main.mjs', root), 'utf8')
    const pkg = JSON.parse(rawPackage)

    assert.equal(pkg.dependencies['@stoprocent/noble'], '^2.5.3')
    assert.match(main, /new NativeNobleAiMeterClient\(\)/)
    assert.match(main, /registerNativeBleIpc\(/)
    assert.match(preload, /bleConnectRemembered/)
    assert.deepEqual(pkg.build.asarUnpack, ['node_modules/**/*.node'])
    assert.equal(
        pkg.build.mac.extendInfo.NSBluetoothAlwaysUsageDescription,
        'Neon Meter uses Bluetooth to reconnect to your CoreS3 meter and sync local usage status.'
    )
    assert.equal(
        pkg.build.mac.extendInfo.NSBluetoothPeripheralUsageDescription,
        'Neon Meter uses Bluetooth to reconnect to your CoreS3 meter and sync local usage status.'
    )
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
    assert.deepEqual(pkg.author, {
        name: 'André Fiedler',
        email: '83344+SunboX@users.noreply.github.com',
        url: 'https://github.com/SunboX'
    })
})

/**
 * Verifies release automation cannot stop at workflow artifacts only.
 */
test('release workflow uploads installer artifacts to GitHub releases', async () => {
    const workflow = await readFile(
        new URL('.github/workflows/build-installers.yml', root),
        'utf8'
    )

    assert.match(workflow, /tags:\s*\n\s*-\s*'v\*'/)
    assert.match(workflow, /release:\s*\n\s*types:\s*\n\s*-\s*published/)
    assert.match(workflow, /contents:\s*write/)
    assert.match(workflow, /release_tag:/)
    assert.match(workflow, /npm run dist -- --\$\{\{ matrix\.platform \}\}/)
    assert.match(workflow, /gh release upload/)
    assert.match(workflow, /--repo "\$\{GITHUB_REPOSITORY\}"/)
    assert.match(workflow, /--clobber/)
})
