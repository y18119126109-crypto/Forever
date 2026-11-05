#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCH="${1:-arm64}"
VERSION="$(node -p "require('${ROOT_DIR}/package.json').version")"

case "${ARCH}" in
  arm64)
    APP_DIR="${ROOT_DIR}/dist-desktop/mac-arm64/Forever.app"
    ;;
  x64)
    APP_DIR="${ROOT_DIR}/dist-desktop/mac/Forever.app"
    ;;
  *)
    echo "Usage: $0 [arm64|x64]" >&2
    exit 2
    ;;
esac

if [[ ! -d "${APP_DIR}" ]]; then
  echo "Missing app bundle: ${APP_DIR}" >&2
  echo "Build the matching macOS app before creating the DMG." >&2
  exit 1
fi

node "${ROOT_DIR}/scripts/verify-macos-signature.js" "${APP_DIR}"

OUTPUT="${ROOT_DIR}/dist-desktop/Forever-${VERSION}-mac-${ARCH}.dmg"
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/forever-dmg.XXXXXX")"
RAW_IMAGE="${STAGING_DIR}.raw.dmg"

cleanup() {
  rm -rf "${STAGING_DIR}" "${RAW_IMAGE}"
}
trap cleanup EXIT

ditto "${APP_DIR}" "${STAGING_DIR}/Forever.app"
node "${ROOT_DIR}/scripts/verify-macos-signature.js" "${STAGING_DIR}/Forever.app"
ln -s /Applications "${STAGING_DIR}/Applications"

rm -f "${OUTPUT}"
if ! hdiutil create \
  -volname "Forever" \
  -srcfolder "${STAGING_DIR}" \
  -ov \
  -format UDZO \
  "${OUTPUT}"; then
  rm -f "${OUTPUT}" "${RAW_IMAGE}"
  hdiutil makehybrid \
    -hfs \
    -hfs-volume-name "Forever" \
    -o "${RAW_IMAGE}" \
    "${STAGING_DIR}"
  hdiutil convert \
    "${RAW_IMAGE}" \
    -format UDZO \
    -o "${OUTPUT}"
fi

echo "${OUTPUT}"
