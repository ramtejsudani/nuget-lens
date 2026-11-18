import { UpgradeRecommendation } from '../models/UpgradeRecommendation';

interface ParsedVersion {
    raw: string;
    major: number;
    minor: number;
    patch: number;
    revision: number;
    prerelease: string | null;
}

export function parseVersion(raw: string): ParsedVersion | null {
    const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/.exec(raw.trim());
    if (!match) {
        return null;
    }
    return {
        raw,
        major: Number(match[1] ?? 0),
        minor: Number(match[2] ?? 0),
        patch: Number(match[3] ?? 0),
        revision: Number(match[4] ?? 0),
        prerelease: match[5] ?? null
    };
}

export function isPrerelease(version: ParsedVersion): boolean {
    return version.prerelease !== null;
}

export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
    if (a.major !== b.major) { return a.major - b.major; }
    if (a.minor !== b.minor) { return a.minor - b.minor; }
    if (a.patch !== b.patch) { return a.patch - b.patch; }
    // NuGet's 4th "revision" segment (e.g. 2.10.9.593) is significant.
    if (a.revision !== b.revision) { return a.revision - b.revision; }
    if (a.prerelease === null && b.prerelease === null) { return 0; }
    if (a.prerelease === null) { return 1; }
    if (b.prerelease === null) { return -1; }
    return comparePrerelease(a.prerelease, b.prerelease);
}

// SemVer 2.0 precedence, case-insensitive like NuGet: dot-separated identifiers compared left to
// right; numeric identifiers compare numerically and rank below alphanumeric ones; a shorter list
// ranks lower when all preceding identifiers are equal (so develop.9 < develop.10 < develop.10.1).
function comparePrerelease(a: string, b: string): number {
    const aParts = a.toLowerCase().split('.');
    const bParts = b.toLowerCase().split('.');
    const length = Math.min(aParts.length, bParts.length);
    for (let i = 0; i < length; i++) {
        const x = aParts[i];
        const y = bParts[i];
        if (x === y) { continue; }
        const xNum = /^\d+$/.test(x);
        const yNum = /^\d+$/.test(y);
        if (xNum && yNum) {
            const diff = Number(x) - Number(y);
            if (diff !== 0) { return diff; }
            continue;
        }
        if (xNum) { return -1; }
        if (yNum) { return 1; }
        return x < y ? -1 : 1;
    }
    return aParts.length - bParts.length;
}

function maxOf(versions: ParsedVersion[]): ParsedVersion | undefined {
    return versions.reduce<ParsedVersion | undefined>((best, v) => {
        return !best || compareVersions(v, best) > 0 ? v : best;
    }, undefined);
}

export function computeUpgradeRecommendation(currentRaw: string, allVersions: string[], includePrerelease = false): UpgradeRecommendation {
    const current = parseVersion(currentRaw);
    const base: UpgradeRecommendation = { currentVersion: currentRaw, hasUpgrade: false };
    if (!current) {
        return base;
    }

    // Prerelease packages are allowed to upgrade to other prereleases; stable packages only consider
    // stable candidates unless the includePrerelease setting opts in.
    const candidates = allVersions
        .map(parseVersion)
        .filter((v): v is ParsedVersion => v !== null)
        .filter(v => includePrerelease || isPrerelease(current) || !isPrerelease(v));

    const sameMajorMinor = candidates.filter(v => v.major === current.major && v.minor === current.minor);
    const sameMajor = candidates.filter(v => v.major === current.major);

    const latestPatch = maxOf(sameMajorMinor);
    const latestMinor = maxOf(sameMajor);
    const latestMajor = maxOf(candidates);

    const hasUpgrade = !!latestMajor && compareVersions(latestMajor, current) > 0;

    return {
        currentVersion: currentRaw,
        latestPatch: latestPatch?.raw,
        latestMinor: latestMinor?.raw,
        latestMajor: latestMajor?.raw,
        hasUpgrade
    };
}
