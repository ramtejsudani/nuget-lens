import { UpgradeRecommendation } from './UpgradeRecommendation';
import { VulnerabilityInfo } from './VulnerabilityInfo';
import { VersionFlags } from './VersionFlags';

export interface PackageVersionInfo {
    packageId: string;
    latestVersion: string;
    versions: string[];
    isDeprecated: boolean;
    deprecationMessage?: string;
    isVulnerable: boolean;
    vulnerabilities: VulnerabilityInfo[];
    versionFlags: Map<string, VersionFlags>;
    upgradeRecommendation?: UpgradeRecommendation;
}
