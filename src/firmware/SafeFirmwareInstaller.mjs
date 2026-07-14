/** Runs locally bundled ESP Web Tools flashes with explicit erase semantics. */
export class SafeFirmwareInstaller {
    #serial
    #loadFlash

    /**
     * @param {{ serial?: { requestPort?: () => Promise<object> } | null, loadFlash: () => Promise<Function> }} dependencies
     */
    constructor(dependencies) {
        this.#serial = dependencies.serial
        this.#loadFlash = dependencies.loadFlash
    }

    /**
     * Installs a safe split release or an explicitly erasing factory image.
     * @param {{ name: string, version: string, manifestUrl: string, chipFamily: string, parts: Array<{ path: string, offset: number }>, factoryImageUrl: string }} release
     * @param {{ factory?: boolean, onProgress?: (state: object) => void }} [options]
     * @returns {Promise<object>}
     */
    async install(release, options = {}) {
        if (!this.#serial?.requestPort) {
            throw new Error('Web Serial is not available')
        }
        const port = await this.#serial.requestPort()
        const flash = await this.#loadFlash()
        const factory = Boolean(options.factory)
        const manifest = firmwareManifest(release, factory)
        let finalState = null
        await flash(
            (state) => {
                finalState = state
                options.onProgress?.(state)
            },
            port,
            release.manifestUrl,
            manifest,
            factory
        )
        if (finalState?.state !== 'finished') {
            throw new Error(
                String(finalState?.message || 'Firmware installation failed')
            )
        }
        return finalState
    }
}

/**
 * Reconstructs the manifest consumed by ESP Web Tools.
 * @param {object} release
 * @param {boolean} factory
 * @returns {object}
 */
function firmwareManifest(release, factory) {
    return {
        name: String(release.name || 'Neon Meter'),
        version: String(release.version || ''),
        builds: [
            {
                chipFamily: String(release.chipFamily || ''),
                parts: factory
                    ? [{ path: release.factoryImageUrl, offset: 0 }]
                    : release.parts.map((part) => ({ ...part }))
            }
        ]
    }
}
