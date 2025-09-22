#!/usr/bin/env bash

# Build script for the Worker Docker image
# Usage: ./scripts/build-docker.sh [tag]

set -euo pipefail

TAG="${1:-beamable-network/worker:latest}"

# Find the ts workspace root (look for pnpm-workspace.yaml)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR" && while [[ ! -f "pnpm-workspace.yaml" && "$(pwd)" != "/" ]]; do cd ..; done; pwd)"

if [[ ! -f "$WORKSPACE_ROOT/pnpm-workspace.yaml" ]]; then
  echo "Error: Could not find ts workspace root with pnpm-workspace.yaml (looked from $SCRIPT_DIR)" >&2
  exit 1
fi

DOCKERFILE_PATH="nodes/worker/Dockerfile"

echo "Building DePIN Worker Docker image: $TAG"
echo " - Workspace: $WORKSPACE_ROOT"
echo " - Dockerfile: $DOCKERFILE_PATH"

cd "$WORKSPACE_ROOT"

docker build \
  -f "$DOCKERFILE_PATH" \
  -t "$TAG" \
  .

echo "✓ Build complete: $TAG"
