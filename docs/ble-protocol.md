# Device Transport Protocol

Neon Meter Host sends the same provider bundle over USB serial or BLE. Packaged
Electron builds prefer USB serial whenever a CoreS3 answers the USB protocol
handshake, then fall back to native BLE. The static browser preview can still
use Web Bluetooth as a fallback for manual testing.

## USB Serial

- Transport: USB CDC serial at `115200` baud.
- Port signals: DTR must be high so ESP32-S3 USB CDC delivers serial traffic;
  RTS stays low to avoid toggling the boot/reset line.
- Framing: newline-delimited UTF-8 JSON objects.
- Host probe:

```json
{ "type": "hello", "protocol": "neon-meter-usb", "version": 1 }
```

- Firmware hello:

```json
{
    "type": "hello",
    "protocol": "neon-meter-usb",
    "version": 1,
    "device": "Neon Meter"
}
```

- Host heartbeat, sent every 5 seconds after connection:

```json
{ "type": "ping", "protocol": "neon-meter-usb", "version": 1 }
```

- Payload write:

```json
{ "type": "payload", "payload": { "rotationSeconds": 30, "providers": [] } }
```

- Firmware control frames:
    - `{"type":"ack","ack":true}`
    - `{"type":"err","err":true}`
    - `{"type":"refresh-requested"}`

The firmware does not answer heartbeat frames. It clears the USB app connection
when no inbound USB protocol frame arrives for more than 15 seconds. The
firmware also accepts raw provider bundles and raw single-provider objects as
compatibility frames. The host ignores non-JSON serial log lines and unknown
JSON frames.

## BLE

### Device

- Advertised name: `Neon Meter`
- Legacy advertised name accepted by the host: `AI Meter`
- Service UUID: `41494d45-7465-7220-0000-000000000001`
- RX write characteristic: `41494d45-7465-7220-0000-000000000002`
- TX notify/read characteristic: `41494d45-7465-7220-0000-000000000003`
- Refresh notify characteristic: `41494d45-7465-7220-0000-000000000004`

### Flow

1. The Electron main process first probes local USB serial ports for the Neon
   Meter USB hello response.
2. If no USB device is present, it scans for a `Neon Meter` BLE device, or a
   legacy `AI Meter` device.
3. While connected over BLE, the renderer keeps a low-rate USB probe active so
   a later USB cable hotplug switches the active transport to USB.
4. On app startup, BLE fallback scans for the remembered local device identity
   when auto-connect is enabled.
5. The native BLE client subscribes to TX acknowledgements and refresh
   requests.
6. The host writes a provider bundle JSON payload to RX.
7. The firmware responds on TX with `{"ack":true}` or `{"err":true}`.
8. The main process forwards acknowledgements and refresh requests to the
   renderer over IPC.

## Bundle Shape

The current host sends a bundle so the firmware can cache one or two detected
providers. `rotationSeconds` defaults to `30` and only matters when two
providers are present.

```json
{
    "rotationSeconds": 30,
    "providers": [
        {
            "p": "claude",
            "title": "Claude Code",
            "s": 46,
            "sl": "Session",
            "sr": 120,
            "w": 12,
            "wl": "Weekly",
            "wr": 3000,
            "st": "ok",
            "detail": "5h 46% / 7d 12%",
            "ok": true
        },
        {
            "p": "chatgpt",
            "title": "ChatGPT",
            "s": 22,
            "sl": "Session",
            "sr": 90,
            "w": 10,
            "wl": "Weekly",
            "wr": 2800,
            "st": "ok",
            "detail": "5h 22% / 7d 10%",
            "ok": true
        }
    ]
}
```

The firmware still accepts a single compact provider object for compatibility.
Payloads are generated in `src/core/FirmwarePayload.mjs` and wrapped by
`src/core/ProviderBundle.mjs`.
