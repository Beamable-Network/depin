#!/usr/bin/env bash

# Build script for the Checker Docker image
# Usage: ./scripts/build-docker.sh [image-name]
# Example: ./scripts/build-docker.sh dpatekar/checker

set -euo pipefail

IMAGE_NAME="${1:-beamable-network/checker}"

# Find the ts workspace root (look for pnpm-workspace.yaml)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR" && while [[ ! -f "pnpm-workspace.yaml" && "$(pwd)" != "/" ]]; do cd ..; done; pwd)"

if [[ ! -f "$WORKSPACE_ROOT/pnpm-workspace.yaml" ]]; then
  echo "Error: Could not find ts workspace root with pnpm-workspace.yaml (looked from $SCRIPT_DIR)" >&2
  exit 1
fi

# Extract version from package.json
VERSION=$(node -p "require('$WORKSPACE_ROOT/nodes/checker/package.json').version")

DOCKERFILE_PATH="nodes/checker/Dockerfile"

echo "Building DePIN Checker Docker image"
echo " - Workspace: $WORKSPACE_ROOT"
echo " - Dockerfile: $DOCKERFILE_PATH"
echo " - Version: $VERSION"
echo " - Tags: ${IMAGE_NAME}:${VERSION}, ${IMAGE_NAME}:latest"

cd "$WORKSPACE_ROOT"

docker build \
  -f "$DOCKERFILE_PATH" \
  -t "${IMAGE_NAME}:${VERSION}" \
  -t "${IMAGE_NAME}:latest" \
  .

echo "✓ Build complete:"
echo "  - ${IMAGE_NAME}:${VERSION}"
echo "  - ${IMAGE_NAME}:latest"
