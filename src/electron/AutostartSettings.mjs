import path from 'node:path'
import { access, mkdir, rm, writeFile } from 'node:fs/promises'

export const APP_NAME = 'Neon Meter'
export const LINUX_AUTOSTART_FILE = 'neon-meter.desktop'

/**
 * Enables or disables OS login launch for the current platform.
 * @param {boolean} enabled
 * @param {{ app?: object, platform?: string, env?: NodeJS.ProcessEnv, executable?: string, args?: string[], icon?: string }} [options]
 * @returns {Promise<{ supported: boolean, openAtLogin: boolean }>}
 */
export async function setAutostartEnabled(enabled, options = {}) {
    const platform = options.platform || process.platform
    if (platform === 'linux') {
        return setLinuxAutostartEnabled(Boolean(enabled), options)
    }
    if (platform === 'darwin' || platform === 'win32') {
        const app = getRequiredApp(options)
        app.setLoginItemSettings(
            createLoginItemSettings(Boolean(enabled), {
                ...options,
                platform
            })
        )
        return getAutostartStatus({ ...options, platform })
    }
    return { supported: false, openAtLogin: false }
}

/**
 * Reads the current login launch status.
 * @param {{ app?: object, platform?: string, env?: NodeJS.ProcessEnv, executable?: string, args?: string[] }} [options]
 * @returns {Promise<{ supported: boolean, openAtLogin: boolean }>}
 */
export async function getAutostartStatus(options = {}) {
    const platform = options.platform || process.platform
    if (platform === 'linux') {
        return {
            supported: true,
            openAtLogin: await exists(getLinuxAutostartPath(options))
        }
    }
    if (platform === 'darwin' || platform === 'win32') {
        const app = getRequiredApp(options)
        const settings = app.getLoginItemSettings(
            createLoginItemOptions({ ...options, platform })
        )
        return {
            supported: true,
            openAtLogin: Boolean(settings.openAtLogin)
        }
    }
    return { supported: false, openAtLogin: false }
}

/**
 * Creates Electron login item settings.
 * @param {boolean} enabled
 * @param {{ platform?: string, executable?: string, args?: string[] }} [options]
 * @returns {object}
 */
export function createLoginItemSettings(enabled, options = {}) {
    const platform = options.platform || process.platform
    if (platform !== 'win32') {
        return { openAtLogin: Boolean(enabled) }
    }

    return {
        openAtLogin: Boolean(enabled),
        path: getExecutable(options),
        args: getLaunchArgs(options),
        enabled: Boolean(enabled),
        name: APP_NAME
    }
}

/**
 * Returns the Linux XDG autostart desktop file path.
 * @param {{ app?: object, env?: NodeJS.ProcessEnv }} [options]
 * @returns {string}
 */
export function getLinuxAutostartPath(options = {}) {
    return path.join(
        getXdgConfigHome(options),
        'autostart',
        LINUX_AUTOSTART_FILE
    )
}

/**
 * Writes or removes the Linux autostart desktop file.
 * @param {boolean} enabled
 * @param {{ app?: object, env?: NodeJS.ProcessEnv, executable?: string, args?: string[], icon?: string }} options
 * @returns {Promise<{ supported: boolean, openAtLogin: boolean }>}
 */
async function setLinuxAutostartEnabled(enabled, options) {
    const autostartPath = getLinuxAutostartPath(options)
    if (!enabled) {
        await rm(autostartPath, { force: true })
        return { supported: true, openAtLogin: false }
    }

    await mkdir(path.dirname(autostartPath), { recursive: true })
    await writeFile(autostartPath, createLinuxDesktopEntry(options), 'utf8')
    return { supported: true, openAtLogin: true }
}

/**
 * Creates an XDG desktop entry for launching Neon Meter at login.
 * @param {{ executable?: string, args?: string[], icon?: string }} options
 * @returns {string}
 */
function createLinuxDesktopEntry(options) {
    const exec = [getExecutable(options), ...getLaunchArgs(options)]
        .map(quoteDesktopExecArg)
        .join(' ')
    const icon = options.icon
        ? `Icon=${escapeDesktopValue(options.icon)}\n`
        : ''

    return [
        '[Desktop Entry]',
        'Type=Application',
        'Version=1.0',
        `Name=${APP_NAME}`,
        'Comment=Sync AI usage to the Neon Meter CoreS3',
        `Exec=${exec}`,
        icon.trimEnd(),
        'Terminal=false',
        'X-GNOME-Autostart-enabled=true',
        ''
    ]
        .filter((line) => line !== '')
        .join('\n')
}

/**
 * Creates options for Electron's login item status lookup.
 * @param {{ platform?: string, executable?: string, args?: string[] }} options
 * @returns {object}
 */
function createLoginItemOptions(options) {
    const platform = options.platform || process.platform
    if (platform !== 'win32') return {}
    return {
        path: getExecutable(options),
        args: getLaunchArgs(options)
    }
}

/**
 * Returns the current executable path.
 * @param {{ executable?: string }} options
 * @returns {string}
 */
function getExecutable(options) {
    return String(options.executable || process.execPath)
}

/**
 * Returns launch arguments for development Electron runs.
 * @param {{ app?: object, args?: string[] }} options
 * @returns {string[]}
 */
function getLaunchArgs(options) {
    if (Array.isArray(options.args)) return options.args.map(String)
    const appPath =
        process.defaultApp && typeof options.app?.getAppPath === 'function'
            ? options.app.getAppPath()
            : ''
    return appPath ? [appPath] : []
}

/**
 * Resolves the XDG config home.
 * @param {{ app?: object, env?: NodeJS.ProcessEnv }} options
 * @returns {string}
 */
function getXdgConfigHome(options) {
    const env = options.env || process.env
    if (env.XDG_CONFIG_HOME) return env.XDG_CONFIG_HOME
    if (typeof options.app?.getPath === 'function') {
        return path.join(options.app.getPath('home'), '.config')
    }
    return path.join(process.env.HOME || process.cwd(), '.config')
}

/**
 * Quotes one desktop Exec argument.
 * @param {string} value
 * @returns {string}
 */
function quoteDesktopExecArg(value) {
    return `"${String(value).replace(/(["\\`$])/g, '\\$1')}"`
}

/**
 * Escapes a desktop entry value.
 * @param {string} value
 * @returns {string}
 */
function escapeDesktopValue(value) {
    return String(value).replace(/\n/g, '')
}

/**
 * Checks whether a file exists.
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function exists(filePath) {
    try {
        await access(filePath)
        return true
    } catch (_error) {
        return false
    }
}

/**
 * Returns the injected Electron app object.
 * @param {{ app?: object }} options
 * @returns {object}
 */
function getRequiredApp(options) {
    if (!options.app) throw new Error('Electron app is required for autostart')
    return options.app
}
