import axios from 'axios';
import * as vscode from 'vscode';
import { NuGetSource } from '../models/NuGetSource';
import { DeprecationInfo } from '../models/DeprecationInfo';
import { VulnerabilityInfo } from '../models/VulnerabilityInfo';
import { VersionFlags } from '../models/VersionFlags';
import { compareVersions, parseVersion } from '../utils/semver';
import { isVersionInRange } from '../utils/nugetVersionRange';
import { formatDeprecationMessage } from '../utils/deprecation';
import { getCacheTtlMs } from '../utils/config';
import { TtlCache } from '../utils/ttlCache';
import { CredentialService } from './CredentialService';

interface ServiceIndexResource {
    '@id': string;
    '@type': string;
}

interface RegistrationPage {
    '@id': string;
    items?: RegistrationLeaf[];
}

interface RawDeprecation {
    message?: string;
    reasons?: string[];
    alternatePackage?: { id?: string; range?: string };
}

interface RegistrationLeaf {
    catalogEntry?: {
        version?: string;
        deprecation?: RawDeprecation;
    };
}

interface RawVulnerability {
    url: string;
    severity: number;
    versions: string;
}

interface DeprecationEntry {
    version: string;
    info: DeprecationInfo;
}

export class NuGetClient {

    private readonly serviceIndexCache = new TtlCache<ServiceIndexResource[]>(getCacheTtlMs);
    private readonly versionsCache = new TtlCache<string[]>(getCacheTtlMs);
    private readonly registrationPagesCache = new TtlCache<RegistrationPage[]>(getCacheTtlMs);
    private readonly deprecationEntriesCache = new TtlCache<DeprecationEntry[]>(getCacheTtlMs);
    private readonly vulnerabilityBulkCache = new TtlCache<Map<string, RawVulnerability[]>>(getCacheTtlMs);
    private readonly loggedMissingRegistration = new Set<string>();
    private readonly loggedMissingVulnerabilityResource = new Set<string>();
    private readonly loggedMissingPackageBaseAddress = new Set<string>();
    private readonly loggedServiceIndexFailure = new Set<string>();

    constructor(
        private readonly credentialService: CredentialService,
        private readonly outputChannel: vscode.OutputChannel
    ) {}

    public async getVersions(source: NuGetSource, packageId: string): Promise<string[]> {
        const cacheKey = `${source.url}|${packageId.toLowerCase()}`;
        return this.versionsCache.get(cacheKey, () => this.fetchVersions(source, packageId));
    }

    private async fetchVersions(source: NuGetSource, packageId: string): Promise<string[]> {
        try {
            const baseAddress = await this.getPackageBaseAddress(source);
            if (!baseAddress) {
                return [];
            }
            const url = `${baseAddress}${packageId.toLowerCase()}/index.json`;
            const headers = await this.buildAuthHeaders(source);
            const response = await axios.get(url, { headers });
            return response.data?.versions ?? [];
        } catch (err) {
            this.handleFetchError(source, packageId, err);
            return [];
        }
    }

    // Deprecation and vulnerability status is computed for every candidate version at once (not
    // just the currently-referenced one) so the upgrade QuickPick can flag them too.
    public async getVersionFlags(source: NuGetSource, packageId: string, versions: string[]): Promise<Map<string, VersionFlags>> {
        const [deprecationEntries, vulnerabilityMap] = await Promise.all([
            this.getDeprecationEntries(source, packageId),
            this.getVulnerabilities(source, packageId, versions)
        ]);

        const flags = new Map<string, VersionFlags>();
        for (const version of versions) {
            const target = parseVersion(version);
            if (!target) {
                continue;
            }

            const deprecationEntry = deprecationEntries.find(entry => {
                const entryVersion = parseVersion(entry.version);
                return !!entryVersion && compareVersions(entryVersion, target) === 0;
            });

            const vulnerabilities = vulnerabilityMap.get(version) ?? [];

            if (deprecationEntry || vulnerabilities.length > 0) {
                flags.set(version, {
                    deprecationMessage: formatDeprecationMessage(deprecationEntry?.info),
                    vulnerabilities
                });
            }
        }

        return flags;
    }

