# Safe BLE Firmware Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Neon Meter Firmware v1.0.7 and Host v1.0.9 with non-erasing firmware updates, bounded BLE connections, and automatic stale-pairing repair over USB.

**Architecture:** Firmware persists a random-static BLE identity in NVS, exposes a USB `ble-repair` capability, and publishes split flash artifacts that do not overlap NVS. The Electron host uses a pinned local ESP Web Tools bundle for non-erasing Web Serial updates, preserves structured BLE timeout errors across IPC, and invokes the USB repair command after two matching connection timeouts.

**Tech Stack:** PlatformIO Arduino C++ with NimBLE, Preferences/NVS, Unity native tests, Electron 39, ESM `.mjs`, Node test runner, SerialPort, Noble, ESP Web Tools 10.3.0, Rollup, GitHub Actions, GitHub CLI.

## Global Constraints

- Work in `/Users/afiedler/Documents/privat/Andrés_Werkstatt/Neon-Meter-Host` and sibling `/Users/afiedler/Documents/privat/Andrés_Werkstatt/Neon-Meter`.
- Preserve the user-owned modified `/Users/afiedler/Documents/privat/Andrés_Werkstatt/Neon-Meter/AGENTS.md`; never stage or commit it.
- Keep host source in ESM `.mjs`, except Electron preload `.cjs`; use 4 spaces, single quotes, no semicolons, no trailing commas, and files below 1000 lines.
- Keep firmware source files below 1000 lines and document every class, struct, enum, function, and method.
- Keep BLE UUIDs unchanged and synchronized between repositories.
- Keep provider credentials in the Electron main process; never place credentials in BLE, USB, settings, renderer storage, or firmware updater state.
- Keep BLE bonding and Secure Connections enabled.
- Normal firmware updates must not erase or write the NVS range `0x9000` through `0xDFFF`.
- Firmware updates are USB-only; the merged factory image remains an explicit destructive fallback.
- Use TDD for every behavior change: add one focused test, run it and observe the expected failure, implement the minimum, then rerun it.
- Do not report either release complete until fresh tests/builds pass and published artifacts are verified.

---

### Task 1: Persist a valid random-static firmware BLE identity

**Files:**

- Create: `../Neon-Meter/src/ble_identity_value.h`
- Create: `../Neon-Meter/src/ble_identity_value.cpp`
- Create: `../Neon-Meter/src/ble_identity_store.h`
- Create: `../Neon-Meter/src/ble_identity_store.cpp`
- Create: `../Neon-Meter/tests/test_ble_identity/test_main.cpp`
- Modify: `../Neon-Meter/platformio.ini`

**Interfaces:**

- Produces: `normalizeBleRandomStaticAddress(uint8_t *address, size_t length) -> bool`
- Produces: `isBleRandomStaticAddress(const uint8_t *address, size_t length) -> bool`
- Produces: `configurePersistentBleIdentity() -> bool`
- Produces: `rotatePersistentBleIdentity() -> bool`
- Storage contract: Preferences namespace `neon_ble`, key `identity`, exactly six bytes.

- [ ] **Step 1: Write the failing native identity tests**

```cpp
#include <unity.h>

#include "ble_identity_value.h"

void testNormalizesRandomStaticAddress(void) {
    uint8_t address[6] = {0x10, 0x20, 0x30, 0x40, 0x50, 0x01};

    TEST_ASSERT_TRUE(normalizeBleRandomStaticAddress(address, sizeof(address)));
    TEST_ASSERT_EQUAL_HEX8(0xC1, address[5]);
    TEST_ASSERT_TRUE(isBleRandomStaticAddress(address, sizeof(address)));
}

void testRejectsWrongAddressLength(void) {
    uint8_t address[5] = {};

    TEST_ASSERT_FALSE(normalizeBleRandomStaticAddress(address, sizeof(address)));
    TEST_ASSERT_FALSE(isBleRandomStaticAddress(address, sizeof(address)));
}

void testAvoidsAllOnesRandomStaticAddress(void) {
    uint8_t address[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

    TEST_ASSERT_TRUE(normalizeBleRandomStaticAddress(address, sizeof(address)));
    TEST_ASSERT_NOT_EQUAL(0xFF, address[0]);
    TEST_ASSERT_TRUE(isBleRandomStaticAddress(address, sizeof(address)));
}
```

Add all three tests to the Unity `main()` runner and add `+<ble_identity_value.cpp>` to the native `build_src_filter`.

- [ ] **Step 2: Run the focused native test and verify RED**

Run:

```bash
cd /Users/afiedler/Documents/privat/Andrés_Werkstatt/Neon-Meter
npm test -- -f test_ble_identity
```

Expected: FAIL because `ble_identity_value.h` and the normalization functions do not exist.

- [ ] **Step 3: Implement the pure identity rules**

```cpp
bool normalizeBleRandomStaticAddress(uint8_t *address, size_t length) {
    if (!address || length != 6) return false;
    address[5] = static_cast<uint8_t>((address[5] & 0x3F) | 0xC0);
    bool allOnes = true;
    for (size_t index = 0; index < length; index++) {
        allOnes = allOnes && address[index] == 0xFF;
    }
    if (allOnes) address[0] = 0xFE;
    return true;
}

bool isBleRandomStaticAddress(const uint8_t *address, size_t length) {
    if (!address || length != 6 || (address[5] & 0xC0) != 0xC0) return false;
    for (size_t index = 0; index < length; index++) {
        if (address[index] != 0xFF) return true;
    }
    return false;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- -f test_ble_identity`

