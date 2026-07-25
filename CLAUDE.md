# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

VS Code extension (v0.0.1, unreleased) that scans `Directory.Packages.props`, `.csproj`, and `packages.config` files for NuGet package references, checks each package's latest version and deprecation status against the feeds in `nuget.config`, and offers in-editor CodeLens upgrades. Azure Artifacts feeds are supported via a PAT stored in VS Code SecretStorage.

## Commands

- `npm run compile` — compile TypeScript (`src` → `out`) via `tsc -p ./`
- `npm run watch` — compile in watch mode
- `npm run lint` — ESLint over `src`
- `npm test` — runs `pretest` (compile + lint) then `vscode-test`, which executes compiled tests matching `out/test/**/*.test.js` (config in `.vscode-test.mjs`)
- Debug/manually run the extension: F5 in VS Code (or the "Run Extension" launch config in `.vscode/launch.json`), which compiles then opens a new Extension Development Host window

There is no single-test filter configured; `vscode-test` runs the whole Mocha suite in `out/test/`.

## Architecture

All source lives under `src/`:

- **`extension.ts`** — activation entry point. Auto-scans supported files on open/focus (logging findings + upgrade/deprecation status to the `NuGet Lens` output channel), registers the CodeLens provider, and wires up the `nuget-lens.viewPackagesInCurrentFile`, `nuget-lens.upgradePackage`, `nuget-lens.showPackageWarning`, and `nuget-lens.setFeedCredentials` commands.
- **`Services/packagescanner.ts`** (`PackageScanner`) — decides which parser applies to a document by filename (`Directory.Packages.props`, `*.csproj`, or `packages.config`, matched via `path.basename` to avoid false positives like `OtherPackages.config`) and dispatches to the matching parser, returning `PackageReference[]`.
- **`parsers/DirectoryPackagesParser.ts`**, **`parsers/CsprojParser.ts`**, **`parsers/PackagesConfigParser.ts`** — each parses its XML format (via `fast-xml-parser`) into `PackageReference[]`, then calls `utils/xmlLineNumbers.ts#assignLineNumbersByTag` to recover line numbers by re-scanning the raw text for the relevant opening tag in document order (fast-xml-parser itself discards element positions). `CsprojParser` skips Central-Package-Management references that omit `Version` (nothing to check locally) and uses the `@_` attribute prefix, unlike the other two parsers, to avoid an attribute/child-element name collision on `Version`.
- **`parsers/NuGetConfigParser.ts`** — walks up from a project file to the nearest `nuget.config`, parses `<packageSources>` into `NuGetSource[]`, and flags Azure Artifacts feeds (`pkgs.dev.azure.com` / `*.pkgs.visualstudio.com`) via `isAzureArtifacts`. Falls back to `nuget.org` if no config is found.
- **`Services/NuGetClient.ts`** — speaks the NuGet v3 protocol: resolves the service index once per source (cached), then uses the `PackageBaseAddress/3.0.0` resource for version lists and `RegistrationsBaseUrl` for per-version deprecation metadata (paginated registration pages are only fetched when the target version falls in that page's `lower`/`upper` range). Adds Basic-auth headers for Azure Artifacts feeds via `CredentialService`; on 401/403 for a non-Azure feed it logs a suggestion to configure credentials externally rather than attempting to handle them.
- **`Services/CredentialService.ts`** — prompts for an Azure Artifacts PAT via a password-masked input box and stores it in `context.secrets` (OS keychain), never on disk. Remembers a declined prompt for the session to avoid re-prompting repeatedly.
- **`Services/UpgradeService.ts`** — orchestrates parser + `NuGetConfigParser` + `NuGetClient` for a document's packages, producing `PackageVersionInfo` (upgrade recommendation via `utils/semver.ts#computeUpgradeRecommendation`, plus deprecation message) per package, and formats the output-channel summary.
- **`providers/PackageCodeLensProvider.ts`** — shows an "⬆ Upgrade" lens (opens a `QuickPick` of all available versions) and a separate "⚠ Deprecated" lens per package line, when applicable.

Models live in `src/models/`: `PackageReference`, `PackageVersionInfo`, `UpgradeRecommendation`, `NuGetSource`, `DeprecationInfo`.
