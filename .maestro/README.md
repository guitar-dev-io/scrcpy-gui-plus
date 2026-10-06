# Maestro mobile tests

## WashXpress smoke test

Prerequisites:

- An Android device or emulator visible to `adb devices`
- WashXpress (`com.laundryyou.washxpress`) installed
- Maestro CLI installed

Run:

```bash
maestro test .maestro/washxpress-smoke.yaml
```

The flow is deliberately read-only from a business perspective: it does not
clear app data, sign in, top up a wallet, scan a washer, or start a paid cycle.
It checks cold launch, a recognizable first-party screen, background/resume,
and captures two screenshots for evidence.

If the app copy uses different UI text, inspect it with `maestro studio` and
replace the text selector with a stable Android resource ID when available.

## HIP IoT — data-driven "create Audit invite" flow

See [`examples/HIP_IOT_ADD_TWO_MEMBERS.md`](examples/HIP_IOT_ADD_TWO_MEMBERS.md)
and [`examples/hip-iot-add-two-members.yaml`](examples/hip-iot-add-two-members.yaml).
Automates `com.hip.iot`'s per-branch "เพิ่มสมาชิก" (Add member) action via
the Script Manager's **Data Source** dialog, using Cross Join over a
`homes` dataset (`data/hip-iot-two-members.json` has a sample) and a
`members` dataset — 1 home × 2 members = 2 runs, matching a branch CSV's
`EMAIL`/`EMAIL2` columns. Real data (`local-data/*.json`) is
gitignored — never commit real branch/staff emails to this repo.

**Verified end-to-end on a real device** (tested against `WX0005-test`,
a sandbox branch): open branch by code → "เพิ่มสมาชิก" → "คัดลอก" (Copy).
This creates a pending invite (shows as "New member / รอให้เข้าร่วม",
3-day expiry, role "Common Member") and copies its invite link to the
clipboard. No typing/inputText is involved — **the "App account" share
option was tried and rejected both a real and a fake email with "Unable
to add the account"; it expects an internal account number, not an
email, so it's not used.**

**Important limitation:** the invite created by "คัดลอก" is generic —
it is not tied to any email until the recipient opens the link and logs
in. This flow gets you to "one invite link created per member row." It
does **not** yet send that link to the corresponding `MEMBER_ACCOUNT`
automatically — see the example doc for details.
