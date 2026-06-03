import { UpgradeRecommendation } from './UpgradeRecommendation';

export interface PackageVersionInfo {
    packageId: string;
    latestVersion: string;
    versions: string[];
    isDeprecated: boolean;
    deprecationMessage?: string;
    upgradeRecommendation?: UpgradeRecommendation;
}