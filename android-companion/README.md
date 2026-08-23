# Scrcpy GUI Plus Android Companion

Kotlin Android companion for the Scrcpy GUI Plus desktop host. It supports two independent transports and does not require ADB at runtime:

- **QR / LAN** — scan a short-lived desktop QR code (or paste its manual pairing URI) while both devices are on the same private network.
- **USB accessory** — Android Open Accessory (AOA) over a USB data cable.

The package is `com.scrcpyguiplus.companion`, with debug version `1.0.0`.

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

## QR / LAN pairing

1. Put the phone and desktop on the same trusted private Wi-Fi/LAN.
2. On the desktop, open **Devices → Connection Tools → Android Companion** and choose **QR / LAN**.
3. In the Android app, choose **Scan desktop QR**. If Google Code Scanner is unavailable, expand the desktop manual code, paste it into Android, and choose **Connect with pairing code**.
4. Keep the Android Activity in the foreground while connected. To mirror the phone, click **Start screen** in the desktop Companion panel and approve Android's system screen-capture dialog. The first version is view-only and sends bounded JPEG frames over a second LAN socket; it does not inject touch input.

The desktop binds a temporary TCP listener and generates a `scrcpy-gui-plus://pair` URI containing its private IPv4 address, ephemeral port, protocol version, and a random 256-bit token. The offer expires after two minutes, accepts one authenticated companion, limits rejected attempts, and is cancelled when the user disconnects or the desktop closes.

The token authenticates pairing but the MVP raw TCP stream is **not encrypted**. Use LAN mode only on a trusted private network. A later version can add QR-pinned TLS without changing the application framing.

## USB accessory mode

The manifest filter at `app/src/main/res/xml/usb_accessory_filter.xml` matches:

- manufacturer: `Scrcpy GUI Plus`
- model: `Companion`
- version: `1`

Keep the phone unlocked and the app open. On the desktop choose **Start USB Companion**; switching to accessory mode can interrupt the current ADB/scrcpy session. Accept Android's USB permission dialog. **Check USB accessory** only rechecks an accessory already initiated by the desktop and cannot start AOA itself.

## Application protocol

Both transports use the same stream protocol: a 4-byte unsigned big-endian payload length followed by UTF-8 JSON. Payload lengths are restricted to `1..1048576` bytes. Partial reads are handled; malformed lengths and truncated frames close only the session.

The first Android frame is a hello:

```json
{"type":"hello","protocol":1,"app":"Scrcpy GUI Plus Companion","package":"com.scrcpyguiplus.companion","version":"1.0.0","capabilities":["ping","get_device_info","clipboard_set","clipboard_get","open_url","start_screen_share","stop_screen_share"]}
```

LAN adds the one-time `token` field to this hello. USB keeps the original hello unchanged.

Requests and responses:

```json
{"type":"request","id":1,"method":"ping","params":{}}
{"type":"response","id":1,"ok":true,"result":{"message":"pong"},"error":null}
```

Supported control methods are `ping`, `get_device_info`, `clipboard_set`, `clipboard_get`, `open_url`, `start_screen_share`, and `stop_screen_share`. URLs are restricted to `http` and `https`. `start_screen_share` carries a one-time screen token, generation, private LAN endpoint, and JPEG limits; Android replies first on the control socket, asks the user for MediaProjection permission, then connects to the separate screen socket. JPEG frames use the same 4-byte length prefix but are bounded to 2 MiB. Unknown methods and malformed request JSON return bounded error responses; invalid framing closes the session.

## Runtime limitations

- The Activity owns both USB and LAN control sessions and closes them in `onStop()`. Screen capture is owned by a mediaProjection foreground service so Android 14+ can enforce the required capture contract; leaving the app still stops the Companion control session and capture when no permission dialog is pending.
- Screen streaming requires the user to approve Android's MediaProjection system dialog for each capture session. It is view-only in this MVP; touch/keyboard control still requires ADB or a separate Android accessibility/control integration.
- Opening a URL launches another Activity and intentionally ends the current foreground-owned session after its response is flushed.
- Google Code Scanner depends on Google Play services; manual LAN pairing is the fallback on devices where it is unavailable.
- Firewalls can block the desktop listener. QR / LAN requires direct reachability on the same private network.
- JVM tests cannot verify physical USB behavior, vendor permission dialogs, camera/scanner availability, firewall policy, or real network routing; these need hardware smoke tests.
