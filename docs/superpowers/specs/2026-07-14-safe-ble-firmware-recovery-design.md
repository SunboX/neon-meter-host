# Safe BLE Firmware Recovery Design

**Status:** Approved for implementation

**Date:** 2026-07-14

**Repositories:** `Neon-Meter-Host` and sibling `Neon-Meter`

## Problem

The current firmware installer publishes one factory image at flash offset zero. ESP Web Tools cannot identify the installed Neon Meter firmware through Improv Serial, so it treats an update as a new installation and offers a full-flash erase. A full erase removes the ESP32 NVS data that contains the peripheral side of the BLE bond while macOS keeps its side of the bond.

After that mismatch, macOS can still discover the advertising Neon Meter but CoreBluetooth can remain in the connecting state indefinitely. The host currently awaits Noble's `connectAsync()` without a timeout, so the UI remains on `Reconnecting Neon Meter` and does not explain or repair the stale pairing.

## Goals

- Preserve NVS and BLE bonding data during normal firmware updates.
- Recover automatically from the one-sided bond state when USB is available.
- Give every BLE link attempt a bounded duration and cancel pending CoreBluetooth connections.
- Retain BLE bonding and the current service and characteristic UUIDs.
- Keep the factory installer available as an explicit recovery operation.
- Release Firmware v1.0.7 and Host v1.0.9 after automated and device verification.

## Non-goals

- The host will not use private macOS APIs, edit Bluetooth databases, or bundle an unsupported system unpairing utility.
- The host cannot silently remove an existing macOS bond through public CoreBluetooth APIs.
- Normal BLE status payloads will not contain credentials or raw provider responses.
- Firmware updates will remain USB-only; multi-megabyte firmware transfer over BLE is out of scope.

## Firmware Artifacts and Safe Flash Layout

The firmware deployment workflow will continue to publish the merged factory image for blank-device and disaster recovery. It will additionally publish the individual images produced by the CoreS3 PlatformIO build:

| Artifact | Flash offset | Purpose |
| --- | ---: | --- |
| `bootloader.bin` | `0x0000` | ESP32-S3 bootloader |
| `partitions.bin` | `0x8000` | 16 MB partition table |
| `boot_app0.bin` | `0xE000` | OTA selection data |
| `firmware.bin` | `0x10000` | Neon Meter application |

The public ESP Web Tools manifest will describe these split parts. None overlaps the `default_16MB.csv` NVS partition at `0x9000` through `0xDFFF`.

The regular host update flow will call a pinned, locally bundled ESP Web Tools flashing engine with erase disabled. This keeps NVS intact while still updating the bootloader, partition table, OTA selector, and application. The existing merged factory image will remain available behind a separate `Factory reinstall` action with an explicit erase warning.

The host will no longer load an unpinned ESP Web Tools module from a CDN. The pinned installer dependency will be bundled into the packaged renderer so installed apps use the version covered by tests.

## Persistent BLE Identity

Firmware v1.0.7 will introduce a persistent random-static BLE identity stored in NVS. On the first v1.0.7 boot, firmware will generate a valid random-static address, persist it, configure NimBLE to use it, and advertise with that identity.

This intentionally creates a one-time identity migration from the earlier public address. macOS will see a new peripheral instead of applying a stale bond. The host already falls back to a single visible Neon Meter when a remembered identifier changed, then persists the new identifier after connecting. Multiple visible meters will continue to require explicit selection.

Subsequent safe updates preserve the identity and bonds. If a future factory erase removes NVS, the firmware generates a different identity on the next boot, preventing the old one-sided macOS bond from blocking the newly initialized peripheral.

The existing firmware-side repeat-pairing behavior remains enabled. BLE bonding and Secure Connections remain configured as they are today.

## USB BLE Repair Command

The USB protocol will gain an optional `ble-repair` capability in the hello metadata and a corresponding control frame. Firmware receiving the command will:

1. Acknowledge the accepted repair request over USB.
2. Clear stored BLE peer bonds.
3. Generate and persist a new random-static BLE identity.
4. Restart so NimBLE initializes with the new identity.

The command is local to the USB connection and contains no secret data. Older firmware remains compatible because capabilities are optional protocol metadata.

