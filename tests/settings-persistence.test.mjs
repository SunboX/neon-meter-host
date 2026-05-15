import assert from 'node:assert/strict'
import test from 'node:test'
import {
    createPersistedSettings,
    normalizePersistedSettings
} from '../src/core/AppSettings.mjs'

test('normalizePersistedSettings marks an empty store as first run', () => {
    const result = normalizePersistedSettings({})

    assert.equal(result.isFirstRun, true)
    assert.equal(result.provider, 'auto')
    assert.equal(result.locale, 'en')
    assert.equal(result.settings.autoSync, true)
    assert.equal(result.settings.startAtLogin, false)
    assert.equal(result.settings.autoConnectBle, true)
    assert.equal(result.settings.rotationSeconds, 30)
})

test('normalizePersistedSettings restores locale and daemon settings', () => {
    const result = normalizePersistedSettings({
        locale: 'de',
        autoSync: false,
        startAtLogin: true,
        autoConnectBle: false,
        syncIntervalMinutes: 12,
        rotationSeconds: 45,
        rememberedBleDeviceId: 'device-1',
        rememberedBleDeviceName: 'AI Meter CoreS3'
    })

    assert.equal(result.isFirstRun, false)
    assert.equal(result.provider, 'auto')
    assert.equal(result.locale, 'de')
    assert.equal(result.settings.autoSync, false)
    assert.equal(result.settings.startAtLogin, true)
    assert.equal(result.settings.autoConnectBle, false)
    assert.equal(result.settings.syncIntervalMinutes, 12)
    assert.equal(result.settings.rotationSeconds, 45)
    assert.equal(result.settings.rememberedBleDeviceId, 'device-1')
    assert.equal(result.settings.rememberedBleDeviceName, 'AI Meter CoreS3')
})

test('createPersistedSettings stores only daemon settings', () => {
    const persisted = createPersistedSettings({
        locale: 'de',
        settings: {
            autoSync: false,
            startAtLogin: true,
            autoConnectBle: false,
            syncIntervalMinutes: 20,
            rotationSeconds: 60,
            rememberedBleDeviceId: 'device-1',
            rememberedBleDeviceName: 'AI Meter CoreS3',
            dailyBudgetUsd: 15,
            manualDetail: 'legacy detail',
            accessToken: 'token'
        }
    })

    assert.equal(Object.hasOwn(persisted, 'provider'), false)
    assert.equal(persisted.locale, 'de')
    assert.equal(persisted.autoSync, false)
    assert.equal(persisted.startAtLogin, true)
    assert.equal(persisted.autoConnectBle, false)
    assert.equal(persisted.syncIntervalMinutes, 20)
    assert.equal(persisted.rotationSeconds, 60)
    assert.equal(persisted.rememberedBleDeviceId, 'device-1')
    assert.equal(persisted.rememberedBleDeviceName, 'AI Meter CoreS3')
    assert.equal(persisted.settingsConfigured, true)
    assert.equal(Object.hasOwn(persisted, 'dailyBudgetUsd'), false)
    assert.equal(Object.hasOwn(persisted, 'manualDetail'), false)
    assert.equal(Object.hasOwn(persisted, 'accessToken'), false)
})
