# BLE Device Chooser Design

## Goal

When more than one matching BLE meter is visible during a manual connection, Neon Meter must show the available devices and let the user choose the correct one. The list must include the BLE device identifier and RSSI when RSSI is available. The chosen BLE device must be stored as the remembered device so later startup and reconnect attempts use that device automatically.

## Scope

This change applies to both BLE paths:

- Native Electron BLE through the Noble-backed main-process client.
- Static preview or fallback Web Bluetooth through Electron's `select-bluetooth-device` flow.

Auto-connect and reconnect flows remain silent. They continue to use the remembered BLE id/name and must not open a chooser.

USB remains preferred over BLE in the existing transport selection. Selecting a BLE device does not change USB hotplug upgrade behavior.

## Architecture

The renderer owns the chooser UI so the app has one user-facing selection pattern. Native BLE scanning will collect matching peripherals for the configured scan window instead of resolving the first match immediately during manual connect. Each candidate will be normalized to non-secret metadata:

- `id`: local BLE identifier from Noble id, uuid, or address.
- `name`: advertised local name or the existing display fallback.
- `rssi`: numeric RSSI when the platform binding provides it.

If native manual connect finds exactly one candidate, the client connects to it directly. If it finds multiple candidates, the renderer displays a modal chooser and passes the selected id back to the connect flow. The native client then connects to that selected peripheral from the scan result.

For Web Bluetooth, Electron's `select-bluetooth-device` handler will use the same selection rule. If multiple visible devices are provided to the handler, it will show a chooser with device name, identifier, and RSSI if present. If one candidate is visible, it selects that device as today. If Electron does not provide RSSI, the UI shows RSSI as unavailable.

## Data Flow

Manual native connection:

1. The user clicks `Connect`.
2. The controller asks the device client to connect manually.
3. USB is probed first. If USB connects, no BLE chooser is shown.
4. If BLE is needed, native BLE scans for matching devices.
5. A single match connects directly; multiple matches trigger the chooser.
6. The selected device connects and the existing controller persistence stores `rememberedBleDeviceId` and `rememberedBleDeviceName`.

Manual Web Bluetooth connection:

1. The user clicks `Connect` in the fallback/static path.
2. Browser device selection begins.
3. Electron's selector receives visible devices.
4. A single visible matching device is selected directly; multiple devices trigger the chooser.
5. The browser completes the Web Bluetooth grant for the selected `deviceId`.
6. The connected device metadata is persisted by the existing controller path when available.

Auto-connect:

1. The controller loads remembered BLE metadata from settings.
2. USB is still probed first when available.
3. BLE fallback scans for the remembered id/name and connects silently if found.
4. If the remembered device is not found, reconnect retry behavior remains unchanged.

## UI

Add a focused BLE device chooser dialog to the existing app window. Each device row shows:

- Device name.
- BLE identifier.
- `RSSI: <value> dBm` when available, otherwise `RSSI unavailable`.

The dialog has a cancel action that aborts the manual connection and leaves the remembered device unchanged. Selecting a row confirms that candidate and continues the connection. The existing connect button remains disabled while the manual connection is pending.

## Error Handling

If no matching device is found, the app keeps the current `No Neon Meter BLE device found` behavior. If the user cancels the chooser, manual connection fails with a clear cancellation message and no remembered device update. If the selected candidate disappears before GATT connection completes, the connection fails through the existing error status path and leaves the previous remembered device intact.

RSSI is optional. Missing, non-finite, or unsupported RSSI values are rendered as unavailable and are not persisted.

## Persistence

No secret or raw BLE handle is persisted. The existing non-secret settings fields remain authoritative:

- `rememberedBleDeviceId`
- `rememberedBleDeviceName`

The first successful BLE connection after a chooser selection updates those fields through the existing `AppController` persistence path. No schema migration is required.

## Testing

Add focused tests for:

- Native Noble scanning returns multiple candidates with id, name, and RSSI metadata.
- Native manual connect uses a selected candidate instead of always taking the first match.
- Native remembered auto-connect remains silent and does not request a chooser.
- Web Bluetooth selector shows candidate data when multiple visible devices are available and tolerates missing RSSI.
- Renderer chooser resolves a selected id and rejects cancellation.
- Controller persistence still stores the selected connected BLE device id/name.

## Non-Goals

- Persisting RSSI or full scan history.
- Changing BLE payload content or firmware UUIDs.
- Changing USB priority or USB auto-upgrade behavior.
- Showing a chooser during startup reconnect loops.