## Bounded BLE Connection and Diagnosis

`NativeNobleAiMeterClient` will enforce a 15-second link timeout around `peripheral.connectAsync()`. When the timer expires it will cancel or disconnect the pending peripheral, clear internal handles, and throw a typed error carrying the discovered device identifier and a stable `BLE_CONNECTION_TIMEOUT` code.

The application controller will distinguish this from scan failures and GATT discovery failures. It will retry one timed-out connection. Two consecutive timeouts for the same advertised remembered device will be classified as a likely stale pairing instead of leaving an infinite spinner or reconnect storm.

When that signature is detected, the preferred transport will probe USB. If a compatible meter advertising the `ble-repair` capability is available, the host will send the repair command, wait for the device restart, rescan BLE, connect to the new identity, persist it, and resume synchronization.

If USB is not available or the connected firmware is too old, the app will present a precise fallback: connect the meter over USB for automatic repair, or open macOS Bluetooth Settings and forget the old Neon Meter entry. The app will never claim that it removed a macOS bond itself.

## Firmware Update User Experience

The primary `Install or update` action will be the safe path:

1. Confirm that a compatible CoreS3 is connected over USB.
2. Stop reconnect timers and release the native serial port.
3. Request the Web Serial port and download the split release artifacts.
4. Flash with whole-device erase disabled while reporting progress.
5. Reboot the CoreS3 and restore native USB probing.
6. Verify that the connected firmware version equals the requested release.
7. Resume BLE discovery and usage synchronization.

Closing or canceling the installer will restore normal probing without marking the update successful. A write, download, port, or verification failure will remain visible and retryable.

`Factory reinstall` will remain a distinct advanced action. It will use the merged factory image and clearly state that it erases local state and pairing data.

## State and API Changes

The firmware release client will retain all manifest parts instead of normalizing only the first image. Firmware state will add update progress and explicit safe-update availability without storing downloaded firmware data in settings.

The native USB client and preferred transport will expose a narrowly scoped BLE repair operation. The preload bridge will expose only the firmware installer and Bluetooth Settings actions needed by the renderer; no filesystem, shell, provider credential, or arbitrary URL access will be added.

BLE error state will use stable machine-readable codes internally and concise user-facing messages in the view. Consecutive timeout counters reset after a successful link, a different device selection, an explicit disconnect, or disposal.

## Security and Failure Handling

- OpenAI and Anthropic credentials remain in the main process and are not involved in firmware installation.
- Firmware artifacts come only from the configured Neon Meter release manifest.
- BLE remains bonded; the design does not downgrade to an unencrypted status service.
- The updater never writes the NVS address range during a normal update.
- A failed split-image flash remains recoverable through the factory installer.
- Automatic bond clearing requires the exact repeated link-timeout signature and a locally connected USB meter advertising repair support.

## Testing

Firmware tests will cover random-static address normalization and USB protocol parsing/formatting for the repair capability and command. The firmware must pass `npm test`, `npm run validate:web-tools`, and `npm run build`.

Host tests will cover:

- a never-resolving Noble connection timing out and being canceled;
- typed timeout metadata and handle cleanup;
- one retry followed by stale-pairing classification;
- automatic USB repair capability detection and invocation;
- changed BLE identity persistence after repair;
- split manifest normalization and non-erasing installer invocation;
- installer cancellation, failure, progress, reconnect, and version verification;
- safe-update and factory-reinstall UI states.

The host must pass `npm test`, `npm run check:format`, and a local packaged build. A connected CoreS3 will be used to verify the safe update, reboot, version check, identity migration, BLE reconnect, and normal payload synchronization.

## Release Sequence

1. Implement and verify both repositories locally without staging the user-owned firmware `AGENTS.md` change.
2. Commit and push Firmware v1.0.7, tag it, create its GitHub release, and verify GitHub Pages publishes the split artifacts and manifest.
3. Re-run the host update flow against the published firmware release.
4. Commit and push Host v1.0.9, tag it, and create its GitHub release.
5. Run the Host `Build installers` workflow with `release_tag=v1.0.9` when necessary.
6. Verify every configured macOS, Windows, and Linux installer artifact is attached before reporting completion.
