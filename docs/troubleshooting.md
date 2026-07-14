# Troubleshooting

## Claude Code Shows Missing Credentials

- Start Claude Code once on the same machine and complete its login flow.
- On macOS, confirm the Keychain item `Claude Code-credentials` exists.
- On other platforms, confirm `~/.claude/.credentials.json` exists.

## ChatGPT/Codex Shows Missing Auth

- Start Codex once on the same machine and complete its login flow.
- Confirm `~/.codex/auth.json` exists, or set `CODEX_HOME` to the directory
  containing `auth.json` before launching Neon Meter.

## USB Device Is Not Detected

- Connect the CoreS3 with a data-capable USB cable.
- Confirm the firmware is running and not only in bootloader or installer mode.
- Neon Meter should detect USB while already running. If it only connects after
  a restart, verify the packaged Electron window has
  `backgroundThrottling: false` so hidden daemon reconnect timers keep running.
- If multiple serial devices are attached, disconnect unrelated boards and try
  again. The app only keeps a port after it answers the `neon-meter-usb` hello
  frame.

### macOS USB Hotplug Debug Checklist

Use this checklist when plugging in the CoreS3 over USB does not switch the app
to `Neon Meter USB`.

1. Confirm macOS exposes the serial device:

    ```bash
    ls /dev/tty.usbmodem* /dev/cu.usbmodem* 2>/dev/null
    ```

    A working CoreS3 usually appears as `tty.usbmodem...` and `cu.usbmodem...`.

2. Confirm the serial library sees the same port metadata:

    ```bash
    node --input-type=module <<'NODE'
    import { SerialPort } from 'serialport'
    console.log(JSON.stringify(await SerialPort.list(), null, 2))
    NODE
    ```

    For the CoreS3, expect Espressif-style metadata such as vendor id `303a`.

3. Check whether the installed app has opened the port:

    ```bash
    lsof /dev/tty.usbmodem1101 2>/dev/null
    ```

    Replace the device name with the one from step 1. If this is empty while
    the app is running, the app has not claimed the USB transport.

4. Run the serial transport directly to isolate app UI/timer issues from the
   USB protocol:

    ```bash
    node --input-type=module <<'NODE'
    import { NativeUsbSerialAiMeterClient } from './src/usb/NativeUsbSerialAiMeterClient.mjs'
    const client = new NativeUsbSerialAiMeterClient({ probeTimeoutMs: 2000 })
    console.log(await client.connect())
    await client.disconnect()
    NODE
    ```

    If this returns `Neon Meter USB`, the device, cable, and USB protocol are
    working.

## Firmware Installer Cannot Open The Device

- Connect the CoreS3 over USB and press `Install or update`. The app releases
  its active USB/BLE transport before Web Serial requests the CoreS3 port.
- If the installer still reports that the serial port is busy, close any other
  serial monitor or app that may have opened the ESP32-S3 CDC port.
- If the device is brand new or in bootloader mode, select the Espressif
  `ESP32-S3` serial port from the installer chooser. Use `Factory reinstall`
  only when the safe updater cannot recover the device; factory mode erases
  BLE pairing data and all other local state.
- Normal `Install or update` flashes the split release images without erasing
  NVS. After flashing, the app reconnects over USB and verifies that the device
  reports the requested `firmwareVersion`. A mismatch remains visible as
  `Firmware verification failed` with both versions.

    If the serial port opens but no hello arrives, verify the host sets DTR high
    and RTS low. The ESP32-S3 CDC interface can expose `/dev/tty.usbmodem...`
    while still withholding serial traffic when DTR is low.

5. Launch the installed app with a temporary DevTools port and inspect the
   renderer state:

    ```bash
    osascript -e 'tell application "Neon Meter" to quit' 2>/dev/null || true
    open -na "/Applications/Neon Meter.app" --args --remote-debugging-port=9223
    sleep 8
    curl -s http://127.0.0.1:9223/json
    ```

    Read the UI state through the DevTools protocol:

    ```bash
    node --input-type=module <<'NODE'
    import { WebSocket } from 'undici'
    const targets = await fetch('http://127.0.0.1:9223/json').then((r) => r.json())
    const ws = new WebSocket(targets[0].webSocketDebuggerUrl)
    let id = 0
    const pending = new Map()
    ws.addEventListener('message', (event) => {
        const message = JSON.parse(event.data)
        if (message.id && pending.has(message.id)) {
            pending.get(message.id)(message)
            pending.delete(message.id)
        }
    })
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true })
        ws.addEventListener('error', reject, { once: true })
    })
    const send = (method, params = {}) => {
        const messageId = ++id
        ws.send(JSON.stringify({ id: messageId, method, params }))
        return new Promise((resolve) => pending.set(messageId, resolve))
    }
    const result = await send('Runtime.evaluate', {
        expression: `({
            bleState: document.querySelector('#bleState')?.textContent?.trim(),
            bleDevice: document.querySelector('#bleDevice')?.textContent?.trim(),
            syncStatus: document.querySelector('#syncStatus')?.textContent?.trim(),
            syncError: document.querySelector('#syncError')?.textContent?.trim()
        })`,
        returnByValue: true
    })
    console.log(JSON.stringify(result.result.result.value, null, 2))
    ws.close()
    NODE
    ```

    Expected USB state is `bleState: "Connected"` and
    `bleDevice: "Neon Meter USB"`.

