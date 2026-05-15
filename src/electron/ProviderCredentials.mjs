import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { extractChatGptCredentials } from '../providers/ChatGptUsageProvider.mjs'
import { extractClaudeAccessToken } from '../providers/ClaudeCodeUsageProvider.mjs'

const execFileAsync = promisify(execFile)

/**
 * Creates a main-process credential resolver for local AI tools.
 * @param {{
 * platform?: NodeJS.Platform,
 * homeDir?: string,
 * env?: Record<string, string | undefined>,
 * readFileImpl?: (filePath: string, encoding: BufferEncoding) => Promise<string>,
 * execFileImpl?: (command: string, args: string[]) => Promise<string | { stdout?: string }>
 * }} [options]
 * @returns {{
 * getClaudeToken: () => Promise<string>,
 * getChatGptCredentials: () => Promise<{ accessToken: string, accountId: string }>,
 * getStatus: () => Promise<{ claude: { configured: boolean, source: string }, chatgpt: { configured: boolean, source: string } }>
 * }}
 */
export function createProviderCredentialResolver(options = {}) {
    const platform = options.platform || process.platform
    const homeDir = options.homeDir || homedir()
    const env = options.env || process.env
    const userName = String(env.USER || env.LOGNAME || 'user').trim() || 'user'
    const readFileImpl = options.readFileImpl || readFile
    const execFileImpl = options.execFileImpl || execFileAsync

    return {
        async getClaudeToken() {
            return (await readClaudeCredentials()).token
        },

        async getChatGptCredentials() {
            return (await readChatGptCredentials()).credentials
        },

        async getStatus() {
            const [claude, chatgpt] = await Promise.all([
                readClaudeCredentials(),
                readChatGptCredentials()
            ])

            return {
                claude: {
                    configured: Boolean(claude.token),
                    source: claude.source
                },
                chatgpt: {
                    configured: Boolean(chatgpt.credentials.accessToken),
                    source: chatgpt.source
                }
            }
        }
    }

    /**
     * Reads Claude Code credentials from keychain or file.
     * @returns {Promise<{ token: string, source: string }>}
     */
    async function readClaudeCredentials() {
        const keychain = await readClaudeKeychainToken()
        if (keychain) {
            return { token: keychain, source: 'claude-code-keychain' }
        }

        const fileToken = await readTokenFile(
            path.join(homeDir, '.claude', '.credentials.json'),
            extractClaudeAccessToken,
            readFileImpl
        )
        if (fileToken) {
            return { token: fileToken, source: 'claude-credentials-file' }
        }

        return { token: '', source: 'none' }
    }

    /**
     * Reads Claude Code credentials from macOS Keychain when available.
     * @returns {Promise<string>}
     */
    async function readClaudeKeychainToken() {
        if (platform !== 'darwin') return ''
        try {
            const result = await execFileImpl('/usr/bin/security', [
                'find-generic-password',
                '-s',
                'Claude Code-credentials',
                '-a',
                userName,
                '-w'
            ])
            return extractClaudeAccessToken(commandStdout(result))
        } catch (_error) {
            return ''
        }
    }

    /**
     * Reads ChatGPT credentials from Codex auth.json.
     * @returns {Promise<{ credentials: { accessToken: string, accountId: string }, source: string }>}
     */
    async function readChatGptCredentials() {
        const credentials = extractChatGptCredentials(
            await readFileOrEmpty(resolveCodexAuthPath(), readFileImpl)
        )
        return {
            credentials,
            source: credentials.accessToken ? 'codex-auth-file' : 'none'
        }
    }

    /**
     * Resolves the Codex auth.json path.
     * @returns {string}
     */
    function resolveCodexAuthPath() {
        const codexHome = String(env.CODEX_HOME || '').trim()
        return path.join(codexHome || path.join(homeDir, '.codex'), 'auth.json')
    }
}

/**
 * Reads a token-bearing file.
 * @param {string} filePath
 * @param {(raw: string) => string} extract
 * @returns {Promise<string>}
 */
async function readTokenFile(filePath, extract, readFileImpl) {
    return extract(await readFileOrEmpty(filePath, readFileImpl))
}

/**
 * Reads a file and suppresses missing-file errors.
 * @param {string} filePath
 * @param {(filePath: string, encoding: BufferEncoding) => Promise<string>} readFileImpl
 * @returns {Promise<string>}
 */
async function readFileOrEmpty(filePath, readFileImpl) {
    try {
        return await readFileImpl(filePath, 'utf8')
    } catch (_error) {
        return ''
    }
}

/**
 * Extracts stdout from an execFile result.
 * @param {string | { stdout?: string }} result
 * @returns {string}
 */
function commandStdout(result) {
    return typeof result === 'string' ? result : String(result?.stdout || '')
}
