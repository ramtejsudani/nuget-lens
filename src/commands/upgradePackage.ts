import * as vscode from 'vscode';
import { UpgradeCommandArgs } from '../providers/PackageCodeLensProvider';
import { compareVersions, parseVersion } from '../utils/semver';
import { highestSeverity, vulnerabilitySeverityLabel } from '../models/VulnerabilityInfo';

const VERSION_ATTR_REGEX = /Version\s*=\s*"([^"]*)"/;

async function pickVersion(args: UpgradeCommandArgs): Promise<string | undefined> {
    const sorted = [...new Set(args.versions)]
        .map(v => ({ raw: v, parsed: parseVersion(v) }))
        .filter((v): v is { raw: string; parsed: NonNullable<ReturnType<typeof parseVersion>> } => v.parsed !== null)
        .sort((a, b) => compareVersions(b.parsed, a.parsed))
        .map(v => v.raw);

    const items: vscode.QuickPickItem[] = sorted.map(v => {
        const isCurrent = v === args.currentVersion;
        const isRecommended = v === args.recommendedVersion;
        const flags = args.versionFlags[v];

        const descriptionParts = [
            isCurrent ? 'current' : undefined,
            isRecommended ? 'recommended' : undefined
        ].filter(Boolean);

        const detailParts: string[] = [];
        if (flags?.deprecationMessage) {
            detailParts.push(`⚠ Deprecated: ${flags.deprecationMessage}`);
        }
        if (flags?.vulnerabilities.length) {
            const severity = vulnerabilitySeverityLabel(highestSeverity(flags.vulnerabilities));
            detailParts.push(`🛡 Vulnerable (${severity}): ${flags.vulnerabilities.map(x => x.url).join(', ')}`);
        }

        const hasWarning = detailParts.length > 0;
        return {
            label: hasWarning ? `$(warning) ${v}` : v,
            description: descriptionParts.length > 0 ? descriptionParts.join(', ') : undefined,
            detail: hasWarning ? detailParts.join('  ') : undefined
        };
    });

    const picked = await vscode.window.showQuickPick(items, {
        title: `Select a version for ${args.packageId}`,
        placeHolder: `Current: ${args.currentVersion}`
    });

    return picked ? picked.label.replace(/^\$\(warning\)\s*/, '') : undefined;
}

export async function upgradePackageCommand(args: UpgradeCommandArgs): Promise<void> {
    const newVersion = await pickVersion(args);
    if (!newVersion || newVersion === args.currentVersion) {
        return;
    }

    const uri = vscode.Uri.parse(args.uri);
    const document = await vscode.workspace.openTextDocument(uri);

    if (args.lineNumber >= document.lineCount) {
        vscode.window.showWarningMessage(`NuGet Lens: line ${args.lineNumber + 1} no longer exists in ${document.fileName}.`);
        return;
    }

    const line = document.lineAt(args.lineNumber);
    const match = VERSION_ATTR_REGEX.exec(line.text);
    if (!match) {
        vscode.window.showWarningMessage(`NuGet Lens: could not locate the Version attribute for ${args.packageId} on line ${args.lineNumber + 1}.`);
        return;
    }

    const startCol = match.index + match[0].indexOf(match[1]);
    const range = new vscode.Range(line.lineNumber, startCol, line.lineNumber, startCol + match[1].length);

    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, range, newVersion);

    const applied = await vscode.workspace.applyEdit(edit);
    if (applied) {
        vscode.window.showInformationMessage(`NuGet Lens: upgraded ${args.packageId} to ${newVersion}.`);
    }
}
