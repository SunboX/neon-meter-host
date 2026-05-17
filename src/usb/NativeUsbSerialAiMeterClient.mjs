import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const PROTOCOL_NAME = 'neon-meter-usb'
const PROTOCOL_VERSION = 1
const BAUD_RATE = 115200
const HELLO_FRAME = '{"type":"hello","protocol":"neon-meter-usb","version":1}\n'
const PING_FRAME = '{"type":"ping","protocol":"neon-meter-usb","version":1}\n'
const HEARTBEAT_INTERVAL_MS = 5000
const DEVICE_NAME = 'Neon Meter USB'

/**
 * Native USB serial client for the Neon Meter line protocol.
 */
export class NativeUsbSerialAiMeterClient extends EventTarget {
    #SerialPort
    #loadError = null
    #timers
    #probeTimeoutMs
    #port = null
    #portInfo = null
    #lineBuffer = ''
    #dataHandler = null
    #closeHandler = null
    #errorHandler = null
    #heartbeatTimer = null

    /**
     * @param {{ serialportModule?: object, timers?: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval'>, probeTimeoutMs?: number }} [options]
     */
    constructor(options = {}) {
        super()
        const loaded = options.serialportModule
            ? { SerialPort: options.serialportModule.SerialPort, error: null }
            : loadSerialport()
        this.#SerialPort = loaded.SerialPort
        this.#loadError = loaded.error
        const timers = options.timers || {}
        this.#timers = {
            setTimeout: timers.setTimeout
                ? timers.setTimeout.bind(timers)
                : globalThis.setTimeout.bind(globalThis),
            clearTimeout: timers.clearTimeout
                ? timers.clearTimeout.bind(timers)
                : globalThis.clearTimeout.bind(globalThis),
            setInterval: timers.setInterval
                ? timers.setInterval.bind(timers)
                : globalThis.setInterval.bind(globalThis),
            clearInterval: timers.clearInterval
                ? timers.clearInterval.bind(timers)
                : globalThis.clearInterval.bind(globalThis)
        }
        this.#probeTimeoutMs = Number(options.probeTimeoutMs) || 8000
    }

    /**
     * Returns whether the native serial dependency loaded.
     * @returns {boolean}
     */
    isSupported() {
        return Boolean(this.#SerialPort)
    }

    /**
     * Connects to the first Neon Meter USB serial device that answers hello.
     * @returns {Promise<{ id: string, name: string, connected: boolean, transport: string }>}
     */
    async connect() {
        if (!this.#SerialPort) {
            throw new Error(
                'Native USB serial is not available' +
                    (this.#loadError ? ': ' + this.#loadError.message : '')
            )
        }
        if (this.#port) return this.#deviceInfo()

        const ports = sortSerialPorts(await this.#SerialPort.list()).filter(
            isProbeableSerialPort
        )
        for (const portInfo of ports) {
            const connected = await this.#probePort(portInfo)
            if (connected) return this.#deviceInfo()
        }
        throw new Error('No Neon Meter USB device found')
    }

    /**
     * Disconnects the active USB serial port.
     * @returns {void}
     */
    disconnect() {
        const port = this.#port
        if (!port) return
        this.#clearPort()
        this.dispatchEvent(new CustomEvent('disconnected'))
        if (typeof port.close === 'function') {
            port.close(() => {})
        }
    }

    /**
     * Writes a provider bundle through the USB serial payload frame.
     * @param {object} payload
     * @returns {Promise<void>}
     */
    async writePayload(payload) {
        if (!this.#port) throw new Error('Neon Meter USB is not connected')
        await writePort(
            this.#port,
            JSON.stringify({
                type: 'payload',
                payload
            }) + '\n'
        )
    }

    /**
     * Probes one serial port for the Neon Meter hello response.
     * @param {{ path?: string }} portInfo
     * @returns {Promise<boolean>}
     */
    async #probePort(portInfo) {
        if (!isProbeableSerialPort(portInfo)) return false

        const port = new this.#SerialPort({
            path: portInfo.path,
            baudRate: BAUD_RATE,
            autoOpen: false
        })

        return new Promise((resolve) => {
            let settled = false
            let timeoutId = null
            let lineBuffer = ''

            const cleanup = (connected) => {
                if (settled) return
                settled = true
                if (timeoutId) this.#timers.clearTimeout(timeoutId)
                if (!connected) {
                    port.removeListener?.('data', onData)
                    port.removeListener?.('close', onClose)
                    port.removeListener?.('error', onError)
                    closePort(port)
                }
                resolve(connected)
            }

            const onLine = (line) => {
                const eventType = this.#handleLine(line)
                if (eventType === 'hello') {
                    port.removeListener?.('data', onData)
                    port.removeListener?.('close', onClose)
                    port.removeListener?.('error', onError)
                    this.#adoptPort(port, portInfo, lineBuffer)
                    cleanup(true)
                }
            }

            const onData = (chunk) => {
                lineBuffer = consumeSerialLines(lineBuffer, chunk, onLine)
            }
            const onClose = () => cleanup(false)
            const onError = () => cleanup(false)

            port.on?.('data', onData)
            port.on?.('close', onClose)
            port.on?.('error', onError)
            timeoutId = this.#timers.setTimeout(
                () => cleanup(false),
                this.#probeTimeoutMs
            )
            port.open((error) => {
                if (error) {
                    cleanup(false)
                    return
                }
                configurePortSignals(port)
                    .then(() => writePort(port, HELLO_FRAME))
                    .catch(() => cleanup(false))
            })
        })
    }

    /**
     * Keeps a successfully probed serial port as the active transport.
     * @param {object} port
     * @param {object} portInfo
     * @param {string} lineBuffer
     * @returns {void}
     */
    #adoptPort(port, portInfo, lineBuffer) {
        this.#clearPort()
        this.#port = port
        this.#portInfo = portInfo
        this.#lineBuffer = lineBuffer || ''
        this.#dataHandler = (chunk) => {
            this.#lineBuffer = consumeSerialLines(
                this.#lineBuffer,
                chunk,
                (line) => this.#handleLine(line)
            )
        }
        this.#closeHandler = () => this.#handleDisconnect()
        this.#errorHandler = () => this.#handleDisconnect()
        port.on?.('data', this.#dataHandler)
        port.on?.('close', this.#closeHandler)
        port.on?.('error', this.#errorHandler)
        this.#startHeartbeat()
    }

    /**
     * Handles one newline-delimited JSON control frame.
     * @param {string} line
     * @returns {string}
     */
    #handleLine(line) {
        const text = String(line || '').trim()
        if (!text.startsWith('{')) return ''

        let json = null
        try {
            json = JSON.parse(text)
        } catch (_error) {
            return ''
        }

        if (isHelloFrame(json)) return 'hello'
        if (json.type === 'refresh-requested') {
            this.dispatchEvent(new CustomEvent('refresh-requested'))
            return 'refresh-requested'
        }
        if (
            json.type === 'ack' ||
            json.type === 'err' ||
            json.ack ||
            json.err
        ) {
            this.dispatchEvent(
                new CustomEvent('ack', {
                    detail: {
                        raw: text,
                        json
                    }
                })
            )
            return 'ack'
        }
        return ''
    }

    /**
     * Clears the current serial port listeners and references.
     * @returns {void}
     */
    #clearPort() {
        this.#stopHeartbeat()
        if (this.#port && this.#dataHandler) {
            this.#port.removeListener?.('data', this.#dataHandler)
        }
        if (this.#port && this.#closeHandler) {
            this.#port.removeListener?.('close', this.#closeHandler)
        }
        if (this.#port && this.#errorHandler) {
            this.#port.removeListener?.('error', this.#errorHandler)
        }
        this.#port = null
        this.#portInfo = null
        this.#lineBuffer = ''
        this.#dataHandler = null
        this.#closeHandler = null
        this.#errorHandler = null
    }

    /**
     * Starts sending USB protocol heartbeat frames to keep device liveness fresh.
     * @returns {void}
     */
    #startHeartbeat() {
        this.#stopHeartbeat()
        this.#heartbeatTimer = this.#timers.setInterval(() => {
            if (!this.#port) return
            writePort(this.#port, PING_FRAME).catch(() =>
                this.#handleDisconnect()
            )
        }, HEARTBEAT_INTERVAL_MS)
        this.#heartbeatTimer?.unref?.()
    }

    /**
     * Stops any active USB protocol heartbeat timer.
     * @returns {void}
     */
    #stopHeartbeat() {
        if (this.#heartbeatTimer === null) return
        this.#timers.clearInterval(this.#heartbeatTimer)
        this.#heartbeatTimer = null
    }

    /**
     * Handles an unexpected USB serial disconnect.
     * @returns {void}
     */
    #handleDisconnect() {
        const wasConnected = Boolean(this.#port)
        this.#clearPort()
        if (wasConnected) {
            this.dispatchEvent(new CustomEvent('disconnected'))
        }
    }

    /**
     * Returns active USB device metadata.
     * @returns {{ id: string, name: string, connected: boolean, transport: string }}
     */
    #deviceInfo() {
        return {
            id: String(this.#portInfo?.path || ''),
            name: DEVICE_NAME,
            connected: true,
            transport: 'usb'
        }
    }
}

