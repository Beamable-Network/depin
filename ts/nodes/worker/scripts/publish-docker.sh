#!/usr/bin/env bash

# Publish script for the Worker Docker image
# Usage: ./scripts/publish-docker.sh [image-name]
# Example: ./scripts/publish-docker.sh dpatekar/worker

set -euo pipefail

IMAGE_NAME="${1:-beamablenetwork/worker}"

# Find the ts workspace root (look for pnpm-workspace.yaml)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR" && while [[ ! -f "pnpm-workspace.yaml" && "$(pwd)" != "/" ]]; do cd ..; done; pwd)"

if [[ ! -f "$WORKSPACE_ROOT/pnpm-workspace.yaml" ]]; then
  echo "Error: Could not find ts workspace root with pnpm-workspace.yaml (looked from $SCRIPT_DIR)" >&2
  exit 1
fi

# Extract version from package.json
VERSION=$(node -p "require('$WORKSPACE_ROOT/nodes/worker/package.json').version")

echo "Publishing DePIN Worker Docker image"
echo " - Image: $IMAGE_NAME"
echo " - Version: $VERSION"

echo ""
echo "Pushing ${IMAGE_NAME}:${VERSION}..."
docker push "${IMAGE_NAME}:${VERSION}"

echo ""
echo "Pushing ${IMAGE_NAME}:latest..."
docker push "${IMAGE_NAME}:latest"

echo ""
echo "✓ Publish complete:"
echo "  - ${IMAGE_NAME}:${VERSION}"
echo "  - ${IMAGE_NAME}:latest"