Expected: PASS with three identity tests and zero failures.

- [ ] **Step 5: Add the Preferences-backed production store**

Implement `ble_identity_store.cpp` with these exact behaviors:

```cpp
static constexpr const char *kBlePreferencesNamespace = "neon_ble";
static constexpr const char *kBleIdentityKey = "identity";

static bool writeNewIdentity(uint8_t *address) {
    esp_fill_random(address, 6);
    if (!normalizeBleRandomStaticAddress(address, 6)) return false;
    Preferences preferences;
    if (!preferences.begin(kBlePreferencesNamespace, false)) return false;
    size_t written = preferences.putBytes(kBleIdentityKey, address, 6);
    preferences.end();
    return written == 6;
}

bool configurePersistentBleIdentity() {
    uint8_t address[6] = {};
    Preferences preferences;
    if (!preferences.begin(kBlePreferencesNamespace, false)) return false;
    size_t read = preferences.getBytes(kBleIdentityKey, address, sizeof(address));
    preferences.end();
    if (read != sizeof(address) || !isBleRandomStaticAddress(address, sizeof(address))) {
        if (!writeNewIdentity(address)) return false;
    }
    if (!BLEDevice::setOwnAddr(address)) return false;
    return BLEDevice::setOwnAddrType(BLE_OWN_ADDR_RANDOM);
}

bool rotatePersistentBleIdentity() {
    uint8_t address[6] = {};
    return writeNewIdentity(address);
}
```

- [ ] **Step 6: Build the real firmware**

Run: `npm run build`

Expected: exit 0 and `.pio/build/m5stack-cores3/firmware.bin` present.

- [ ] **Step 7: Commit the identity module only**

```bash
git add platformio.ini src/ble_identity_value.h src/ble_identity_value.cpp src/ble_identity_store.h src/ble_identity_store.cpp tests/test_ble_identity/test_main.cpp
git commit -m "feat: persist BLE peripheral identity"
```

### Task 2: Add firmware USB pairing repair and identity rotation

**Files:**

- Modify: `../Neon-Meter/src/serial_protocol.h`
- Modify: `../Neon-Meter/src/serial_protocol.cpp`
- Modify: `../Neon-Meter/src/ble_service.h`
- Modify: `../Neon-Meter/src/ble_service.cpp`
- Modify: `../Neon-Meter/src/main.cpp`
- Modify: `../Neon-Meter/tests/test_serial_protocol/test_main.cpp`
- Modify: `../Neon-Meter/docs/protocol.md`

**Interfaces:**

- Consumes: `configurePersistentBleIdentity()` and `rotatePersistentBleIdentity()` from Task 1.
- Produces: `SerialProtocolMessageBleRepair` for `{"type":"ble-repair"}`.
- Produces: hello capability `"capabilities":["ble-repair"]`.
- Produces: response `{"type":"ble-repair-accepted","ok":true}`.
- Changes: `clearBleBonds()` clears peer keys, rotates identity, and schedules a restart.

- [ ] **Step 1: Extend serial protocol tests first**

Add these assertions before production changes:

```cpp
void testBleRepairParsesAsControlFrame(void) {
    SerialProtocolMessage message = {};
    TEST_ASSERT_TRUE(parseSerialProtocolLine("{\"type\":\"ble-repair\"}", &message));
    TEST_ASSERT_TRUE(message.valid);
    TEST_ASSERT_EQUAL(SerialProtocolMessageBleRepair, message.type);
}

void testSerialProtocolAdvertisesAndAcknowledgesBleRepair(void) {
    char buffer[256] = {};
    formatSerialProtocolHello(buffer, sizeof(buffer));
    TEST_ASSERT_NOT_NULL(strstr(buffer, "\"capabilities\":[\"ble-repair\"]"));
    formatSerialProtocolBleRepairAccepted(buffer, sizeof(buffer));
    TEST_ASSERT_EQUAL_STRING("{\"type\":\"ble-repair-accepted\",\"ok\":true}", buffer);
}
```

- [ ] **Step 2: Run serial tests and verify RED**

Run: `npm test -- -f test_serial_protocol`

Expected: FAIL because the enum and formatter do not exist and hello lacks the capability.

- [ ] **Step 3: Implement the protocol additions**

Add `SerialProtocolMessageBleRepair` to the enum, parse the exact `ble-repair` type, and format hello/repair frames:

```cpp
if (type && strcmp(type, "ble-repair") == 0) {
    out->type = SerialProtocolMessageBleRepair;
    out->valid = true;
    out->payload[0] = '\0';
    return true;
}

void formatSerialProtocolBleRepairAccepted(char *buffer, size_t bufferLength) {
    if (!buffer || bufferLength == 0) return;
    snprintf(buffer, bufferLength, "{\"type\":\"ble-repair-accepted\",\"ok\":true}");
}
```

Change the hello JSON to include `"capabilities":["ble-repair"]` without changing protocol version 1.

- [ ] **Step 4: Run serial tests and verify GREEN**

Run: `npm test -- -f test_serial_protocol`

Expected: PASS with the new repair tests.

- [ ] **Step 5: Apply the persistent identity during BLE initialization**

Immediately after `BLEDevice::init(kDeviceName)`, call `configurePersistentBleIdentity()`. If it fails, log `BLE identity setup failed` and continue with the framework identity so the device remains recoverable.

- [ ] **Step 6: Make reset rotate identity and restart safely**

Use a delayed restart flag so the USB acknowledgment can flush:

