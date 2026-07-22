import * as vscode from 'vscode';

const SECTION = 'nugetUpgrade';

export function getCacheTtlMs(): number {
    const seconds = vscode.workspace.getConfiguration(SECTION).get<number>('cacheTTL', 3600);
    return Math.max(0, seconds) * 1000;
}

export function getIncludePrerelease(): boolean {
    return vscode.workspace.getConfiguration(SECTION).get<boolean>('includePrerelease', false);
}

export function getFeedUrlOverride(): string | undefined {
    const value = vscode.workspace.getConfiguration(SECTION).get<string>('feedUrl', '').trim();
    return value.length > 0 ? value : undefined;
}
