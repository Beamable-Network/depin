#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Package configuration
PACKAGE_NAME="Checker"
TAG_PREFIX="checker"
VERSION_FILE="package.json"
CHANGELOG_SCRIPT="changelog:checker"

# Navigate to package root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PACKAGE_DIR/../../.." && pwd)"

cd "$REPO_ROOT"

echo -e "${BLUE}=== Beamable DePIN ${PACKAGE_NAME} Release ===${NC}\n"

# Check if on main branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo -e "${RED}Error: You must be on the 'main' branch to release.${NC}"
    echo -e "Current branch: ${YELLOW}$CURRENT_BRANCH${NC}"
    exit 1
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo -e "${RED}Error: You have uncommitted changes.${NC}"
    echo -e "Please commit or stash your changes before releasing.\n"
    git status --short
    exit 1
fi

# Read current version from package.json
CURRENT_VERSION=$(node -p "require('./$VERSION_FILE').version")
echo -e "${GREEN}Current version:${NC} $CURRENT_VERSION"

# Parse version components
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

# Calculate version bumps
PATCH_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
MINOR_VERSION="$MAJOR.$((MINOR + 1)).0"
MAJOR_VERSION="$((MAJOR + 1)).0.0"

# Prompt for new version
echo -e "\n${YELLOW}Select version bump:${NC}"
echo "  1) Patch ($PATCH_VERSION)"
echo "  2) Minor ($MINOR_VERSION)"
echo "  3) Major ($MAJOR_VERSION)"
echo "  4) Custom"
echo -e "  q) Quit\n"

read -p "Enter choice [1-4, q]: " choice

case $choice in
    1) NEW_VERSION="$PATCH_VERSION" ;;
    2) NEW_VERSION="$MINOR_VERSION" ;;
    3) NEW_VERSION="$MAJOR_VERSION" ;;
    4)
        read -p "Enter custom version: " NEW_VERSION
        # Basic semver validation
        if ! [[ $NEW_VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo -e "${RED}Error: Invalid version format. Use semver (e.g., 1.2.3)${NC}"
            exit 1
        fi
        ;;
    q|Q) echo "Aborted."; exit 0 ;;
    *) echo -e "${RED}Invalid choice.${NC}"; exit 1 ;;
esac

echo -e "\n${GREEN}New version:${NC} $NEW_VERSION"

# Check if tag already exists
if git rev-parse "${TAG_PREFIX}-v${NEW_VERSION}" >/dev/null 2>&1; then
    echo -e "${RED}Error: Tag ${TAG_PREFIX}-v${NEW_VERSION} already exists.${NC}"
    exit 1
fi

# Update version in package.json
echo -e "\n${BLUE}Updating version in $VERSION_FILE...${NC}"
RELATIVE_VERSION_FILE="ts/nodes/checker/$VERSION_FILE"
# Use a temp file for atomic update
TMP_FILE=$(mktemp)
node -e "const pkg = require('./$RELATIVE_VERSION_FILE'); pkg.version = '$NEW_VERSION'; console.log(JSON.stringify(pkg, null, 2));" > "$TMP_FILE"
mv "$TMP_FILE" "$RELATIVE_VERSION_FILE"
echo -e "${GREEN}✓ Version updated${NC}"

# Generate changelog
echo -e "\n${BLUE}Generating changelog...${NC}"
pnpm run "$CHANGELOG_SCRIPT"
echo -e "${GREEN}✓ Changelog generated${NC}"

# Show changes
echo -e "\n${YELLOW}Changes to be committed:${NC}"
git diff "$RELATIVE_VERSION_FILE" "ts/nodes/checker/CHANGELOG.md"

# Confirm commit
echo -e "\n${YELLOW}Commit these changes?${NC} [y/N]"
read -p "> " confirm
if [[ ! $confirm =~ ^[Yy]$ ]]; then
    echo -e "${RED}Aborted. Changes not committed.${NC}"
    git checkout -- "$RELATIVE_VERSION_FILE" "ts/nodes/checker/CHANGELOG.md"
    exit 1
fi

# Commit
echo -e "\n${BLUE}Creating commit...${NC}"
git add "$RELATIVE_VERSION_FILE" "ts/nodes/checker/CHANGELOG.md"
git commit -m "chore: release ${TAG_PREFIX}-v${NEW_VERSION}"
echo -e "${GREEN}✓ Committed${NC}"

# Create tag
echo -e "\n${BLUE}Creating tag ${TAG_PREFIX}-v${NEW_VERSION}...${NC}"
git tag -a "${TAG_PREFIX}-v${NEW_VERSION}" -m "${PACKAGE_NAME} release v${NEW_VERSION}"
echo -e "${GREEN}✓ Tag created${NC}"

# Push
echo -e "\n${YELLOW}Push commit and tag to remote?${NC} [y/N]"
read -p "> " push_confirm
if [[ $push_confirm =~ ^[Yy]$ ]]; then
    echo -e "\n${BLUE}Pushing to remote...${NC}"
    git push && git push --tags
    echo -e "${GREEN}✓ Pushed${NC}"
else
    echo -e "${YELLOW}Skipped push. Run manually when ready:${NC}"
    echo "  git push && git push --tags"
fi

echo -e "\n${GREEN}✓ Release ${NEW_VERSION} completed successfully!${NC}"
echo -e "\n${BLUE}Next steps:${NC}"
echo "  cd ts/nodes/checker"
echo "  pnpm build"
echo "  # Deploy to servers"