6. If direct USB succeeds but hotplug fails only while the app is hidden, inspect
   `src/electron/main.mjs`. The main `BrowserWindow` must set
   `webPreferences.backgroundThrottling` to `false`; otherwise Electron can
   suspend the renderer timers that drive USB upgrade polling.

7. If USB hotplug fails only after pressing `Disconnect` while BLE was active,
   inspect `src/AppController.mjs`. The disconnect path must suppress BLE
   reconnect while still scheduling a USB-only probe with an empty remembered
   device request. The regression for this flow is
   `AppController keeps probing USB after manual BLE disconnect` in
   `tests/app-controller-ble.test.mjs`.

## BLE Device Is Not Listed

- Confirm the CoreS3 is powered on and showing the Neon Meter firmware.
- Open the firmware Bluetooth screen and confirm it advertises as `Neon Meter`.
- Toggle Bluetooth on the host computer.
- On macOS, allow Bluetooth access for Neon Meter when the system prompts.
- On Linux, confirm BlueZ is installed/running and the current user can access
  the Bluetooth adapter.
- Restart Neon Meter if the Bluetooth adapter was disabled while the app was
  running.

## BLE Does Not Reconnect After Restart

- Confirm `Auto-connect device` is enabled in settings.
- Connect over USB when possible; USB is preferred and does not need remembered
  BLE metadata.
- Connect once with the local `Connect` button so Neon Meter can store the
  non-secret device identity.
- Keep the CoreS3 powered on and advertising as `Neon Meter` during app startup.
- On Linux, reconnect can fail if the desktop user lacks Bluetooth adapter
  permissions. Start Neon Meter from a terminal and check for BlueZ or HCI
  permission errors.

## BLE Is Found But Never Finishes Connecting

Two consecutive connection timeouts for the same Neon Meter trigger automatic
pairing repair when a compatible meter is connected over USB. The firmware
clears its peer bonds, rotates its BLE identity, restarts, and the host resumes
discovery without an endless reconnect spinner.

If USB is unavailable or the firmware is too old, connect the meter over USB
and retry. On macOS, the fallback panel can open Bluetooth Settings so you can
forget the old Neon Meter entry manually. The app does not claim to remove the
macOS bond itself.

### macOS BLE Restart Debug Checklist

Use this checklist when the app does not auto-connect to BLE after a restart,
but manual `Connect` still works.

1. Confirm the persisted settings are correct:

    ```bash
    cat "$HOME/Library/Application Support/Neon Meter/settings.json"
    ```

    Expected fields:
    - `autoConnectBle` is `true`.
    - `rememberedBleDeviceId` or `rememberedBleDeviceName` is present.

2. Confirm no stale login item points at a development bundle:

    ```bash
    osascript <<'OSA'
    tell application "System Events"
        repeat with itemRef in (every login item whose name contains "Neon")
            log ((name of itemRef) & " -> " & (path of itemRef as text))
        end repeat
    end tell
    OSA
    ```

    There should be one `Neon Meter` item, and it should point to
    `/Applications/Neon Meter.app`. Remove stale entries and recreate the
    production entry with:

    ```bash
    osascript <<'OSA'
    tell application "System Events"
        delete every login item whose name is "Neon Meter"
        make login item at end with properties {path:"/Applications/Neon Meter.app", hidden:false}
    end tell
    OSA
    ```

3. Do not launch the app by executing `Contents/MacOS/Neon Meter` directly when
   testing Bluetooth. macOS may treat that as a bare executable and TCC can
   abort Bluetooth access even if the bundle `Info.plist` is correct. Launch
   through Launch Services instead:

    ```bash
    open "/Applications/Neon Meter.app"
    ```

4. Check for recent privacy or native crashes:

    ```bash
    ls -lt "$HOME/Library/Logs/DiagnosticReports" | head
    sed -n '1,90p' "$HOME/Library/Logs/DiagnosticReports/<latest Neon Meter crash>.ips"
    ```

    A TCC crash that says `NSBluetoothAlwaysUsageDescription` is missing usually
    means the app was launched as a direct executable, not as an app bundle.

