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
