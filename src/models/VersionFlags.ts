import { VulnerabilityInfo } from './VulnerabilityInfo';

export interface VersionFlags {
    deprecationMessage?: string;
    vulnerabilities: VulnerabilityInfo[];
}