/**
 * Loads serialport without making tests import native bindings.
 * @returns {{ SerialPort: object | null, error: Error | null }}
 */
function loadSerialport() {
    try {
        const serialportModule = require('serialport')
        return {
            SerialPort: serialportModule.SerialPort,
            error: null
        }
    } catch (error) {
        return {
            SerialPort: null,
            error: error instanceof Error ? error : new Error(String(error))
        }
    }
}

/**
 * Sorts likely USB CDC ports before other serial ports.
 * @param {object[]} ports
 * @returns {object[]}
 */
function sortSerialPorts(ports) {
    return [...(ports || [])].sort((left, right) => {
        return serialPortScore(right) - serialPortScore(left)
    })
}

/**
 * Checks whether a serial port is a realistic USB device candidate.
 * @param {object} portInfo
 * @returns {boolean}
 */
function isProbeableSerialPort(portInfo) {
    return (
        Boolean(portInfo?.path) &&
        !isExcludedSerialPath(portInfo.path) &&
        serialPortScore(portInfo) > 0
    )
}

/**
 * Scores one serial port for Neon Meter likelihood.
 * @param {object} portInfo
 * @returns {number}
 */
function serialPortScore(portInfo) {
    const text = [
        portInfo?.path,
        portInfo?.manufacturer,
        portInfo?.vendorId,
        portInfo?.productId
    ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ')
    let score = 0
    if (text.includes('usbmodem')) score += 4
    if (text.includes('usbserial')) score += 4
    if (text.includes('usb')) score += 1
    if (text.includes('ttyacm')) score += 4
    if (text.includes('ttyusb')) score += 3
    if (text.includes('espressif')) score += 5
    if (text.includes('m5stack')) score += 5
    if (text.includes('303a')) score += 5
    return score
}

/**
 * Avoids known pseudo-ports that should not be probed.
 * @param {string} path
 * @returns {boolean}
 */
function isExcludedSerialPath(path) {
    return /bluetooth/i.test(path)
}

/**
 * Checks whether a parsed JSON line is the device hello frame.
 * @param {unknown} json
 * @returns {boolean}
 */
function isHelloFrame(json) {
    return (
        json &&
        typeof json === 'object' &&
        json.type === 'hello' &&
        json.protocol === PROTOCOL_NAME &&
        Number(json.version) === PROTOCOL_VERSION
    )
}

/**
 * Writes a string to a serialport instance.
 * @param {{ write: (data: string | Buffer, callback?: (error?: Error | null) => void) => void }} port
 * @param {string} data
 * @returns {Promise<void>}
 */
function writePort(port, data) {
    return new Promise((resolve, reject) => {
        port.write(data, (error) => {
            if (error) reject(error)
            else resolve()
        })
    })
}

/**
 * Enables USB CDC traffic without toggling the ESP32-S3 boot reset line.
 * @param {{ set?: (options: object, callback?: (error?: Error | null) => void) => void }} port
 * @returns {Promise<void>}
 */
function configurePortSignals(port) {
    if (typeof port.set !== 'function') return Promise.resolve()
    return new Promise((resolve, reject) => {
        port.set(
            {
                dtr: true,
                rts: false
            },
            (error) => {
                if (error) reject(error)
                else resolve()
            }
        )
    })
}

/**
 * Closes a serialport instance while ignoring close errors.
 * @param {{ close?: (callback?: (error?: Error | null) => void) => void }} port
 * @returns {void}
 */
function closePort(port) {
    if (typeof port.close !== 'function') return
    port.close(() => {})
}

/**
 * Splits serial chunks into complete newline-delimited text lines.
 * @param {string} buffer
 * @param {Buffer | Uint8Array | string} chunk
 * @param {(line: string) => void} onLine
 * @returns {string}
 */
function consumeSerialLines(buffer, chunk, onLine) {
    let next = buffer + Buffer.from(chunk).toString('utf8')
    let newlineIndex = next.search(/[\r\n]/)
    while (newlineIndex >= 0) {
        const line = next.slice(0, newlineIndex)
        next = next.slice(newlineIndex + 1)
        if (line.trim()) onLine(line)
        newlineIndex = next.search(/[\r\n]/)
    }
    return next
}