    public async getVulnerabilities(source: NuGetSource, packageId: string, versions: string[]): Promise<Map<string, VulnerabilityInfo[]>> {
        const raw = await this.getRawVulnerabilities(source, packageId);
        const map = new Map<string, VulnerabilityInfo[]>();

        for (const version of versions) {
            const matches = raw
                .filter(v => isVersionInRange(version, v.versions))
                .map(v => ({ url: v.url, severity: v.severity }));
            if (matches.length > 0) {
                map.set(version, matches);
            }
        }

        return map;
    }

    private async getDeprecationEntries(source: NuGetSource, packageId: string): Promise<DeprecationEntry[]> {
        const cacheKey = `${source.url}|${packageId.toLowerCase()}`;
        return this.deprecationEntriesCache.get(cacheKey, () => this.fetchDeprecationEntries(source, packageId));
    }

    private async fetchDeprecationEntries(source: NuGetSource, packageId: string): Promise<DeprecationEntry[]> {
        const entries: DeprecationEntry[] = [];
        try {
            const pages = await this.getRegistrationPages(source, packageId);
            const headers = await this.buildAuthHeaders(source);

            for (const page of pages) {
                const items = page.items ?? (await axios.get(page['@id'], { headers })).data?.items ?? [];
                for (const leaf of items as RegistrationLeaf[]) {
                    const info = this.toDeprecationInfo(leaf.catalogEntry?.deprecation);
                    if (info && leaf.catalogEntry?.version) {
                        entries.push({ version: leaf.catalogEntry.version, info });
                    }
                }
            }
        } catch (err) {
            this.outputChannel.appendLine(
                `[NuGet Version Lens] Failed to check deprecation for "${packageId}" against feed "${source.name}": ${(err as Error).message ?? err}`
            );
        }
        return entries;
    }

    private toDeprecationInfo(raw: RawDeprecation | undefined): DeprecationInfo | undefined {
        if (!raw) {
            return undefined;
        }
        return {
            message: raw.message,
            reasons: raw.reasons,
            alternatePackageId: raw.alternatePackage?.id,
            alternatePackageRange: raw.alternatePackage?.range
        };
    }

    private async getRegistrationPages(source: NuGetSource, packageId: string): Promise<RegistrationPage[]> {
        const cacheKey = `${source.url}|${packageId.toLowerCase()}`;
        return this.registrationPagesCache.get(cacheKey, () => this.fetchRegistrationPages(source, packageId));
    }

    private async fetchRegistrationPages(source: NuGetSource, packageId: string): Promise<RegistrationPage[]> {
        const registrationBase = await this.getRegistrationBaseAddress(source);
        if (!registrationBase) {
            return [];
        }
        const headers = await this.buildAuthHeaders(source);
        const url = `${registrationBase}${packageId.toLowerCase()}/index.json`;
        const response = await axios.get(url, { headers });
        return response.data?.items ?? [];
    }

    private async getRegistrationBaseAddress(source: NuGetSource): Promise<string | undefined> {
        const resources = await this.getServiceIndexResources(source);
        const resource = resources.find(r => r['@type']?.startsWith('RegistrationsBaseUrl'));
        if (!resource && !this.loggedMissingRegistration.has(source.url)) {
            this.loggedMissingRegistration.add(source.url);
            this.outputChannel.appendLine(
                `[NuGet Version Lens] Feed "${source.name}" does not expose a RegistrationsBaseUrl resource — deprecation checks are unavailable from this source.`
            );
        }
        return resource?.['@id'];
    }

    private async getPackageBaseAddress(source: NuGetSource): Promise<string | undefined> {
        const resources = await this.getServiceIndexResources(source);
        if (resources.length === 0 && !this.loggedServiceIndexFailure.has(source.url)) {
            this.loggedServiceIndexFailure.add(source.url);
            this.outputChannel.appendLine(
                `[NuGet Version Lens] Feed "${source.name}" (${source.url}) returned no usable service index — check the URL is a valid NuGet v3 service index and reachable.`
            );
        }
        const resource = resources.find(r => r['@type']?.startsWith('PackageBaseAddress/3.0.0'));
        if (!resource && resources.length > 0 && !this.loggedMissingPackageBaseAddress.has(source.url)) {
            this.loggedMissingPackageBaseAddress.add(source.url);
            this.outputChannel.appendLine(
                `[NuGet Version Lens] Feed "${source.name}" does not expose a PackageBaseAddress/3.0.0 resource — version lookups are unavailable from this source.`
            );
        }
        return resource?.['@id'];
    }