```cpp
static bool restartForBleRepair = false;
static uint32_t restartForBleRepairAtMs = 0;

void clearBleBonds() {
    ble_store_clear();
    bool rotated = rotatePersistentBleIdentity();
    Serial.printf("BLE bonds cleared, identity rotated: %s\n", rotated ? "OK" : "FAILED");
    restartForBleRepair = rotated;
    restartForBleRepairAtMs = millis() + 250;
}
```

At the start of `bleTick()`, restart once the unsigned deadline is reached. Keep the existing Info-screen `Reset Bluetooth` action using the same function.

- [ ] **Step 7: Handle the USB command in `main.cpp`**

Add a formatter wrapper and branch:

```cpp
static void sendSerialBleRepairAccepted() {
    printSerialProtocolFrame(formatSerialProtocolBleRepairAccepted);
}

if (message.type == SerialProtocolMessageBleRepair) {
    markUsbProtocolActivity();
    sendSerialBleRepairAccepted();
    Serial.flush();
    clearBleBonds();
}
```

Increase the local formatted control-frame buffer to 256 bytes so the capability-bearing hello cannot truncate.

- [ ] **Step 8: Verify firmware tests and build**

Run:

```bash
npm test
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 9: Document and commit the firmware repair contract**

Document the optional hello capability, request, response, bond clearing, identity rotation, and restart in `docs/protocol.md`.

```bash
git add src/serial_protocol.h src/serial_protocol.cpp src/ble_service.h src/ble_service.cpp src/main.cpp tests/test_serial_protocol/test_main.cpp docs/protocol.md
git commit -m "feat: repair stale BLE pairing over USB"
```

### Task 3: Publish non-erasing split firmware artifacts

**Files:**

- Modify: `../Neon-Meter/web/esp-web-tools/manifest.json`
- Modify: `../Neon-Meter/scripts/validate_esp_web_tools.mjs`
- Modify: `../Neon-Meter/.github/workflows/deploy-web-tools.yml`
- Modify: `../Neon-Meter/docs/development.md`
- Modify: `../Neon-Meter/README.md`
- Modify: `../Neon-Meter/package.json`
- Modify: `../Neon-Meter/package-lock.json`
- Modify: `../Neon-Meter/src/firmware_info.h`
- Modify: `../Neon-Meter/CHANGELOG.md`

**Interfaces:**

- Produces manifest `builds[0].parts` at offsets 0, 32768, 57344, and 65536.
- Produces custom factory descriptor `{ "path": "firmware/neon-meter-m5stack-cores3.factory.bin", "offset": 0 }`.
- Publishes all five firmware binaries on GitHub Pages.

- [ ] **Step 1: Change validation expectations first**

Replace the single factory-part assertion with:

```js
assert.deepEqual(manifest.builds[0].parts, [
    { path: 'firmware/bootloader.bin', offset: 0 },
    { path: 'firmware/partitions.bin', offset: 32768 },
    { path: 'firmware/boot_app0.bin', offset: 57344 },
    { path: 'firmware/firmware.bin', offset: 65536 }
])
assert.deepEqual(manifest.factory, {
    path: 'firmware/neon-meter-m5stack-cores3.factory.bin',
    offset: 0
})
for (const artifact of [
    'bootloader.bin',
    'partitions.bin',
    'boot_app0.bin',
    'firmware.bin',
    'firmware.factory.bin'
]) {
    assert.match(workflow, new RegExp(artifact.replaceAll('.', '\\.')))
}
```

- [ ] **Step 2: Run validation and verify RED**

Run: `npm run validate:web-tools`

Expected: FAIL because the manifest still contains one factory part and the workflow publishes one binary.

- [ ] **Step 3: Update the manifest and deployment workflow**

Use the four split parts as the standard build and retain the factory descriptor. In the Pages workflow copy:

```bash
cp .pio/build/m5stack-cores3/bootloader.bin public/firmware/bootloader.bin
cp .pio/build/m5stack-cores3/partitions.bin public/firmware/partitions.bin
cp .pio/build/m5stack-cores3/firmware.bin public/firmware/firmware.bin
          boot_app0="$(find "$HOME/.platformio/packages" -path '*/tools/partitions/boot_app0.bin' -print -quit)"
          test -n "$boot_app0"
          cp "$boot_app0" public/firmware/boot_app0.bin
