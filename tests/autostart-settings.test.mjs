import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
    LINUX_AUTOSTART_FILE,
    createLoginItemSettings,
    getLinuxAutostartPath,
    setAutostartEnabled
} from '../src/electron/AutostartSettings.mjs'

test('createLoginItemSettings enables Electron login items on Windows', () => {
    const settings = createLoginItemSettings(true, {
        platform: 'win32',
        executable: 'C:\\Program Files\\Neon Meter\\Neon Meter.exe',
        args: ['--relay']
    })

    assert.deepEqual(settings, {
        openAtLogin: true,
        path: 'C:\\Program Files\\Neon Meter\\Neon Meter.exe',
        args: ['--relay'],
        enabled: true,
        name: 'Neon Meter'
    })
})

test('createLoginItemSettings enables Electron login items on macOS', () => {
    assert.deepEqual(
        createLoginItemSettings(true, {
            platform: 'darwin',
            executable:
                '/Applications/Neon Meter.app/Contents/MacOS/Neon Meter',
            args: ['ignored-on-macos']
        }),
        { openAtLogin: true }
    )
})

test('setAutostartEnabled writes a Linux XDG autostart entry', async () => {
    const configHome = await mkdtemp(path.join(tmpdir(), 'neon-meter-xdg-'))

    const status = await setAutostartEnabled(true, {
        platform: 'linux',
        env: { XDG_CONFIG_HOME: configHome },
        executable: '/opt/Neon Meter/neon-meter',
        args: ['/home/user/Neon Meter Host']
    })

    const desktopPath = getLinuxAutostartPath({
        env: { XDG_CONFIG_HOME: configHome }
    })
    const desktopFile = await readFile(desktopPath, 'utf8')

    assert.equal(status.supported, true)
    assert.equal(status.openAtLogin, true)
    assert.equal(path.basename(desktopPath), LINUX_AUTOSTART_FILE)
    assert.match(desktopFile, /Type=Application/)
    assert.match(desktopFile, /Name=Neon Meter/)
    assert.match(
        desktopFile,
        /Exec="\/opt\/Neon Meter\/neon-meter" "\/home\/user\/Neon Meter Host"/
    )
    assert.match(desktopFile, /X-GNOME-Autostart-enabled=true/)
})

test('setAutostartEnabled removes the Linux XDG autostart entry', async () => {
    const configHome = await mkdtemp(path.join(tmpdir(), 'neon-meter-xdg-'))
    const options = {
        platform: 'linux',
        env: { XDG_CONFIG_HOME: configHome },
        executable: '/usr/bin/neon-meter',
        args: []
    }

    await setAutostartEnabled(true, options)
    const status = await setAutostartEnabled(false, options)

    assert.equal(status.supported, true)
    assert.equal(status.openAtLogin, false)
    await assert.rejects(
        readFile(getLinuxAutostartPath({ env: options.env }), 'utf8')
    )
})