    private async getRawVulnerabilities(source: NuGetSource, packageId: string): Promise<RawVulnerability[]> {
        const bulk = await this.getVulnerabilityBulkData(source);
        return bulk.get(packageId.toLowerCase()) ?? [];
    }

    private async getVulnerabilityBulkData(source: NuGetSource): Promise<Map<string, RawVulnerability[]>> {
        return this.vulnerabilityBulkCache.get(source.url, () => this.fetchVulnerabilityBulkData(source));
    }

    // The vulnerability feed isn't per-package: NuGet publishes one (or two, base + incremental
    // update) bulk JSON file(s) mapping every known-vulnerable package id to its affected ranges.
    private async fetchVulnerabilityBulkData(source: NuGetSource): Promise<Map<string, RawVulnerability[]>> {
        const map = new Map<string, RawVulnerability[]>();
        try {
            const resources = await this.getServiceIndexResources(source);
            const resource = resources.find(r => r['@type']?.startsWith('VulnerabilityInfo'));
            if (!resource) {
                if (!this.loggedMissingVulnerabilityResource.has(source.url)) {
                    this.loggedMissingVulnerabilityResource.add(source.url);
                    this.outputChannel.appendLine(
                        `[NuGet Version Lens] Feed "${source.name}" does not expose a VulnerabilityInfo resource — vulnerability checks are unavailable from this source ` +
                        `(this is a nuget.org-specific extension; most other feeds, including Azure Artifacts, don't implement it).`
                    );
                }
                return map;
            }

            const headers = await this.buildAuthHeaders(source);
            const indexResponse = await axios.get(resource['@id'], { headers });
            const files: { '@id': string }[] = indexResponse.data ?? [];

            for (const file of files) {
                const dataResponse = await axios.get(file['@id'], { headers });
                const payload = (dataResponse.data ?? {}) as Record<string, RawVulnerability[]>;
                for (const [id, vulnerabilities] of Object.entries(payload)) {
                    map.set(id, (map.get(id) ?? []).concat(vulnerabilities));
                }
            }
        } catch (err) {
            this.outputChannel.appendLine(
                `[NuGet Version Lens] Failed to load vulnerability data from feed "${source.name}": ${(err as Error).message ?? err}`
            );
        }
        return map;
    }

    private async getServiceIndexResources(source: NuGetSource): Promise<ServiceIndexResource[]> {
        return this.serviceIndexCache.get(source.url, () => this.fetchServiceIndex(source));
    }

    private async fetchServiceIndex(source: NuGetSource): Promise<ServiceIndexResource[]> {
        const headers = await this.buildAuthHeaders(source);
        const response = await axios.get(source.url, { headers });
        return response.data?.resources ?? [];
    }

    private async buildAuthHeaders(source: NuGetSource): Promise<Record<string, string>> {
        if (!source.isAzureArtifacts) {
            return {};
        }
        const pat = await this.credentialService.getPatForSource(source.url);
        if (!pat) {
            return {};
        }
        return { Authorization: 'Basic ' + Buffer.from(`:${pat}`).toString('base64') };
    }

    private handleFetchError(source: NuGetSource, packageId: string, err: unknown): void {
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;

        if (status === 401 || status === 403) {
            if (source.isAzureArtifacts) {
                this.outputChannel.appendLine(
                    `[NuGet Version Lens] Authentication failed for Azure Artifacts feed "${source.name}" while checking ${packageId}. ` +
                    `The stored PAT may be invalid or expired; use "NuGet Version Lens: Set Feed Credentials" to update it.`
                );
            } else {
                this.outputChannel.appendLine(
                    `[NuGet Version Lens] Feed "${source.name}" requires authentication that isn't supported for non-Azure feeds yet. ` +
                    `Configure credentials for it via 'dotnet nuget add source' or a <packageSourceCredentials> entry in nuget.config.`
                );
            }
            return;
        }

        this.outputChannel.appendLine(
            `[NuGet Version Lens] Failed to check "${packageId}" against feed "${source.name}": ${(err as Error).message ?? err}`
        );
    }
}
