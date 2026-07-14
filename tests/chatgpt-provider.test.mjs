import assert from 'node:assert/strict'
import test from 'node:test'
import {
    ChatGptUsageProvider,
    extractChatGptCredentials,
    parseChatGptUsagePayload
} from '../src/providers/ChatGptUsageProvider.mjs'

test('extractChatGptCredentials reads Codex auth.json tokens', () => {
    const credentials = extractChatGptCredentials({
        tokens: {
            access_token: 'chatgpt-access',
            account_id: 'account-123'
        }
    })

    assert.deepEqual(credentials, {
        accessToken: 'chatgpt-access',
        accountId: 'account-123'
    })
})

test('parseChatGptUsagePayload maps quota windows to firmware fields', () => {
    const payload = parseChatGptUsagePayload(
        {
            five_hour: {
                remaining_percent: 64,
                reset_time_ms: 1778853600000
            },
            weekly: {
                used_percent: 41,
                reset_at: 1779026400
            }
        },
        new Date('2026-05-15T12:00:00Z')
    )

    assert.equal(payload.p, 'chatgpt')
    assert.equal(payload.title, 'ChatGPT')
    assert.equal(payload.se, true)
    assert.equal(payload.s, 36)
    assert.equal(payload.sl, 'Session')
    assert.equal(payload.sr, 120)
    assert.equal(payload.w, 41)
    assert.equal(payload.wl, 'Weekly')
    assert.equal(payload.wr, 3000)
    assert.equal(payload.ok, true)
})

test('parseChatGptUsagePayload keeps integer percent fields as percentages', () => {
    const payload = parseChatGptUsagePayload(
        {
            rate_limit: {
                allowed: true,
                primary_window: {
                    used_percent: 6,
                    limit_window_seconds: 18000,
                    reset_at: 1778853600
                },
                secondary_window: {
                    used_percent: 1,
                    limit_window_seconds: 604800,
                    reset_at: 1779026400
                }
            }
        },
        new Date('2026-05-15T12:00:00Z')
    )

    assert.equal(payload.se, true)
    assert.equal(payload.s, 6)
    assert.equal(payload.w, 1)
    assert.equal(payload.detail, '5h 6% / 7d 1%')
})

test('parseChatGptUsagePayload keeps a lone seven-day primary window in Weekly', () => {
    const payload = parseChatGptUsagePayload(
        {
            rate_limit: {
                allowed: true,
                limit_reached: false,
                primary_window: {
                    used_percent: 52,
                    limit_window_seconds: 604800,
                    reset_after_seconds: 476467,
                    reset_at: 1784487611
                },
                secondary_window: null
            }
        },
        new Date('2026-07-14T06:39:05Z')
    )

    assert.equal(payload.se, false)
    assert.equal(payload.s, 0)
    assert.equal(payload.sr, -1)
    assert.equal(payload.w, 52)
    assert.equal(payload.wr, 7942)
    assert.equal(payload.detail, '7d 52%')
    assert.equal(payload.ok, true)
})

test('parseChatGptUsagePayload rejects a lone positional window without a duration', () => {
    const payload = parseChatGptUsagePayload({
        rate_limit: {
            primary_window: {
                used_percent: 52,
                reset_at: 1784487611
            },
            secondary_window: null
        }
    })

    assert.equal(payload.ok, false)
    assert.match(payload.detail, /not recognized/)
})

test('ChatGptUsageProvider calls wham usage with Codex auth headers', async () => {
    const requested = []
    const fetchImpl = async (url, options) => {
        requested.push({ url: String(url), options })
        return {
            ok: true,
            status: 200,
            async json() {
                return {
                    primary_window: {
                        used_percent: 22,
                        reset_at: 1778853600
                    },
                    secondary_window: {
                        percent_left: 90,
                        reset_time_ms: 1779026400000
                    }
                }
            }
        }
    }

    const provider = new ChatGptUsageProvider({
        fetchImpl,
        accessToken: 'chatgpt-access',
        accountId: 'account-123',
        now: new Date('2026-05-15T12:00:00Z')
    })

    const payload = await provider.fetchPayload()

    assert.equal(requested.length, 1)
    assert.equal(requested[0].url, 'https://chatgpt.com/backend-api/wham/usage')
    assert.equal(
        requested[0].options.headers.Authorization,
        'Bearer chatgpt-access'
    )
    assert.equal(
        requested[0].options.headers['ChatGPT-Account-Id'],
        'account-123'
    )
    assert.equal(payload.s, 22)
    assert.equal(payload.w, 10)
})

test('ChatGptUsageProvider returns an error payload without Codex credentials', async () => {
    const provider = new ChatGptUsageProvider({
        fetchImpl: async () => {
            throw new Error('must not fetch')
        },
        accessToken: '',
        accountId: '',
        now: new Date('2026-05-15T12:00:00Z')
    })

    const payload = await provider.fetchPayload()

    assert.equal(payload.p, 'chatgpt')
    assert.equal(payload.ok, false)
    assert.match(payload.detail, /Codex auth/)
})
