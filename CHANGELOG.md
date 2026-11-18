# Change Log

All notable changes to the "nuget-lens" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Fixed
- `Directory.Packages.props` that declares the same package in several conditional `ItemGroup`s (e.g. stable/develop channels) now gets a separate, correct CodeLens per line instead of the lines overwriting each other.
- Feeds added via `RestoreAdditionalProjectSources` / `RestoreSources` in `Directory.Packages.props` or `Directory.Build.props` are now queried alongside `nuget.config` feeds.
- Available versions are merged across all configured feeds rather than taken from the first feed that has the package.
- 4-part versions (e.g. `2.10.9.593`) now compare on the revision segment, and prerelease labels follow SemVer/NuGet ordering (`develop.10` > `develop.9`, case-insensitive).

- Initial release