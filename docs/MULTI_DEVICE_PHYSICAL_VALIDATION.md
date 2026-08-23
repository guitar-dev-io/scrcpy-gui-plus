# Multi-Device Physical Validation

Use the in-app **Physical validation** control in the embedded multi-device
workspace to collect repeatable evidence for the remaining Phase 4 acceptance
test. Run the scenarios in order: 1, 4, then 9 physical Android devices.

## Prerequisites

- Every target appears as `device` in `adb devices -l`; resolve `offline` or
  `unauthorized` devices before starting.
- Devices are awake, unlocked, and have accepted the USB-debugging RSA prompt.
- `scrcpy --version` works and the scrcpy server is resolvable.
- Prefer powered USB hubs for 4/9-device runs. Do not place all devices behind
  one unpowered hub.
- Close unrelated recordings and logcat streams before the 9-device run.

The app resolves ADB from its configured tools directory, an app-local
`scrcpy-bin`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, the conventional macOS Android
SDK directory, or PATH (in that precedence order).

## Automated evidence

1. Open the embedded multi-device workspace.
2. Confirm at least the scenario's device count is online.
3. In **Physical validation**, select `1`, `4`, or `9` and choose
   **Start validation**.
4. The app starts exactly that many targets through the existing bounded,
   staggered startup policy.
5. Each target must connect, report non-zero dimensions, paint at least one
   decoded frame, and produce fresh per-device FPS samples during a continuous 15-second
   observation window. Startup and observation share a 60-second deadline.
6. When the run finishes, choose **Report**. The JSON report contains timings,
   min/average/max FPS, dimensions, status, and failures. Device serials are
   redacted by default. The 20 most recent reports are also retained in local
   storage.

The validation control does not stop sessions that were already running.
Cancelling stops the measurement and prevents it from being reported as a
pass; leaving the workspace persists the in-flight measurement as cancelled.
Use the workspace controls to stop streams if desired.

## Validation progress

- [x] 1-device automated run passed on 23 August 2026: 872 x 1920, 15.09-second
  observation, 10 FPS final, 14.38 FPS average, and fresh decoded frames.
- [x] 1-device manual visual-motion and input check passed using Recent apps,
  followed by Home to restore the device.
- [x] Additional 2-device smoke run displayed both physical screens and routed
  Recent apps/Home input to the second device. This is useful coverage but does
  not replace the required 4-device scenario. The second encoder reported 0
  FPS while its screen was static, then visibly updated after input.
- [x] A Grid subscriber opened after an active Dashboard stream reused the
  cached stream at 13 FPS without restarting or blanking the owner session.
- [ ] 4-device automated and manual run (only two physical devices were
  connected during the current validation session).
- [ ] 9-device automated and manual run.

Redacted evidence: [device-farm-validation-1-device-farm-1787491084791-1.json](./validation-evidence/device-farm-validation-1-device-farm-1787491084791-1.json)

## Manual evidence required

For every scenario, also verify and record:

- [ ] Every visible screen continues changing for the full observation period.
- [ ] Touch or Back/Home input reaches each intended device.
- [ ] Focusing one tile does not restart or blank the other streams.
- [ ] Fullscreen enter/exit preserves the selected device's session.
- [ ] Stop and restart works for one stream without disrupting the others.
- [ ] Disconnecting and reconnecting one device does not crash other streams.
- [ ] Host CPU/memory remains usable and USB/network errors are recorded.

Only check the Phase 4 physical acceptance item after reports and manual checks
exist for all three scenarios. Automated unit tests or a report from fewer
devices are not a substitute for the 1/4/9 physical run.