cp .pio/build/m5stack-cores3/firmware.factory.bin public/firmware/neon-meter-m5stack-cores3.factory.bin
```

Add a shell guard that fails when the `find` command returns no `boot_app0.bin`.

- [ ] **Step 4: Bump firmware metadata to 1.0.7**

Run: `npm version 1.0.7 --no-git-tag-version`

Update `NEON_METER_FIRMWARE_VERSION`, manifest version, web installer copy, and changelog to 1.0.7.

- [ ] **Step 5: Verify validation, native tests, and firmware build**

Run:

```bash
npm run validate:web-tools
npm test
npm run build
```

Expected: all exit 0 and all five source binary paths exist.

- [ ] **Step 6: Commit the safe artifact publication**

```bash
git add web/esp-web-tools/manifest.json scripts/validate_esp_web_tools.mjs .github/workflows/deploy-web-tools.yml docs/development.md README.md package.json package-lock.json src/firmware_info.h CHANGELOG.md
git commit -m "release: Neon Meter firmware 1.0.7"
```

### Task 4: Bound native BLE connections and preserve typed errors over IPC

**Files:**

- Modify: `src/ble/NativeNobleAiMeterClient.mjs`
- Modify: `tests/native-noble-ble-client.test.mjs`
- Modify: `src/electron/NativeBleIpc.mjs`
- Modify: `tests/native-ble-ipc.test.mjs`
- Modify: `src/ble/IpcBleClient.mjs`
- Modify: `tests/ipc-ble-client.test.mjs`

**Interfaces:**

- Produces: exported `BleConnectionTimeoutError` with `code === 'BLE_CONNECTION_TIMEOUT'`, `deviceId`, and `deviceName`.
- Adds constructor option `connectTimeoutMs`, default 15000.
- IPC failure envelope: `{ operationError: { code, message, deviceId, deviceName } }`.

- [ ] **Step 1: Add the never-resolving connection regression test**

```js
test('NativeNobleAiMeterClient cancels a BLE connection that never completes', async () => {
    const peripheral = new FakePeripheral({
        id: 'stale-meter',
        name: 'Neon Meter',
        connectPromise: new Promise((resolve) => setTimeout(resolve, 30))
    })
    const noble = new FakeNoble({ peripherals: [peripheral] })
    const client = new NativeNobleAiMeterClient({
        noble,
        scanTimeoutMs: 20,
        connectTimeoutMs: 5,
        discoveryRetryDelayMs: 0
    })

    await assert.rejects(
        () => client.connectRemembered({ id: 'stale-meter' }),
        (error) => {
            assert.equal(error.code, 'BLE_CONNECTION_TIMEOUT')
            assert.equal(error.deviceId, 'stale-meter')
            return true
        }
    )
    assert.equal(peripheral.disconnectCalls, 1)
})
```

Extend `FakePeripheral` so `connectAsync()` returns `options.connectPromise` and `disconnectAsync()` increments `disconnectCalls`.

- [ ] **Step 2: Run the Noble test and verify RED**

Run: `node --test tests/native-noble-ble-client.test.mjs`

Expected: FAIL after about 30 ms because the unbounded connection resolves and `assert.rejects` receives a successful device instead of `BLE_CONNECTION_TIMEOUT`.

- [ ] **Step 3: Implement timeout cancellation**

Add the error class and race helper:

```js
export class BleConnectionTimeoutError extends Error {
    constructor(peripheral) {
        super('Neon Meter BLE connection timed out')
        this.name = 'BleConnectionTimeoutError'
        this.code = 'BLE_CONNECTION_TIMEOUT'
        this.deviceId = String(peripheral?.id || peripheral?.address || '')
        this.deviceName = peripheralName(peripheral)
    }
}
```

Store a validated `#connectTimeoutMs`, race `connectAsync()` against a timer, cancel through `disconnectAsync()` on timeout, clear the timer in `finally`, and clear internal handles before rethrowing.

- [ ] **Step 4: Run the Noble tests and verify GREEN**

Run: `node --test tests/native-noble-ble-client.test.mjs`

Expected: all Noble tests pass with no hanging handles.

- [ ] **Step 5: Add failing IPC envelope tests**

Make a fake client throw an error with the timeout properties and assert the main handler returns the full envelope. Make `IpcBleClient.connectRemembered()` receive that envelope and assert it throws an Error with the same properties.

- [ ] **Step 6: Run IPC tests and verify RED**

Run: `node --test tests/native-ble-ipc.test.mjs tests/ipc-ble-client.test.mjs`

Expected: FAIL because native IPC currently rejects directly and the renderer does not unwrap structured errors.

- [ ] **Step 7: Implement IPC error wrapping and unwrapping**

Use this result contract for connect handlers:

```js
async function deviceOperation(callback) {
    try {
        return await callback()
    } catch (error) {
        return {
            operationError: {
                code: String(error?.code || 'DEVICE_OPERATION_FAILED'),
                message: error instanceof Error ? error.message : String(error),
                deviceId: String(error?.deviceId || ''),
                deviceName: String(error?.deviceName || '')
            }
        }
    }
}
```

In `IpcBleClient`, call `unwrapDeviceOperation(result)` after every connect IPC. The helper constructs an Error and assigns the four envelope properties before throwing.

- [ ] **Step 8: Run focused tests and commit**

Run:

```bash
node --test tests/native-noble-ble-client.test.mjs tests/native-ble-ipc.test.mjs tests/ipc-ble-client.test.mjs
```

Expected: all focused tests pass.

```bash
git add src/ble/NativeNobleAiMeterClient.mjs tests/native-noble-ble-client.test.mjs src/electron/NativeBleIpc.mjs tests/native-ble-ipc.test.mjs src/ble/IpcBleClient.mjs tests/ipc-ble-client.test.mjs
git commit -m "fix: bound native BLE connections"
```

### Task 5: Carry the firmware BLE repair capability through USB and transports

**Files:**

- Modify: `src/usb/NativeUsbSerialAiMeterClient.mjs`
- Modify: `tests/native-usb-serial-client.test.mjs`
- Modify: `src/transport/PreferredAiMeterClient.mjs`
- Modify: `tests/preferred-ai-meter-client.test.mjs`
- Modify: `src/electron/NativeBleIpc.mjs`
- Modify: `tests/native-ble-ipc.test.mjs`
- Modify: `src/electron/preload.cjs`
- Modify: `src/ble/IpcBleClient.mjs`
- Modify: `tests/ipc-ble-client.test.mjs`

**Interfaces:**

- USB metadata adds `capabilities: string[]`.
- Produces: `NativeUsbSerialAiMeterClient.repairBlePairing() -> Promise<{ accepted: true }>`.
- Produces: `PreferredAiMeterClient.repairBlePairing() -> Promise<{ accepted: boolean, reason?: string }>`.
- Produces IPC channel `ble:repair-pairing` and preload method `bleRepairPairing()`.

