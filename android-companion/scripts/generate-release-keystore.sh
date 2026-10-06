#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_KEYSTORE_PATH="$ANDROID_DIR/android-release.jks"
KEYSTORE_PATH="${1:-${ANDROID_RELEASE_KEYSTORE_PATH:-$DEFAULT_KEYSTORE_PATH}}"
KEY_ALIAS="${ANDROID_RELEASE_KEY_ALIAS:-scrcpy-gui-plus-release}"
KEY_DNAME="${ANDROID_RELEASE_KEY_DNAME:-CN=Scrcpy GUI Plus Android Release, OU=Mobile Device Studio, O=Guitar Dev, L=Unknown, ST=Unknown, C=US}"

if ! command -v keytool >/dev/null 2>&1; then
  echo "keytool was not found. Install JDK 17 or newer and try again." >&2
  exit 1
fi

if [[ -e "$KEYSTORE_PATH" ]]; then
  echo "Refusing to overwrite an existing keystore: $KEYSTORE_PATH" >&2
  echo "Back it up and choose another path if you intend to create a new signing identity." >&2
  exit 1
fi

read -r -s -p "Keystore password (minimum 6 characters): " STORE_PASSWORD
echo
read -r -s -p "Confirm keystore password: " STORE_PASSWORD_CONFIRM
echo
if [[ "$STORE_PASSWORD" != "$STORE_PASSWORD_CONFIRM" ]]; then
  echo "Keystore passwords do not match." >&2
  exit 1
fi

read -r -s -p "Private key password (minimum 6 characters): " KEY_PASSWORD
echo
read -r -s -p "Confirm private key password: " KEY_PASSWORD_CONFIRM
echo
if [[ "$KEY_PASSWORD" != "$KEY_PASSWORD_CONFIRM" ]]; then
  echo "Private key passwords do not match." >&2
  exit 1
fi

if (( ${#STORE_PASSWORD} < 6 || ${#KEY_PASSWORD} < 6 )); then
  echo "Keystore and private key passwords must contain at least 6 characters." >&2
  exit 1
fi

mkdir -p "$(dirname "$KEYSTORE_PATH")"
export ANDROID_RELEASE_STORE_PASSWORD="$STORE_PASSWORD"
export ANDROID_RELEASE_KEY_PASSWORD="$KEY_PASSWORD"

keytool -genkeypair \
  -keystore "$KEYSTORE_PATH" \
  -storetype JKS \
  -alias "$KEY_ALIAS" \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000 \
  -dname "$KEY_DNAME" \
  -storepass:env ANDROID_RELEASE_STORE_PASSWORD \
  -keypass:env ANDROID_RELEASE_KEY_PASSWORD

unset ANDROID_RELEASE_STORE_PASSWORD ANDROID_RELEASE_KEY_PASSWORD
chmod 600 "$KEYSTORE_PATH"

echo
echo "Created Android release keystore: $KEYSTORE_PATH"
echo "Signing alias: $KEY_ALIAS"
echo "Keep this keystore and both passwords in a secure offline backup."
echo "Never commit the keystore or passwords to Git."
echo
echo "To prepare the GitHub Actions base64 secret without printing it:"
echo "  base64 < '$KEYSTORE_PATH' | tr -d '\\n' | gh secret set ANDROID_RELEASE_KEYSTORE_BASE64 --env android-release"
