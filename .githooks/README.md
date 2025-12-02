# Git Hooks

This directory contains git hooks for the Beamable DePIN monorepo.

## Installation

Run the installation script from the repository root:

```bash
./.githooks/install-hooks.sh
```

This configures git to use hooks from this directory.

## Available Hooks

### commit-msg

Validates that commit messages follow the [Conventional Commits](https://www.conventionalcommits.org/) format.

**Required format:**
```
<type>: <description>
```

**Valid types:**
- `feat` - A new feature
- `fix` - A bug fix
- `docs` - Documentation changes
- `style` - Code style changes (formatting, etc.)
- `refactor` - Code refactoring
- `perf` - Performance improvements
- `test` - Adding or updating tests
- `chore` - Maintenance tasks
- `build` - Build system changes
- `ci` - CI/CD changes

**Examples:**
```bash
git commit -m "feat: add batch processing support"
git commit -m "fix: resolve connection timeout"
git commit -m "docs: update README"
git commit -m "chore: update dependencies"
```

**Breaking changes:**
Use `!` after the type to indicate breaking changes:
```bash
git commit -m "feat!: breaking API change"
```

**Note:** Scopes are optional and generally not needed since changelogs are generated per-package using file paths. If you want to use a scope for clarity (e.g., `feat(auth): ...`), you can, but it's not required or validated.

## Bypassing Hooks

In rare cases where you need to bypass the hooks (not recommended), use:

```bash
git commit --no-verify -m "your message"
```

However, this is discouraged as it will result in changelogs not being generated correctly.
