import assert from 'node:assert/strict'
import test from 'node:test'
import {
    ClaudeCodeUsageProvider,
    extractClaudeAccessToken
} from '../src/providers/ClaudeCodeUsageProvider.mjs'

test('extractClaudeAccessToken reads Claude Code credential shapes', () => {
    assert.equal(
        extractClaudeAccessToken(
            JSON.stringify({ claudeAiOauth: { accessToken: 'oauth-token' } })
        ),
        'oauth-token'
    )
    assert.equal(
        extractClaudeAccessToken(JSON.stringify({ accessToken: 'direct' })),
        'direct'
    )
    assert.equal(
        extractClaudeAccessToken('raw-token-value-123456'),
        'raw-token-value-123456'
    )
})

test('ClaudeCodeUsageProvider maps Anthropic rate-limit headers', async () => {
    const requested = []
    const fetchImpl = async (url, options) => {
        requested.push({ url: String(url), options })
        return {
            ok: true,
            status: 200,
            headers: new Map([
                ['anthropic-ratelimit-unified-5h-utilization', '0.456'],
                ['anthropic-ratelimit-unified-5h-reset', '1778853600'],
                ['anthropic-ratelimit-unified-5h-status', 'allowed'],
                ['anthropic-ratelimit-unified-7d-utilization', '0.123'],
                ['anthropic-ratelimit-unified-7d-reset', '1779026400']
            ]),
            async json() {
                return {}
            }
        }
    }

    const provider = new ClaudeCodeUsageProvider({
        fetchImpl,
        token: 'claude-oauth-token',
        now: new Date('2026-05-15T12:00:00Z')
    })

    const payload = await provider.fetchPayload()

    assert.equal(requested.length, 1)
    assert.equal(requested[0].url, 'https://api.anthropic.com/v1/messages')
    assert.equal(
        requested[0].options.headers.Authorization,
        'Bearer claude-oauth-token'
    )
    assert.equal(payload.p, 'claude')
    assert.equal(payload.title, 'Claude Code')
    assert.equal(payload.s, 46)
    assert.equal(payload.sl, 'Session')
    assert.equal(payload.sr, 120)
    assert.equal(payload.w, 12)
    assert.equal(payload.wl, 'Weekly')
    assert.equal(payload.wr, 3000)
    assert.equal(payload.st, 'allowed')
    assert.equal(payload.ok, true)
})

test('ClaudeCodeUsageProvider returns an error payload without credentials', async () => {
    const provider = new ClaudeCodeUsageProvider({
        fetchImpl: async () => {
            throw new Error('must not fetch')
        },
        token: '',
        now: new Date('2026-05-15T12:00:00Z')
    })

    const payload = await provider.fetchPayload()

    assert.equal(payload.p, 'claude')
    assert.equal(payload.ok, false)
    assert.match(payload.detail, /Claude Code credentials/)
})