- [ ] **Step 1: Add a failing USB repair round-trip test**

Use a hello frame containing `"capabilities":["ble-repair"]`. When the fake port receives `{"type":"ble-repair"}\n`, make it emit `{"type":"ble-repair-accepted","ok":true}\n`. Assert metadata includes the capability, the exact request was written, and the promise resolves to `{ accepted: true }`.

- [ ] **Step 2: Run the USB test and verify RED**

Run: `node --test tests/native-usb-serial-client.test.mjs`

Expected: FAIL because capabilities are discarded and `repairBlePairing()` does not exist.

- [ ] **Step 3: Implement USB capability normalization and request matching**

Normalize only non-empty string capabilities:

```js
const capabilities = Array.isArray(metadata.capabilities)
    ? metadata.capabilities
          .map((value) => String(value || '').trim())
          .filter(Boolean)
    : []
```

`repairBlePairing()` must reject when no port is connected, return `{ accepted: false, reason: 'unsupported' }` when the capability is absent, wait at most 3000 ms for the accepted frame, and clean up the waiter on timeout, disconnect, or success.

- [ ] **Step 4: Run the USB tests and verify GREEN**

Run: `node --test tests/native-usb-serial-client.test.mjs`

Expected: all USB client tests pass.

- [ ] **Step 5: Add failing preferred transport and IPC repair tests**

Assert `PreferredAiMeterClient.repairBlePairing()` probes USB, sets it active, and delegates only when the USB capability is present. Assert `ble:repair-pairing` and `IpcBleClient.repairBlePairing()` preserve the result.

- [ ] **Step 6: Run the focused tests and verify RED**

Run:

```bash
node --test tests/preferred-ai-meter-client.test.mjs tests/native-ble-ipc.test.mjs tests/ipc-ble-client.test.mjs
```

Expected: FAIL because the repair methods and IPC channel do not exist.

- [ ] **Step 7: Implement the transport and IPC delegation**

Add this preferred transport behavior:

```js
async repairBlePairing() {
    const usbDevice = await this.#tryUsbConnect()
    if (!usbDevice || typeof this.#usbClient.repairBlePairing !== 'function') {
        return { accepted: false, reason: 'usb-unavailable' }
    }
    return this.#usbClient.repairBlePairing()
}
```

Register the IPC handler, expose `bleRepairPairing` in preload, and delegate it from `IpcBleClient`.

- [ ] **Step 8: Run focused tests and commit**

Run:

```bash
node --test tests/native-usb-serial-client.test.mjs tests/preferred-ai-meter-client.test.mjs tests/native-ble-ipc.test.mjs tests/ipc-ble-client.test.mjs
```

Expected: all focused tests pass.

```bash
git add src/usb/NativeUsbSerialAiMeterClient.mjs tests/native-usb-serial-client.test.mjs src/transport/PreferredAiMeterClient.mjs tests/preferred-ai-meter-client.test.mjs src/electron/NativeBleIpc.mjs tests/native-ble-ipc.test.mjs src/electron/preload.cjs src/ble/IpcBleClient.mjs tests/ipc-ble-client.test.mjs
git commit -m "feat: repair BLE pairing over USB"
```

### Task 6: Diagnose repeated timeouts and invoke automatic repair

**Files:**

- Modify: `src/core/AppState.mjs`
- Modify: `src/AppController.mjs`
- Modify: `tests/app-controller-ble.test.mjs`
- Modify: `src/ui/AppView.mjs`
- Modify: `src/index.html`
- Modify: `src/styles/10-layout.css`
- Modify: `tests/app-view-ble-status.test.mjs`
- Modify: `src/electron/main.mjs`
- Modify: `src/electron/preload.cjs`

**Interfaces:**

- BLE state adds `repairRequired: boolean` and `repairing: boolean`.
- Two consecutive `BLE_CONNECTION_TIMEOUT` failures for the same device trigger `repairBlePairing()`.
- Preload adds `openBluetoothSettings() -> Promise<void>`.

- [ ] **Step 1: Add controller tests for first timeout, second timeout, and successful repair**

Use fake errors with `code = 'BLE_CONNECTION_TIMEOUT'` and `deviceId = 'stale-meter'`. Assert the first failure schedules one retry. Run that retry and assert the second failure calls `repairBlePairing()`. For `{ accepted: true }`, assert status becomes `Repairing Bluetooth pairing` and another reconnect is scheduled. For `{ accepted: false }`, assert `repairRequired === true` and the reconnect storm stops.

- [ ] **Step 2: Run controller tests and verify RED**

Run: `node --test tests/app-controller-ble.test.mjs`

Expected: FAIL because timeout counts and automatic repair do not exist.

- [ ] **Step 3: Implement timeout counting and recovery**

Add a map keyed by `deviceId || remembered id || name`. Reset it after successful connect, explicit disconnect, a different manual selection, or `dispose()`.

Use this branch from both manual and remembered connection error paths:

```js
if (String(error?.code || '') === 'BLE_CONNECTION_TIMEOUT') {
    const attempts = this.#recordBleTimeout(error)
    if (attempts < 2) {
        this.#state.setValue('sync', {
            status: 'Retrying Neon Meter Bluetooth',
            error: errorMessage(error)
        })
        this.#scheduleBleReconnect()
        return
    }
    await this.#repairTimedOutBlePairing(error)
    return
}
```

The repair method must update `repairing`, call the client, schedule reconnect only when accepted, and expose the precise USB/macOS fallback otherwise.

- [ ] **Step 4: Run controller tests and verify GREEN**

