import * as vscode from 'vscode';
import { PackageScanner } from '../Services/packagescanner';
import { UpgradeService } from '../Services/UpgradeService';
import { VersionFlags } from '../models/VersionFlags';
import { highestSeverity, vulnerabilitySeverityLabel } from '../models/VulnerabilityInfo';

export const UPGRADE_COMMAND = 'nuget-version-lens.upgradePackage';
export const SHOW_WARNING_COMMAND = 'nuget-version-lens.showPackageWarning';

export interface UpgradeCommandArgs {
    uri: string;
    packageId: string;
    lineNumber: number;
    currentVersion: string;
    recommendedVersion: string;
    versions: string[];
    versionFlags: Record<string, VersionFlags>;
}

export interface WarningCommandArgs {
    packageId: string;
    message: string;
}

const MAX_LENS_MESSAGE_LENGTH = 80;

function truncate(text: string): string {
    return text.length > MAX_LENS_MESSAGE_LENGTH ? text.slice(0, MAX_LENS_MESSAGE_LENGTH - 1) + '…' : text;
}

function formatVulnerabilityMessage(flags: VersionFlags): string {
    const severity = vulnerabilitySeverityLabel(highestSeverity(flags.vulnerabilities));
    const links = flags.vulnerabilities.map(v => v.url).join(', ');
    return `${severity} severity — ${links}`;
}

export class PackageCodeLensProvider implements vscode.CodeLensProvider {

    private readonly emitter = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses = this.emitter.event;

    constructor(
        private readonly scanner: PackageScanner,
        private readonly upgradeService: UpgradeService
    ) {}

    public refresh(): void {
        this.emitter.fire();
    }

    public async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        if (!PackageScanner.isSupportedFile(document.fileName)) {
            return [];
        }

        const packages = this.scanner.getPackagesFromDocument(document);
        if (packages.length === 0) {
            return [];
        }

        const infos = await this.upgradeService.checkPackages(document.uri.fsPath, packages);
        const lenses: vscode.CodeLens[] = [];

        for (const pkg of packages) {
            if (pkg.lineNumber === undefined || pkg.lineNumber >= document.lineCount) {
                continue;
            }
            const info = infos.get(pkg.packageId.toLowerCase());
            if (!info) {
                continue;
            }

            const range = document.lineAt(pkg.lineNumber).range;

            if (info.isDeprecated) {
                const message = info.deprecationMessage ?? 'This package is deprecated.';
                const warningArgs: WarningCommandArgs = { packageId: pkg.packageId, message };
                lenses.push(new vscode.CodeLens(range, {
                    title: `⚠ Deprecated: ${truncate(message)}`,
                    command: SHOW_WARNING_COMMAND,
                    arguments: [warningArgs]
                }));
            }

            if (info.isVulnerable) {
                const message = formatVulnerabilityMessage({ deprecationMessage: undefined, vulnerabilities: info.vulnerabilities });
                const warningArgs: WarningCommandArgs = { packageId: pkg.packageId, message };
                lenses.push(new vscode.CodeLens(range, {
                    title: `🛡 Vulnerable: ${truncate(message)}`,
                    command: SHOW_WARNING_COMMAND,
                    arguments: [warningArgs]
                }));
            }

            const latest = info.upgradeRecommendation?.latestMajor;
            if (!info.upgradeRecommendation?.hasUpgrade || !latest) {
                continue;
            }

            const upgradeArgs: UpgradeCommandArgs = {
                uri: document.uri.toString(),
                packageId: pkg.packageId,
                lineNumber: pkg.lineNumber,
                currentVersion: pkg.version,
                recommendedVersion: latest,
                versions: info.versions,
                versionFlags: Object.fromEntries(info.versionFlags)
            };

            lenses.push(new vscode.CodeLens(range, {
                title: `⬆ Upgrade ${pkg.packageId} ${pkg.version} → ${latest}`,
                command: UPGRADE_COMMAND,
                arguments: [upgradeArgs]
            }));
        }

        return lenses;
    }
}
