#!/bin/bash

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Navigate to repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

echo -e "${BLUE}Installing git hooks...${NC}\n"

# Configure git to use .githooks directory
git config core.hooksPath .githooks

echo -e "${GREEN}✓ Git hooks installed successfully!${NC}\n"
echo "Git is now configured to use hooks from .githooks/"
echo ""
echo "The commit-msg hook will now validate your commit messages."
echo ""
echo "Example valid commits:"
echo "  git commit -m \"feat: add new feature\""
echo "  git commit -m \"fix: resolve bug\""
echo "  git commit -m \"docs: update README\""
