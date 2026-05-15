import assert from 'node:assert/strict'
import test from 'node:test'
import { createProviderCredentialResolver } from '../src/electron/ProviderCredentials.mjs'

test('provider credential resolver reads Claude Code file credentials', async () => {
    const resolver = createProviderCredentialResolver({
        platform: 'linux',
        homeDir: '/home/user',
        env: {},
        async readFileImpl(filePath) {
            assert.equal(filePath, '/home/user/.claude/.credentials.json')
            return JSON.stringify({
                claudeAiOauth: {
                    accessToken: 'claude-token'
                }
            })
        }
    })

    assert.equal(await resolver.getClaudeToken(), 'claude-token')
})

test('provider credential resolver reads Codex auth credentials', async () => {
    const resolver = createProviderCredentialResolver({
        platform: 'linux',
        homeDir: '/home/user',
        env: {},
        async readFileImpl(filePath) {
            assert.equal(filePath, '/home/user/.codex/auth.json')
            return JSON.stringify({
                tokens: {
                    access_token: 'chatgpt-token',
                    account_id: 'account-id'
                }
            })
        }
    })

    assert.deepEqual(await resolver.getChatGptCredentials(), {
        accessToken: 'chatgpt-token',
        accountId: 'account-id'
    })
})

test('provider credential resolver resolves Windows Codex auth path', async () => {
    const resolver = createProviderCredentialResolver({
        platform: 'win32',
        homeDir: 'C:\\Users\\user',
        env: {},
        async readFileImpl(filePath) {
            assert.equal(filePath, 'C:\\Users\\user\\.codex\\auth.json')
            return JSON.stringify({
                tokens: {
                    access_token: 'chatgpt-token',
                    account_id: 'account-id'
                }
            })
        }
    })

    assert.deepEqual(await resolver.getChatGptCredentials(), {
        accessToken: 'chatgpt-token',
        accountId: 'account-id'
    })
})

test('provider credential resolver reports only configured status metadata', async () => {
    const resolver = createProviderCredentialResolver({
        platform: 'darwin',
        homeDir: '/Users/user',
        env: { CODEX_HOME: '/tmp/codex', USER: 'user' },
        async execFileImpl(command, args) {
            assert.equal(command, '/usr/bin/security')
            assert.deepEqual(args, [
                'find-generic-password',
                '-s',
                'Claude Code-credentials',
                '-a',
                'user',
                '-w'
            ])
            return {
                stdout: JSON.stringify({
                    claudeAiOauth: { accessToken: 'keychain-token' }
                })
            }
        },
        async readFileImpl(filePath) {
            assert.equal(filePath, '/tmp/codex/auth.json')
            return JSON.stringify({
                tokens: {
                    access_token: 'chatgpt-token',
                    account_id: 'account-id'
                }
            })
        }
    })

    assert.deepEqual(await resolver.getStatus(), {
        claude: {
            configured: true,
            source: 'claude-code-keychain'
        },
        chatgpt: {
            configured: true,
            source: 'codex-auth-file'
        }
    })
})
