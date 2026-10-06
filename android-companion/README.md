# Scrcpy GUI Plus Android Companion

Kotlin Android companion for the Scrcpy GUI Plus desktop host. It supports two independent transports and does not require ADB at runtime:

- **QR / LAN** — scan the desktop QR code, paste its manual pairing URI, or let the app find the desktop by broadcasting on the network and have the desktop user approve it. Both devices must be on the same private network.
- **USB accessory** — Android Open Accessory (AOA) over a USB data cable.

Once connected, the desktop can drive this phone (clipboard, URLs, screen share) and can also hand the phone a bounded, permission-scoped session for controlling another Android device attached to that desktop. See [Remote controller](#remote-controller).

The package is `com.scrcpyguiplus.companion`, with release version `1.0.13`. The Android version is maintained in `version.properties` and is synchronized by the version-bump workflow.

## Prerequisites

- Android Studio and Android SDK Platform 35.
- JDK 17 or newer. The wrapper uses Gradle 8.14.4; the project pins Android Gradle Plugin 8.13.2 and Kotlin 2.2.20.
- QR scanning uses the permissionless [Google Code Scanner](https://developers.google.com/ml-kit/vision/barcode-scanning/code-scanner) from Google Play services. Manual pairing remains available if the scanner module is unavailable.
- USB mode requires the desktop host to initiate the AOA handshake; Android cannot switch itself into accessory mode.

## Build and test

```sh
./gradlew test assembleDebug
./gradlew lint
```

The debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`. Install it with Android Studio or:

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

ADB is only an installation convenience; neither Companion transport uses ADB for its application protocol.

## Signed release build

Generate one durable release keystore on a controlled machine. Do this once per application identity; generating a new key for every release prevents Android from treating future APKs as updates:

```sh
./scripts/generate-release-keystore.sh
```

The default output is `android-release.jks`, which is ignored by Git. Keep the keystore and both passwords in an encrypted offline backup. The generator refuses to overwrite an existing keystore.

For a local signed build, export the values without committing them:

```sh
export ANDROID_RELEASE_KEYSTORE_PATH="$PWD/android-release.jks"
export ANDROID_RELEASE_KEY_ALIAS="scrcpy-gui-plus-release"
export ANDROID_RELEASE_STORE_PASSWORD="<keystore-password>"
export ANDROID_RELEASE_KEY_PASSWORD="<private-key-password>"
./gradlew --no-daemon -PandroidReleaseSigningRequired=true test lint assembleRelease bundleRelease
```

The signed outputs are:

- `app/build/outputs/apk/release/app-release.apk`
- `app/build/outputs/bundle/release/app-release.aab`

GitHub releases use the protected `android-release` environment. Configure these environment secrets before running the release workflow:

- `ANDROID_RELEASE_KEYSTORE_BASE64` — single-line base64 of the durable JKS file.
- `ANDROID_RELEASE_STORE_PASSWORD` — keystore password.
- `ANDROID_RELEASE_KEY_ALIAS` — signing alias.
- `ANDROID_RELEASE_KEY_PASSWORD` — private-key password.

The keystore is decoded only into the ephemeral GitHub runner, used for the signed APK/AAB build, and deleted in an always-run cleanup step. The release workflow publishes both files and a SHA-256 checksum file to the GitHub release. Never commit signing material or passwords.

The version-bump workflow updates `version.properties`, commits the version, and pushes the matching `v<version>` tag. A tag starts the desktop and Android release workflow. Android version codes use `major * 1,000,000 + minor * 1,000 + patch` and must remain positive and monotonically increasing.

## QR / LAN pairing

1. Put the phone and desktop on the same trusted private Wi-Fi/LAN.
2. On the desktop, open **Devices → Connection Tools → Android Companion** and choose **QR / LAN**.
3. In the Android app, choose **Scan desktop QR**. If Google Code Scanner is unavailable, expand the desktop manual code, paste it into Android, and choose **Connect with pairing code**.
4. Keep the Android Activity in the foreground while connected. To mirror the phone, click **Start screen** in the desktop Companion panel and approve Android's system screen-capture dialog. Screen share is view-only and sends bounded JPEG frames over a second LAN socket; it does not inject touch input.

The desktop binds a temporary TCP listener and generates a `scrcpy-gui-plus://pair` URI containing its private IPv4 address, ephemeral port, protocol version, and a random 256-bit token. The offer stays usable for thirty minutes (`LAN_PAIRING_TIMEOUT`), so reconnects after an Activity restart do not need a fresh QR. It accepts one authenticated companion at a time, limits rejected attempts, and is cancelled when the user disconnects or the desktop closes.

Paired desktops are remembered under **Trusted studios** in the Android app (up to twenty, newest first) with an explicit **Forget** per entry. That list is only for the UI; automatic reconnect after an Activity restart still uses the single saved offer slot.

### Discovery without a QR

A QR can only name addresses the desktop *guesses* are reachable. When the QR cannot be read (no camera or no Play services scanner) or its addresses are unreachable, the app broadcasts a discovery probe instead — UDP port `47653`, magic `scrcpy-gui-plus-discovery` — and lists the desktops that answer, keyed by the address each reply actually arrived from.

A discovery reply carries no pairing token, so this path is authenticated by the desktop user instead:

1. The Android hello sends a random `nonce` in place of a token.
2. Both sides derive the same six digits from that nonce (SHA-256 of the nonce, first four bytes mod 1,000,000). The desktop shows them in its pairing prompt; the phone shows them on screen.
3. The desktop user confirms the digits match and approves. The phone holds its socket open for at most ninety seconds (`LAN_APPROVAL_TIMEOUT`) before it has to ask again.

### Transport security

The token (or desktop approval) authenticates pairing, but the MVP raw TCP stream is **not encrypted**. Use LAN mode only on a trusted private network. A later version can add QR-pinned TLS without changing the application framing.

## USB accessory mode

The manifest filter at `app/src/main/res/xml/usb_accessory_filter.xml` matches:

- manufacturer: `Scrcpy GUI Plus`
- model: `Companion`
- version: `1`

Keep the phone unlocked and the app open. On the desktop choose **Start USB Companion**; switching to accessory mode can interrupt the current ADB/scrcpy session. Accept Android's USB permission dialog. **Check USB accessory** only rechecks an accessory already initiated by the desktop and cannot start AOA itself.

## Remote controller

The phone can act as a controller for a *different* Android device that is attached to the desktop over ADB. The desktop always initiates and scopes the session; the phone cannot ask for one.

1. On the desktop, connect this companion, then open **Remote controller** in the Companion panel.
2. Pick the **Bound Android target** and tick the capabilities to grant: **View screen**, **Touch & navigation**, **Keyboard input**, **Clipboard** (wire names `view`, `control`, `keyboard`, `clipboard`).
3. Start the session. The desktop reuses an existing embedded H.264 session for that target, or prepares one.
4. The phone shows its **Remote controller** screen: Back, Home, Recents, Rotate, Screen on/off, a text field, and send-local-clipboard.

The desktop sends `start_remote_control` with a private LAN `host`/`port`, a 64-hex one-time `token`, a `generation`, a `sessionId`, the `target` (`serial`, `label`), and the granted `permissions`. The phone then opens a second control socket (`remote_hello` / `remote_request` frames) and, when `view` is granted, a third read-only video socket carrying H.264 packets bounded to 32 MiB + 14 bytes of packet envelope.

Controller methods are `back`, `home`, `recents`, `rotate`, `screen_on`, `screen_off`, `touch`, `key`, `text`, and `clipboard_set`; each is refused unless the matching permission was granted. The desktop can revoke at any time, an idle session is dropped after thirty minutes (`REMOTE_IDLE_TIMEOUT`), and `stop_remote_control` ends it from either side.

## Application protocol

Both transports use the same stream protocol: a 4-byte unsigned big-endian payload length followed by UTF-8 JSON. Payload lengths are restricted to `1..1048576` bytes. Partial reads are handled; malformed lengths and truncated frames close only the session.

The first Android frame is a hello:

```json
{"type":"hello","protocol":1,"app":"Scrcpy GUI Plus Companion","package":"com.scrcpyguiplus.companion","version":"1.0.13","capabilities":["ping","get_device_info","clipboard_set","clipboard_get","open_url","start_screen_share","stop_screen_share","start_remote_control","stop_remote_control"],"deviceId":"<uuid>"}
```

`deviceId` is a UUID generated once per install and persisted in the app's own SharedPreferences, so the desktop can recognize the same phone across reconnects — unlike the desktop's connection-scoped id (`lan-<generation>-<ip>` / `aoa-<bus>-<addr>`) or an ADB serial/IP.

LAN adds either the one-time `token` field (QR or manual pairing) or a `nonce` field (discovery, approved by the desktop user) to this hello. USB sends neither.

A v1 client that omits `capabilities` entirely is treated as predating remote control: it keeps the original seven methods and is never offered `start_remote_control`.

Requests and responses:

```json
{"type":"request","id":1,"method":"ping","params":{}}
{"type":"response","id":1,"ok":true,"result":{"message":"pong"},"error":null}
```

Supported control methods are `ping`, `get_device_info`, `clipboard_set`, `clipboard_get`, `open_url`, `start_screen_share`, `stop_screen_share`, `start_remote_control`, and `stop_remote_control`. URLs are restricted to `http` and `https`. `start_screen_share` carries a one-time screen token, generation, private LAN endpoint, and JPEG limits; Android replies first on the control socket, asks the user for MediaProjection permission, then connects to the separate screen socket. JPEG frames use the same 4-byte length prefix but are bounded to 2 MiB. Unknown methods and malformed request JSON return bounded error responses; invalid framing closes the session.

## Runtime limitations

- The Activity owns both USB and LAN control sessions and closes them in `onStop()`. Screen capture is owned by a mediaProjection foreground service so Android 14+ can enforce the required capture contract; leaving the app still stops the Companion control session and capture when no permission dialog is pending.
- Screen streaming requires the user to approve Android's MediaProjection system dialog for each capture session. It is view-only; controlling *this* phone from the desktop still requires ADB or a separate Android accessibility/control integration.
- The remote controller decodes the target's H.264 video end to end, but its `SurfaceView` is never attached to the Compose tree, so the controller screen shows buttons and status without a picture of the target. Granting `view` is what keeps the video socket alive; the on-phone preview is still to be built.
- Opening a URL launches another Activity and intentionally ends the current foreground-owned session after its response is flushed.
- Google Code Scanner depends on Google Play services; manual LAN pairing is the fallback on devices where it is unavailable.
- Firewalls can block the desktop listener. QR / LAN requires direct reachability on the same private network.
- JVM tests cannot verify physical USB behavior, vendor permission dialogs, camera/scanner availability, firewall policy, or real network routing; these need hardware smoke tests.
