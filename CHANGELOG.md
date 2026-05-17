# Changelog

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
