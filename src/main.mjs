import { AppController } from './AppController.mjs'
import { AppState } from './core/AppState.mjs'
import { buildProviderBundlePayload } from './core/ProviderBundle.mjs'
import { AppView } from './ui/AppView.mjs'
import { IpcBleClient } from './ble/IpcBleClient.mjs'
import { WebBluetoothAiMeterClient } from './ble/WebBluetoothAiMeterClient.mjs'
import { I18nService } from './I18n.mjs'

const SETTINGS_STORAGE_KEY = 'neon-meter-host-settings'
const LEGACY_SETTINGS_STORAGE_KEY = 'ai-meter-host-settings'

/**
 * App bootstrap.
 */
async function bootstrap() {
    const i18n = await I18nService.create('en')
    const state = new AppState({ locale: i18n ? i18n.getLocale() : 'en' })
    const view = new AppView(document)
    const bridge = createBridge()
    const controller = new AppController({
        state,
        view,
        i18n,
        bridge,
        bleClient: createBleClient(bridge)
    })

    await controller.init()
    window.addEventListener('beforeunload', () => controller.dispose())
}

/**
 * Returns the native Electron device client, falling back to Web Bluetooth.
 * @param {ReturnType<typeof createBridge>} bridge
 * @returns {IpcBleClient | WebBluetoothAiMeterClient}
 */
function createBleClient(bridge) {
    try {
        if (
            typeof bridge.isBleSupported === 'function' &&
            bridge.isBleSupported()
        ) {
            return new IpcBleClient({ bridge })
        }
    } catch (_error) {
        // Static preview or unsupported native bindings fall back below.
    }
    return new WebBluetoothAiMeterClient()
}

/**
 * Returns the Electron preload bridge or a browser fallback for static checks.
 * @returns {{ getAppMeta: () => Promise<object>, loadSettings: () => Promise<object>, saveSettings: (settings: object) => Promise<object>, fetchProviderBundle: (settings?: object) => Promise<object> }}
 */
function createBridge() {
    if (window.aiMeterHost) return window.aiMeterHost

    return {
        async getAppMeta() {
            try {
                const response = await fetch('/api/app-meta', {
                    cache: 'no-store'
                })
                if (response.ok) return response.json()
            } catch (_error) {
                // Static browser fallback.
            }
            return {
                version: '',
                credentialStatus: {
                    claude: {
                        configured: false,
                        source: 'none'
                    },
                    chatgpt: {
                        configured: false,
                        source: 'none'
                    }
                }
            }
        },
        async loadSettings() {
            const rawSettings =
                localStorage.getItem(SETTINGS_STORAGE_KEY) ||
                localStorage.getItem(LEGACY_SETTINGS_STORAGE_KEY) ||
                '{}'

            if (!localStorage.getItem(SETTINGS_STORAGE_KEY)) {
                localStorage.setItem(SETTINGS_STORAGE_KEY, rawSettings)
            }

            return JSON.parse(rawSettings)
        },
        async saveSettings(settings) {
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
            localStorage.removeItem(LEGACY_SETTINGS_STORAGE_KEY)
            return settings
        },
        async fetchProviderBundle(settings) {
            return buildProviderBundlePayload([], {
                rotationSeconds: settings?.rotationSeconds
            })
        }
    }
}

bootstrap().catch((error) => {
    console.error('App bootstrap failed:', error)
})