Run: `node --test tests/app-controller-ble.test.mjs`

Expected: all controller tests pass.

- [ ] **Step 5: Add failing view tests for repair state**

Add `#bleRepairPanel`, `#bleRepairMessage`, and `#openBluetoothSettingsButton` to the fake document. Assert the panel is visible only when `ble.repairRequired`, the message tells the user to connect USB or forget the old entry, and the button invokes its bound callback.

- [ ] **Step 6: Run view tests and verify RED**

Run: `node --test tests/app-view-ble-status.test.mjs`

Expected: FAIL because repair UI and binding do not exist.

- [ ] **Step 7: Implement repair UI and Bluetooth Settings IPC**

Add an inline repair panel under the connection buttons. In Electron main, import `shell` and register:

```js
ipcMain.handle('bluetooth:open-settings', async () => {
    if (process.platform === 'darwin') {
        await shell.openExternal('x-apple.systempreferences:com.apple.BluetoothSettings')
    }
})
```

Expose it through preload, bind it in `AppView`, and call it from `AppController`. Keep the button hidden on ordinary failures.

- [ ] **Step 8: Run focused tests and commit**

Run:

```bash
node --test tests/app-controller-ble.test.mjs tests/app-view-ble-status.test.mjs
```

Expected: focused tests pass.

```bash
git add src/core/AppState.mjs src/AppController.mjs tests/app-controller-ble.test.mjs src/ui/AppView.mjs src/index.html src/styles/10-layout.css tests/app-view-ble-status.test.mjs src/electron/main.mjs src/electron/preload.cjs
git commit -m "feat: recover stale BLE pairing automatically"
```

### Task 7: Bundle and test the non-erasing Web Serial updater

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Create: `rollup.config.mjs`
- Create: `src/firmware/esp-web-tools-flash-entry.mjs`
- Create: `src/firmware/SafeFirmwareInstaller.mjs`
- Create: `tests/safe-firmware-installer.test.mjs`
- Modify: `src/firmware/FirmwareReleaseClient.mjs`
- Modify: `tests/firmware-release-client.test.mjs`

**Interfaces:**

- Firmware release metadata adds `parts: Array<{ path: string, offset: number }>` and `factoryImageUrl: string`.
- Produces: `SafeFirmwareInstaller.install(release, { factory, onProgress })`.
- Loads generated `src/generated/esp-web-tools-flash.bundle.mjs` only at runtime.
- Safe install passes `eraseFirst === false`; factory install passes `eraseFirst === true`.

- [ ] **Step 1: Add failing split-manifest normalization tests**

Use a manifest containing the four Task 3 parts and factory descriptor. Assert all part URLs are absolute, offsets remain exact, `imageUrl` points to `firmware.bin`, and `factoryImageUrl` points to the merged image.

- [ ] **Step 2: Run the release client test and verify RED**

Run: `node --test tests/firmware-release-client.test.mjs`

Expected: FAIL because only the first manifest part is retained and no factory URL is returned.

- [ ] **Step 3: Normalize all updater metadata**

Return this shape:

```js
return {
    name: String(source.name || 'Neon Meter'),
    version,
    manifestUrl,
    chipFamily,
    parts: parts.map((item) => ({
        path: new URL(String(item.path), manifestUrl).href,
        offset: Number(item.offset)
    })),
    imageUrl: new URL(String(firmwarePart.path), manifestUrl).href,
    factoryImageUrl: new URL(String(source.factory.path), manifestUrl).href
}
```

Reject missing, duplicate, non-integer, negative, or NVS-overlapping offsets.

- [ ] **Step 4: Run release client tests and verify GREEN**

Run: `node --test tests/firmware-release-client.test.mjs`

Expected: all release client tests pass.

- [ ] **Step 5: Add failing safe installer tests**

Inject fake `serial.requestPort`, `loadFlash`, and `flash`. Assert the reconstructed safe manifest contains all split parts and flash receives `false`. In a second test assert the factory manifest contains only `{ path: factoryImageUrl, offset: 0 }` and flash receives `true`. In an error-state test assert installation rejects with the ESP Web Tools state message.

- [ ] **Step 6: Run installer tests and verify RED**

Run: `node --test tests/safe-firmware-installer.test.mjs`

Expected: FAIL because `SafeFirmwareInstaller.mjs` does not exist.

- [ ] **Step 7: Implement the injectable installer**

The core method must follow this complete result check:

```js
async install(release, options = {}) {
    if (!this.#serial?.requestPort) {
        throw new Error('Web Serial is not available')
    }
    const port = await this.#serial.requestPort()
    const flash = await this.#loadFlash()
    const manifest = firmwareManifest(release, Boolean(options.factory))
    let finalState = null
    await flash(
        (state) => {
            finalState = state
            options.onProgress?.(state)
        },
        port,
        release.manifestUrl,
        manifest,
        Boolean(options.factory)
    )
    if (finalState?.state !== 'finished') {
        throw new Error(String(finalState?.message || 'Firmware installation failed'))
    }
    return finalState
}
```

- [ ] **Step 8: Add and pin the local bundle toolchain**

Install exact dev dependencies:

```bash
npm install --save-dev --save-exact esp-web-tools@10.3.0 rollup@4.62.2 @rollup/plugin-node-resolve@16.0.3 @rollup/plugin-commonjs@29.0.3 @rollup/plugin-terser@1.0.0
```

