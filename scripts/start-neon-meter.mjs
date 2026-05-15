import {
    cp,
    mkdir,
    readFile,
    rename,
    rm,
    stat,
    writeFile
} from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.join(__dirname, '..')
const APP_NAME = 'Neon Meter'
const BUNDLE_IDENTIFIER = 'com.andreswerkstatt.neon-meter-host'
const BUNDLE_COPY_MODE = 'verbatim-symlinks'

const appBundle = await prepareRuntime()

if (process.argv.includes('--prepare-only')) {
    process.exit(0)
}

const launch = getLaunchCommand(appBundle)
const child = spawn(launch.command, launch.args, {
    cwd: projectRoot,
    env: getElectronEnv(),
    stdio: 'inherit'
})

child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    process.exit(code ?? 0)
})

/**
 * Prepares a renamed macOS Electron app bundle.
 * @returns {Promise<string | null>}
 */
async function prepareRuntime() {
    if (process.platform !== 'darwin') return null

    const sourceApp = path.join(
        projectRoot,
        'node_modules',
        'electron',
        'dist',
        'Electron.app'
    )
    const runtimeDir = path.join(projectRoot, '.electron-runtime')
    const targetApp = path.join(runtimeDir, `${APP_NAME}.app`)
    const legacyTargetApps = [
        path.join(runtimeDir, 'ElectronRuntime.app'),
        path.join(runtimeDir, 'NeonMeter.app')
    ]
    const markerPath = path.join(
        targetApp,
        'Contents',
        'Resources',
        'neon-meter-runtime.json'
    )
    const iconPath = path.join(
        projectRoot,
        'src',
        'assets',
        'neon-meter-icon.icns'
    )
    const manifest = await createManifest(sourceApp, iconPath)

    await Promise.all(
        legacyTargetApps.map((legacyTargetApp) =>
            rm(legacyTargetApp, { recursive: true, force: true })
        )
    )

    if ((await readManifest(markerPath)) !== JSON.stringify(manifest)) {
        await rm(targetApp, { recursive: true, force: true })
        await mkdir(runtimeDir, { recursive: true })
        await cp(sourceApp, targetApp, {
            recursive: true,
            verbatimSymlinks: true
        })
        await patchBundle(targetApp, iconPath)
        await writeFile(markerPath, JSON.stringify(manifest), 'utf8')
    }

    return targetApp
}

/**
 * Resolves the command used to launch the app.
 * @param {string | null} preparedAppBundle
 * @returns {{ command: string, args: string[] }}
 */
function getLaunchCommand(preparedAppBundle) {
    if (process.platform === 'darwin' && preparedAppBundle) {
        return {
            command: '/usr/bin/open',
            args: getDarwinOpenArgs(preparedAppBundle)
        }
    }

    return {
        command: getElectronExecutable(preparedAppBundle),
        args: ['.']
    }
}

/**
 * Returns Launch Services args for the prepared macOS bundle.
 * @param {string} appBundle
 * @returns {string[]}
 */
function getDarwinOpenArgs(appBundle) {
    return ['-n', '-W', appBundle, '--args', projectRoot]
}

/**
 * Creates a runtime manifest used to refresh the copied bundle.
 * @param {string} sourceApp
 * @param {string} iconPath
 * @returns {Promise<object>}
 */
async function createManifest(sourceApp, iconPath) {
    const sourceInfo = await stat(
        path.join(sourceApp, 'Contents', 'Info.plist')
    )
    const iconInfo = await stat(iconPath)

    return {
        appName: APP_NAME,
        bundleIdentifier: BUNDLE_IDENTIFIER,
        bundleCopyMode: BUNDLE_COPY_MODE,
        executableName: APP_NAME,
        electronInfoMtimeMs: sourceInfo.mtimeMs,
        iconMtimeMs: iconInfo.mtimeMs
    }
}

/**
 * Reads a runtime manifest.
 * @param {string} markerPath
 * @returns {Promise<string>}
 */
async function readManifest(markerPath) {
    try {
        return await readFile(markerPath, 'utf8')
    } catch (_error) {
        return ''
    }
}

/**
 * Patches the copied Electron bundle so macOS labels it as Neon Meter.
 * @param {string} targetApp
 * @param {string} iconPath
 * @returns {Promise<void>}
 */
async function patchBundle(targetApp, iconPath) {
    const infoPlist = path.join(targetApp, 'Contents', 'Info.plist')
    const macOsDir = path.join(targetApp, 'Contents', 'MacOS')
    const resourcesDir = path.join(targetApp, 'Contents', 'Resources')

    await cp(iconPath, path.join(resourcesDir, 'neon-meter-icon.icns'))
    await rename(path.join(macOsDir, 'Electron'), path.join(macOsDir, APP_NAME))
    await setPlistValue(infoPlist, 'CFBundleDisplayName', 'string', APP_NAME)
    await setPlistValue(infoPlist, 'CFBundleName', 'string', APP_NAME)
    await setPlistValue(infoPlist, 'CFBundleExecutable', 'string', APP_NAME)
    await setPlistValue(
        infoPlist,
        'CFBundleIdentifier',
        'string',
        BUNDLE_IDENTIFIER
    )
    await setPlistValue(
        infoPlist,
        'CFBundleIconFile',
        'string',
        'neon-meter-icon'
    )
    await execFileAsync('/usr/bin/touch', [targetApp])
}

/**
 * Sets or adds a plist value.
 * @param {string} plistPath
 * @param {string} key
 * @param {string} type
 * @param {string} value
 * @returns {Promise<void>}
 */
async function setPlistValue(plistPath, key, type, value) {
    try {
        await execFileAsync('/usr/libexec/PlistBuddy', [
            '-c',
            `Set :${key} ${value}`,
            plistPath
        ])
    } catch (_error) {
        await execFileAsync('/usr/libexec/PlistBuddy', [
            '-c',
            `Add :${key} ${type} ${value}`,
            plistPath
        ])
    }
}

/**
 * Resolves the Electron executable for the current platform.
 * @param {string | null} preparedAppBundle
 * @returns {string}
 */
function getElectronExecutable(preparedAppBundle) {
    if (preparedAppBundle) {
        return path.join(preparedAppBundle, 'Contents', 'MacOS', APP_NAME)
    }

    const binary = process.platform === 'win32' ? 'electron.cmd' : 'electron'
    return path.join(projectRoot, 'node_modules', '.bin', binary)
}

/**
 * Returns an environment suitable for launching Electron as an app.
 * @returns {NodeJS.ProcessEnv}
 */
function getElectronEnv() {
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    return env
}
