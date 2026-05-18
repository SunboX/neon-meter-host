# Changelog

## 1.0.3 - 2026-05-18

### Added

- Added a Firmware panel that checks the published Neon Meter firmware
  manifest, compares it with connected device metadata, and embeds the ESP Web
  Tools installer.
- Added firmware metadata handling over native USB and BLE so connected meters
  can report `firmwareVersion` and `chipFamily`.
- Added native BLE multi-device selection with local identifiers and RSSI when
  more than one Neon Meter is visible.
- Added a reset-aware provider refresh timer so usage data refreshes near known
  provider reset times.

### Fixed

- Fixed native BLE remembered reconnect behavior so it avoids choosing the wrong
  visible meter when multiple devices are nearby.
- Fixed firmware installation handoff by releasing the active host transport
  before Web Serial claims the CoreS3, then resuming host reconnect afterward.

### Documented

- Documented the firmware metadata BLE characteristic and the USB hello metadata
  fields.
- Added firmware installer troubleshooting steps for busy serial ports and
  post-flash firmware rechecks.

### Validation

- `npm test`
- `npm run check:format`
- `git diff --check`
- `npm run dist:dir`

## 1.0.2 - 2026-05-17

### Added

- Added native USB serial transport for the Neon Meter CoreS3 protocol.
- Added native Electron main-process BLE transport so packaged app reconnects do
  not depend on Web Bluetooth permissions in the renderer.
- Added a USB-first preferred transport: USB is selected whenever a connected
  CoreS3 answers the `neon-meter-usb` hello frame, with BLE used as fallback.
- Added BLE connection progress UI that disables the Connect button and shows a
  spinner/status while a connection attempt is in progress.

### Fixed

- Fixed USB hotplug detection while the app is hidden by disabling Electron
  background throttling for the daemon window.
- Fixed USB probing after an explicit BLE Disconnect action. The app still
  suppresses BLE reconnect after manual disconnect, but keeps a USB-only probe
  active so plugging in a cable can connect the device.
- Fixed ESP32-S3 USB CDC probing by setting DTR high and RTS low. The device can
  expose `/dev/tty.usbmodem...` while withholding serial traffic when DTR is
  low.
- Fixed remembered BLE reconnect after app restart when the native BLE device id
  changes but the device still advertises the Neon Meter service.
- Fixed app shutdown so active native USB/BLE transports are disconnected before
  process exit.

### Documented

- Documented the USB serial protocol, BLE fallback, transport selection flow,
  and DTR/RTS signal requirement.
- Added macOS troubleshooting checklists for BLE restart reconnect, USB hotplug,
  manual BLE disconnect followed by USB, packaged app verification, and direct
  DevTools status inspection.

### Validation

- `npm test`
- `git diff --check`
- `npm run dist:dir`
- Direct USB probe against a real CoreS3: connected as `Neon Meter USB` and
  received `{"type":"ack","ack":true}` from the installed app.