5. Launch through the bundle with a temporary DevTools port and inspect the
   renderer status:

    ```bash
    osascript -e 'tell application "Neon Meter" to quit' 2>/dev/null || true
    open -na "/Applications/Neon Meter.app" --args --remote-debugging-port=9223
    sleep 14
    curl -s http://127.0.0.1:9223/json
    ```

    Then read the UI state through the DevTools protocol:

    ```bash
    node --input-type=module <<'NODE'
    import { WebSocket } from 'undici'
    const targets = await fetch('http://127.0.0.1:9223/json').then((r) => r.json())
    const ws = new WebSocket(targets[0].webSocketDebuggerUrl)
    let id = 0
    const pending = new Map()
    ws.addEventListener('message', (event) => {
        const message = JSON.parse(event.data)
        if (message.id && pending.has(message.id)) {
            pending.get(message.id)(message)
            pending.delete(message.id)
        }
    })
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true })
        ws.addEventListener('error', reject, { once: true })
    })
    const send = (method, params = {}) => {
        const messageId = ++id
        ws.send(JSON.stringify({ id: messageId, method, params }))
        return new Promise((resolve) => pending.set(messageId, resolve))
    }
    const expression = `({
        bleState: document.querySelector('#bleState')?.textContent,
        bleDevice: document.querySelector('#bleDevice')?.textContent,
        syncStatus: document.querySelector('#syncStatus')?.textContent,
        syncError: document.querySelector('#syncError')?.textContent,
        connectDisabled: document.querySelector('#connectButton')?.disabled,
        disconnectDisabled: document.querySelector('#disconnectButton')?.disabled
    })`
    const result = await send('Runtime.evaluate', { expression, returnByValue: true })
    console.log(JSON.stringify(result.result.result.value, null, 2))
    ws.close()
    NODE
    ```

6. Compare remembered auto-connect with manual connect from the same running
   app. If startup shows `Disconnected` or `Reconnecting Neon Meter`, trigger
   the button through DevTools:

    ```bash
    node --input-type=module <<'NODE'
    import { WebSocket } from 'undici'
    const targets = await fetch('http://127.0.0.1:9223/json').then((r) => r.json())
    const ws = new WebSocket(targets[0].webSocketDebuggerUrl)
    let id = 0
    const pending = new Map()
    ws.addEventListener('message', (event) => {
        const message = JSON.parse(event.data)
        if (message.id && pending.has(message.id)) {
            pending.get(message.id)(message)
            pending.delete(message.id)
        }
    })
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true })
        ws.addEventListener('error', reject, { once: true })
    })
    const send = (method, params = {}) => {
        const messageId = ++id
        ws.send(JSON.stringify({ id: messageId, method, params }))
        return new Promise((resolve) => pending.set(messageId, resolve))
    }
    await send('Runtime.evaluate', {
        expression: "document.querySelector('#connectButton')?.click()"
    })
    await new Promise((resolve) => setTimeout(resolve, 14000))
    const result = await send('Runtime.evaluate', {
        expression: `({
            bleState: document.querySelector('#bleState')?.textContent,
            bleDevice: document.querySelector('#bleDevice')?.textContent,
            syncStatus: document.querySelector('#syncStatus')?.textContent,
            syncError: document.querySelector('#syncError')?.textContent
        })`,
        returnByValue: true
    })
    console.log(JSON.stringify(result.result.result.value, null, 2))
    ws.close()
    NODE
    ```

    If manual connect succeeds but startup reconnect does not, inspect
    `src/ble/NativeNobleAiMeterClient.mjs` remembered-device matching. The
    expected behavior is:
    - Exact remembered id or name wins.
    - If the remembered id/name changed, any device advertising the Neon Meter
      service UUID may still be used.
    - Add or update a regression in
      `tests/native-noble-ble-client.test.mjs`.

7. After a fix, verify the packaged app, not only `npm start`:

    ```bash
    npm test
    npm run dist:dir
    rsync -a --delete "dist/mac-arm64/Neon Meter.app/" "/Applications/Neon Meter.app/"
    codesign --verify --deep --strict "/Applications/Neon Meter.app"
    ```

    Relaunch with `open -na "/Applications/Neon Meter.app"` and confirm the
    renderer reports `bleState: "Connected"` and device `Neon Meter`.

## Static Preview Cannot Sync

`npm run serve` is only a static UI preview. Live quota sync and the USB/BLE
client require Electron.

## Electron Runs Like Node

Some agent shells set `ELECTRON_RUN_AS_NODE=1`, which makes Electron expose Node
behavior instead of main-process APIs. The `npm start` script unsets this
variable before launching Electron.

## Tests Fail After File Moves

Update `tests/project-structure.test.mjs` when moving required files, and keep
source `.mjs` files below 1000 lines.
