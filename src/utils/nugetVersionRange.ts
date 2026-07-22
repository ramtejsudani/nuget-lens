import { compareVersions, parseVersion } from './semver';

// NuGet version ranges use interval notation: "[1.0.0, 2.0.0)", "(, 13.0.1)", "[1.0.0]", or a bare
// "1.0.0" meaning "this version and above". See:
// https://learn.microsoft.com/en-us/nuget/concepts/package-versioning#version-ranges
export function isVersionInRange(version: string, range: string): boolean {
    const target = parseVersion(version);
    const trimmed = range.trim();
    if (!target || trimmed.length === 0) {
        return false;
    }

    const hasBrackets = trimmed.startsWith('[') || trimmed.startsWith('(');
    const inclusiveStart = trimmed.startsWith('[');
    const inclusiveEnd = trimmed.endsWith(']');
    const inner = hasBrackets ? trimmed.slice(1, -1) : trimmed;
    const parts = inner.split(',');

    if (parts.length === 1) {
        const single = parts[0].trim();
        const parsed = parseVersion(single);
        if (!parsed) {
            return false;
        }
        // "[1.0.0]" is an exact match; a bare "1.0.0" (no brackets) means "this version and above".
        return hasBrackets ? compareVersions(target, parsed) === 0 : compareVersions(target, parsed) >= 0;
    }

    const [minRaw, maxRaw] = parts.map(p => p.trim());
    const min = minRaw ? parseVersion(minRaw) : undefined;
    const max = maxRaw ? parseVersion(maxRaw) : undefined;

    if (min) {
        const cmp = compareVersions(target, min);
        if (inclusiveStart ? cmp < 0 : cmp <= 0) {
            return false;
        }
    }
    if (max) {
        const cmp = compareVersions(target, max);
        if (inclusiveEnd ? cmp > 0 : cmp >= 0) {
            return false;
        }
    }
    return true;
}
