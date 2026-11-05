#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('${ROOT_DIR}/package.json').version")"
RELEASE_NAME="forever-ai-radio-local-v${VERSION}"
OUTPUT_DIR="${1:-${ROOT_DIR}/.release}"
mkdir -p "${OUTPUT_DIR}"
OUTPUT_DIR="$(cd "${OUTPUT_DIR}" && pwd)"
ARCHIVE_PATH="${OUTPUT_DIR}/${RELEASE_NAME}.zip"
STAGING_ROOT="$(mktemp -d)"
PACKAGE_DIR="${STAGING_ROOT}/forever-ai-radio"

cleanup() {
  rm -rf "${STAGING_ROOT}"
}
trap cleanup EXIT

mkdir -p "${PACKAGE_DIR}"

cp \
  "${ROOT_DIR}/package.json" \
  "${ROOT_DIR}/package-lock.json" \
  "${ROOT_DIR}/.env.example" \
  "${ROOT_DIR}/.gitignore" \
  "${ROOT_DIR}/README.md" \
  "${ROOT_DIR}/PRODUCT.md" \
  "${ROOT_DIR}/DEPLOYMENT.md" \
  "${ROOT_DIR}/DESKTOP.md" \
  "${PACKAGE_DIR}/"

cp -R \
  "${ROOT_DIR}/build" \
  "${ROOT_DIR}/desktop" \
  "${ROOT_DIR}/src" \
  "${ROOT_DIR}/public" \
  "${ROOT_DIR}/prompts" \
  "${ROOT_DIR}/scripts" \
  "${ROOT_DIR}/test" \
  "${PACKAGE_DIR}/"

rm -rf "${PACKAGE_DIR}/public/uploads"
rm -f "${PACKAGE_DIR}/build/icon-source.jpg"
mkdir -p \
  "${PACKAGE_DIR}/public/uploads" \
  "${PACKAGE_DIR}/cache/tts" \
  "${PACKAGE_DIR}/user"

touch \
  "${PACKAGE_DIR}/public/uploads/.gitkeep" \
  "${PACKAGE_DIR}/cache/tts/.gitkeep"

printf '# My Taste\n\n在 Forever Lab 的“记忆”分页填写你的长期音乐偏好。\n' \
  > "${PACKAGE_DIR}/user/taste.md"
printf '# Routines\n\n在这里记录与你的收听习惯有关的时间和场景。\n' \
  > "${PACKAGE_DIR}/user/routines.md"
printf '# Mood Rules\n\n在这里记录天气、情绪和音乐风格之间的偏好。\n' \
  > "${PACKAGE_DIR}/user/mood-rules.md"
printf '{\n  "favorites": [],\n  "morning": []\n}\n' \
  > "${PACKAGE_DIR}/user/playlists.json"

find "${PACKAGE_DIR}" -name '.DS_Store' -delete
rm -f "${ARCHIVE_PATH}" "${ARCHIVE_PATH}.sha256"

(
  cd "${STAGING_ROOT}"
  zip -qr "${ARCHIVE_PATH}" forever-ai-radio
)

if command -v shasum >/dev/null 2>&1; then
  (
    cd "${OUTPUT_DIR}"
    shasum -a 256 "$(basename "${ARCHIVE_PATH}")" > "$(basename "${ARCHIVE_PATH}").sha256"
  )
elif command -v sha256sum >/dev/null 2>&1; then
  (
    cd "${OUTPUT_DIR}"
    sha256sum "$(basename "${ARCHIVE_PATH}")" > "$(basename "${ARCHIVE_PATH}").sha256"
  )
else
  echo "Warning: no SHA-256 utility found; checksum was not generated." >&2
fi

echo "${ARCHIVE_PATH}"
