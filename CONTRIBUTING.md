# Contributing

## Development Setup

1. Clone the repo
2. Install dependencies: `npm install`
3. Compile: `npm run compile`
4. Press `F5` in VS Code to run in debug mode

## Branching

- `master` — stable, protected. PRs only.
- Feature branches: `feature/your-feature`
- Bug fixes: `fix/your-bug`

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add support for property analyzers
fix: codelens not refreshing on save
chore: bump eslint to 9.40
docs: update README with usage instructions
```

## Versioning

The version in `package.json` is bumped automatically (`npm version patch`) by the release workflow when changes land on `master` — see `.github/workflows/release.yml`.

**Do not manually edit the version in `package.json`.**
