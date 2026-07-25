import * as vscode from 'vscode';
import { PackageReference } from '../models/PackageReference';
import { PackageVersionInfo } from '../models/PackageVersionInfo';
import { VersionFlags } from '../models/VersionFlags';
import { VulnerabilityInfo, highestSeverity, vulnerabilitySeverityLabel } from '../models/VulnerabilityInfo';
import { NuGetSource } from '../models/NuGetSource';
import { NuGetConfigParser, NUGET_ORG_URL, isAzureArtifactsUrl } from '../parsers/NuGetConfigParser';
import { compareVersions, computeUpgradeRecommendation, parseVersion } from '../utils/semver';
import { getFeedUrlOverride, getIncludePrerelease } from '../utils/config';
import { NuGetClient } from './NuGetClient';

const SUPPLEMENTAL_NUGET_ORG_SOURCE: NuGetSource = {
    name: 'nuget.org (supplemental vulnerability check)',
    url: NUGET_ORG_URL,
    isAzureArtifacts: false
};

export class UpgradeService {

    private readonly configParser = new NuGetConfigParser();
    private lastLoggedFeedUrlOverride: string | undefined;

    constructor(
        private readonly nugetClient: NuGetClient,
        private readonly outputChannel: vscode.OutputChannel
    ) {}

    public async checkPackages(filePath: string, packages: PackageReference[]): Promise<Map<string, PackageVersionInfo>> {
        const sources = this.resolveSources(filePath);
        const results = new Map<string, PackageVersionInfo>();

        await Promise.all(packages.map(async pkg => {
            const info = await this.checkPackage(pkg, sources);
            if (info) {
                results.set(pkg.packageId.toLowerCase(), info);
            }
        }));

        return results;
    }

    private resolveSources(filePath: string): NuGetSource[] {
        const feedUrlOverride = getFeedUrlOverride();
        if (feedUrlOverride) {
            if (this.lastLoggedFeedUrlOverride !== feedUrlOverride) {
                this.lastLoggedFeedUrlOverride = feedUrlOverride;
                this.outputChannel.appendLine(
                    `[NuGet Lens] nugetUpgrade.feedUrl is set — using "${feedUrlOverride}" instead of nuget.config for all lookups. ` +
                    `Clear this setting to go back to normal nuget.config resolution (with a nuget.org fallback when no nuget.config is found).`
                );
            }
            return [{
                name: 'nugetUpgrade.feedUrl override',
                url: feedUrlOverride,
                isAzureArtifacts: isAzureArtifactsUrl(feedUrlOverride)
            }];
        }
        if (this.lastLoggedFeedUrlOverride !== undefined) {
            this.lastLoggedFeedUrlOverride = undefined;
        }
        return this.configParser.resolveSources(filePath);
    }

    private async checkPackage(pkg: PackageReference, sources: NuGetSource[]): Promise<PackageVersionInfo | undefined> {
        let versions: string[] = [];
        let primarySource: NuGetSource | undefined;

        for (const source of sources) {
            const candidates = await this.nugetClient.getVersions(source, pkg.packageId);
            if (candidates.length > 0) {
                versions = candidates;
                primarySource = source;
                break;
            }
        }

        if (!primarySource) {
            return undefined;
        }

        const upgradeRecommendation = computeUpgradeRecommendation(pkg.version, versions, getIncludePrerelease());
        const versionFlags = await this.collectVersionFlags(pkg.packageId, versions, sources);

        const matchedVersion = findMatchingVersion(pkg.version, versions) ?? pkg.version;
        const currentFlags = versionFlags.get(matchedVersion);

        return {
            packageId: pkg.packageId,
            latestVersion: upgradeRecommendation.latestMajor ?? pkg.version,
            versions,
            isDeprecated: !!currentFlags?.deprecationMessage,
            deprecationMessage: currentFlags?.deprecationMessage,
            isVulnerable: !!currentFlags && currentFlags.vulnerabilities.length > 0,
            vulnerabilities: currentFlags?.vulnerabilities ?? [],
            versionFlags,
            upgradeRecommendation
        };
    }

    // Deprecation/vulnerability data is checked across every configured source (not just the one
    // that won the version lookup) since private mirrors often proxy packages without republishing
    // this metadata. nuget.org's vulnerability database is additionally always consulted when it
    // isn't already configured — most other feeds, including private mirrors and Azure Artifacts,
    // don't implement NuGet's VulnerabilityInfo resource at all.
    private async collectVersionFlags(packageId: string, versions: string[], sources: NuGetSource[]): Promise<Map<string, VersionFlags>> {
        const merged = new Map<string, VersionFlags>();

        await Promise.all(sources.map(async source => {
            const flags = await this.nugetClient.getVersionFlags(source, packageId, versions);
            for (const [version, flag] of flags) {
                mergeFlagInto(merged, version, flag);
            }
        }));

        if (!sources.some(s => s.url === NUGET_ORG_URL)) {
            const vulnerabilities = await this.nugetClient.getVulnerabilities(SUPPLEMENTAL_NUGET_ORG_SOURCE, packageId, versions);
            for (const [version, list] of vulnerabilities) {
                mergeFlagInto(merged, version, { deprecationMessage: undefined, vulnerabilities: list });
            }
        }

        return merged;
    }
}

function mergeFlagInto(map: Map<string, VersionFlags>, version: string, flag: VersionFlags): void {
    const existing = map.get(version);
    const seenUrls = new Set(existing?.vulnerabilities.map(v => v.url) ?? []);
    const vulnerabilities: VulnerabilityInfo[] = existing ? [...existing.vulnerabilities] : [];

    for (const v of flag.vulnerabilities) {
        if (!seenUrls.has(v.url)) {
            seenUrls.add(v.url);
            vulnerabilities.push(v);
        }
    }

    map.set(version, {
        deprecationMessage: existing?.deprecationMessage ?? flag.deprecationMessage,
        vulnerabilities
    });
}

function findMatchingVersion(target: string, candidates: string[]): string | undefined {
    const targetParsed = parseVersion(target);
    if (!targetParsed) {
        return undefined;
    }
    return candidates.find(c => {
        const parsed = parseVersion(c);
        return !!parsed && compareVersions(parsed, targetParsed) === 0;
    });
}

export function formatUpgradeSummary(packageId: string, info: PackageVersionInfo): string {
    const rec = info.upgradeRecommendation;
    const upgradeText = rec?.hasUpgrade
        ? `${rec.currentVersion} -> ${rec.latestMajor} available`
        : `${rec?.currentVersion ?? ''} is up to date`;
    const deprecatedText = info.isDeprecated ? ` [DEPRECATED: ${info.deprecationMessage}]` : '';
    const vulnerableText = info.isVulnerable
        ? ` [VULNERABLE (${vulnerabilitySeverityLabel(highestSeverity(info.vulnerabilities))}): ${info.vulnerabilities.map(v => v.url).join(', ')}]`
        : '';
    return `${packageId} ${upgradeText}${deprecatedText}${vulnerableText}`;
}

export function outputPackageSummary(outputChannel: vscode.OutputChannel, packages: PackageReference[], infos: Map<string, PackageVersionInfo>): void {
    for (const pkg of packages) {
        const info = infos.get(pkg.packageId.toLowerCase());
        if (info) {
            outputChannel.appendLine(`[NuGet Lens]   ${formatUpgradeSummary(pkg.packageId, info)}`);
        } else {
            outputChannel.appendLine(`[NuGet Lens]   ${pkg.packageId} ${pkg.version} (unable to determine latest version)`);
        }
    }
}
