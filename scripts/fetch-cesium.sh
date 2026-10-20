#!/usr/bin/env bash
# Downloads the pinned CesiumJS release build into web/vendor/cesium.
set -euo pipefail
VERSION="${CESIUM_VERSION:-1.145}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/web/vendor/cesium"
if [ -f "$DEST/Cesium.js" ] && [ "$(cat "$DEST/.version" 2>/dev/null)" = "$VERSION" ]; then
  echo "Cesium $VERSION already in web/vendor/cesium"; exit 0
fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "Downloading Cesium $VERSION…"
curl -fsSL -o "$TMP/cesium.zip" "https://github.com/CesiumGS/cesium/releases/download/$VERSION/Cesium-$VERSION.zip"
unzip -q "$TMP/cesium.zip" 'Build/Cesium/*' -d "$TMP"
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
mv "$TMP/Build/Cesium" "$DEST"
echo "$VERSION" > "$DEST/.version"
echo "Cesium $VERSION -> web/vendor/cesium"
