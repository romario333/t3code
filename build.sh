#!/usr/bin/env bash
#
# Build the custom-fork T3 Code desktop dmg (Apple Silicon).
#
# Bump UPSTREAM_BASE once per port, to the upstream tag this branch was
# rebased onto. It feeds two things that must stay in sync:
#   - T3CODE_UPSTREAM_BASE : drives the in-app "new upstream release" pill
#   - --build-version      : stamps the build as <base>-auto.<N>
#
# Usage:
#   ./build.sh          # -> <base>-auto.1
#   ./build.sh 3        # -> <base>-auto.3   (bump N each rebuild of the same base)
#
set -euo pipefail

# The upstream tag this build is based on (stable or nightly).
UPSTREAM_BASE="v0.0.34-nightly.20260816.1106"

# Fork iteration on top of that base; override as the first argument.
BUILD_NUMBER="${1:-1}"

VERSION_BASE="${UPSTREAM_BASE#v}"          # v0.0.28 -> 0.0.28
BUILD_VERSION="${VERSION_BASE}-auto.${BUILD_NUMBER}"

# Run from the repo root regardless of where this is invoked from.
cd "$(dirname "$0")"

echo "Building T3 Code desktop dmg (arm64)"
echo "  base tag:      ${UPSTREAM_BASE}"
echo "  build version: ${BUILD_VERSION}"
echo

T3CODE_UPSTREAM_BASE="${UPSTREAM_BASE}" pnpm dist:desktop:dmg:arm64 --build-version "${BUILD_VERSION}"

echo
echo "Done. Artifact is in ./release/"
