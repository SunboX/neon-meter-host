# BLE Protocol

Neon Meter Host uses Web Bluetooth in the Electron renderer to communicate with the CoreS3 firmware.

## Device

- Advertised name: `Neon Meter`
- Legacy advertised name accepted by the host: `AI Meter`
- Service UUID: `41494d45-7465-7220-0000-000000000001`
- RX write characteristic: `41494d45-7465-7220-0000-000000000002`
- TX notify/read characteristic: `41494d45-7465-7220-0000-000000000003`
- Refresh notify characteristic: `41494d45-7465-7220-0000-000000000004`

## Flow

1. The user selects `Connect`.
2. Electron's Bluetooth device selector chooses the first visible `Neon Meter`
   device, or a legacy `AI Meter` device.
3. The renderer subscribes to TX acknowledgements and refresh requests.
4. The host writes a provider bundle JSON payload to RX.
5. The firmware responds on TX with `{"ack":true}` or `{"err":true}`.

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
