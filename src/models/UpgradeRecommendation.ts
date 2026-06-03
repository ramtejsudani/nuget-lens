export interface UpgradeRecommendation {
    currentVersion: string;
    latestPatch?: string;
    latestMinor?: string;
    latestMajor?: string;
    hasUpgrade: boolean;
}