Create a Rollup config that resolves browser modules and minifies the entry into `src/generated/esp-web-tools-flash.bundle.mjs`. Add `/src/generated/*.bundle.mjs` to `.gitignore`. Prefix `start`, `serve`, `dist`, and `dist:dir` scripts with `npm run build:firmware-installer &&`.

- [ ] **Step 9: Build the bundle and run focused tests**

Run:

```bash
npm run build:firmware-installer
node --test tests/firmware-release-client.test.mjs tests/safe-firmware-installer.test.mjs
```

Expected: bundle exists and focused tests pass.

- [ ] **Step 10: Commit updater infrastructure**

```bash
git add package.json package-lock.json .gitignore rollup.config.mjs src/firmware/esp-web-tools-flash-entry.mjs src/firmware/SafeFirmwareInstaller.mjs tests/safe-firmware-installer.test.mjs src/firmware/FirmwareReleaseClient.mjs tests/firmware-release-client.test.mjs
git commit -m "feat: add non-erasing firmware updater"
```

### Task 8: Replace the embedded installer with safe and factory flows

**Files:**

- Modify: `src/main.mjs`
- Modify: `src/AppController.mjs`
- Modify: `src/core/AppState.mjs`
- Modify: `src/ui/AppView.mjs`
- Modify: `src/index.html`
- Modify: `src/styles/10-layout.css`
- Modify: `tests/app-controller-ble.test.mjs`
- Modify: `tests/app-view-ble-status.test.mjs`
- Modify: `tests/app-state.test.mjs`
- Modify: `docs/troubleshooting.md`
- Modify: `docs/getting-started.md`

**Interfaces:**

- Firmware state adds `installing`, `installProgress`, `installMode`, and `verificationPending`.
- `Install or update` always uses `factory: false`.
- `Factory reinstall` always uses `factory: true` and requires a confirmation click.
- Success requires reconnect metadata version equal to the requested release version.

- [ ] **Step 1: Add failing controller tests for safe/factory mode and progress**

Inject a fake firmware installer. Assert safe install disconnects transport, calls `install(release, { factory: false })`, applies progress, starts reconnect, and does not mark success before version verification. Assert factory action calls `factory: true`. Assert cancellation/failure restores probing and displays the error.

- [ ] **Step 2: Run controller tests and verify RED**

Run: `node --test tests/app-controller-ble.test.mjs tests/app-state.test.mjs`

Expected: FAIL because the controller only prepares the embedded web component and has no installer dependency or progress state.

- [ ] **Step 3: Wire `SafeFirmwareInstaller` into bootstrap and controller**

Instantiate it in renderer bootstrap with:

```js
const firmwareInstaller = new SafeFirmwareInstaller({
    serial: navigator.serial,
    loadFlash: async () => {
        const module = await import('./generated/esp-web-tools-flash.bundle.mjs')
        return module.flash
    }
})
```

Pass it to `AppController`. Store the latest release object privately so the installer receives exact parts instead of reconstructing from settings.

- [ ] **Step 4: Implement install, reconnect, and version verification**

Create `#installFirmware(factory)` that prepares the port, invokes the installer, reports percentage from `state.details.percentage`, resumes forced USB probing, and sets `verificationPending` to the requested version. In `#setConnectedFirmware`, clear pending verification only when `connectedVersion === verificationPending`; otherwise set `Firmware verification failed` with both versions.

- [ ] **Step 5: Run controller tests and verify GREEN**

Run: `node --test tests/app-controller-ble.test.mjs tests/app-state.test.mjs`

Expected: focused controller/state tests pass.

- [ ] **Step 6: Add failing view tests for ordinary buttons and confirmation**

Replace fake custom-element behavior with ordinary buttons. Assert install progress text, disabled state, safe install callback, factory confirmation dialog, and factory callback.

- [ ] **Step 7: Run view tests and verify RED**

Run: `node --test tests/app-view-ble-status.test.mjs`

Expected: FAIL because the index still embeds `esp-web-install-button` and no factory action exists.

- [ ] **Step 8: Replace the remote component and render progress**

Remove the remote `unpkg.com/esp-web-tools@10` script and `<esp-web-install-button>`. Add ordinary `#firmwareInstallButton`, `#firmwareFactoryButton`, and a native confirmation dialog whose copy says factory reinstall erases pairing data. Bind safe and factory callbacks separately and render integer progress from 0 through 100.

- [ ] **Step 9: Run focused UI and controller tests**

Run:

```bash
node --test tests/app-view-ble-status.test.mjs tests/app-controller-ble.test.mjs tests/app-state.test.mjs
```

Expected: all focused tests pass.

- [ ] **Step 10: Update operator documentation and commit**

Document the USB requirement, safe NVS-preserving update, explicit factory reinstall, automatic post-update version verification, and stale-pairing fallback.

```bash
git add src/main.mjs src/AppController.mjs src/core/AppState.mjs src/ui/AppView.mjs src/index.html src/styles/10-layout.css tests/app-controller-ble.test.mjs tests/app-view-ble-status.test.mjs tests/app-state.test.mjs docs/troubleshooting.md docs/getting-started.md
git commit -m "feat: install firmware without erasing pairing"
```

### Task 9: Run full verification and validate on the connected CoreS3

**Files:**

- Modify only when a failing verification first gains a regression test.

**Interfaces:**

- Consumes all firmware and host behavior from Tasks 1 through 8.
- Produces fresh automated, packaged, and physical-device evidence.

- [ ] **Step 1: Verify firmware repository state and full checks**

Run:

```bash
cd /Users/afiedler/Documents/privat/Andrés_Werkstatt/Neon-Meter
git status --short
npm run validate:web-tools
npm test
npm run build
git diff --check
```

