#!/bin/sh
set -eu

# XcodeGen preBuildScripts: https://github.com/yonaskolb/XcodeGen/blob/master/Docs/ProjectSpec.md#build-script
# Archive/install and Release device builds must not produce a distributable archive.
if [ "${ACTION:-}" = "install" ] || { [ "${CONFIGURATION:-}" = "Release" ] && [ "${PLATFORM_NAME:-}" = "iphoneos" ]; }; then
  exec node "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/check-owned-release.mjs"
fi