Expected: only the user-owned `AGENTS.md` remains unstaged; all commands exit 0.

- [ ] **Step 2: Verify host repository state and full checks**

Run:

```bash
cd /Users/afiedler/Documents/privat/Andrés_Werkstatt/Neon-Meter-Host
npm test
npm run check:format
npm run dist:dir
git diff --check
```

Expected: all commands exit 0 and the unpacked Electron app includes `esp-web-tools-flash.bundle.mjs`.

- [ ] **Step 3: Upload the candidate firmware without a full erase**

Connect the CoreS3 over USB and run `npm run upload` in the firmware repository. Record the upload command's written offsets and confirm it does not run `erase_flash`. Reconnect over USB and require hello metadata for firmware v1.0.7 with the `ble-repair` capability.

- [ ] **Step 4: Verify BLE identity migration and payload sync**

Disconnect USB, confirm the firmware advertises a new identity, let the host reconnect automatically, confirm the remembered identifier is updated, and run `Sync now`. Require a device acknowledgement and live gauge update.

- [ ] **Step 5: Verify explicit repair behavior**

Use the CoreS3 `Reset Bluetooth` action or the host repair path once. Confirm bonds clear, identity rotates again, the firmware restarts, and the host finds and remembers the new identity without an infinite spinner.

- [ ] **Step 6: Re-run automated checks after physical testing**

Run both repositories' full test/build commands again. If physical testing reveals a defect, first add a failing automated regression test, then implement the smallest fix and repeat this task.

### Task 10: Release Firmware v1.0.7 and verify published artifacts

**Files:**

- No source changes expected after Task 9 verification.

**Interfaces:**

- Publishes tag and GitHub release `v1.0.7`.
- Publishes GitHub Pages manifest and five firmware binaries.

- [ ] **Step 1: Verify release commit and authentication**

Run:

```bash
cd /Users/afiedler/Documents/privat/Andrés_Werkstatt/Neon-Meter
git status --short
git log -5 --oneline
gh auth status
git remote -v
```

Expected: only `AGENTS.md` is modified, version is 1.0.7, and GitHub authentication is valid.

- [ ] **Step 2: Push firmware main and tag**

```bash
git push origin main
git tag -a v1.0.7 -m "Neon Meter firmware 1.0.7"
git push origin v1.0.7
```

- [ ] **Step 3: Create the firmware release with artifacts**

Copy `boot_app0.bin` into `.pio/build/m5stack-cores3/boot_app0.bin`, then run:

```bash
gh release create v1.0.7 \
  .pio/build/m5stack-cores3/firmware.factory.bin \
  .pio/build/m5stack-cores3/firmware.bin \
  .pio/build/m5stack-cores3/bootloader.bin \
  .pio/build/m5stack-cores3/partitions.bin \
  .pio/build/m5stack-cores3/boot_app0.bin \
  --title "Neon Meter firmware 1.0.7" \
  --generate-notes
```

- [ ] **Step 4: Watch Pages deployment and verify live bytes**

Use `gh run list --workflow "Deploy ESP Web Tools" --limit 1`, watch the returned run to completion, then fetch the live manifest and issue HEAD requests for every part and factory URL. Require HTTP 200 and non-zero content length.

- [ ] **Step 5: Verify the published update end to end**

Launch Host from the local repository and require latest firmware version 1.0.7, four safe parts, and the factory image URL from the live Pages manifest. Use `Install or update` on the connected v1.0.7 device, confirm erase is disabled, progress reaches 100%, USB reconnect reports v1.0.7, and a subsequent BLE reconnect and `Sync now` succeed.

### Task 11: Release Host v1.0.9 and verify all installers

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Publishes tag and GitHub release `v1.0.9`.
- Attaches all configured macOS, Windows, and Linux x64/arm64 installers through `Build installers`.

- [ ] **Step 1: Bump host release metadata**

Run: `npm version 1.0.9 --no-git-tag-version`

Add a 1.0.9 changelog entry describing safe updates, identity migration, bounded BLE connections, USB repair, physical verification, and the exact validation commands.

- [ ] **Step 2: Run fresh release verification**

```bash
npm test
npm run check:format
npm run dist:dir
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Commit, tag, and push Host v1.0.9**

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "release: Neon Meter Host 1.0.9"
git tag -a v1.0.9 -m "Neon Meter Host 1.0.9"
git push origin main
git push origin v1.0.9
```

- [ ] **Step 4: Create the GitHub release and run the mandated workflow**

```bash
gh release create v1.0.9 --title "Neon Meter Host 1.0.9" --generate-notes
gh workflow run "Build installers" --ref main -f release_tag=v1.0.9
```

Resolve and watch the manual workflow run with:

```bash
run_id="$(gh run list --workflow "Build installers" --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')"
test -n "$run_id"
gh run watch "$run_id" --exit-status
```

- [ ] **Step 5: Verify installer assets before reporting completion**

Run:

```bash
gh release view v1.0.9 --json tagName,isDraft,isPrerelease,assets,url
```

Require at least these primary installers:

- macOS x64 DMG and ZIP
- macOS arm64 DMG and ZIP
- Windows x64 NSIS EXE and ZIP
- Windows arm64 NSIS EXE and ZIP
- Linux x64 AppImage, DEB, and tar.gz
- Linux arm64 AppImage, DEB, and tar.gz

Also require the workflow conclusion `success`, non-zero asset sizes, and release tag `v1.0.9`. If any target is missing or failed, rerun the workflow with `release_tag=v1.0.9` and continue until every configured target is attached.
