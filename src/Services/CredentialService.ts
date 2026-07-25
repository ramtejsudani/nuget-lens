import * as vscode from 'vscode';

const SECRET_KEY_PREFIX = 'nuget-lens.pat.';

export class CredentialService {

    private readonly declinedSources = new Set<string>();

    constructor(private readonly secrets: vscode.SecretStorage) {}

    public async getPatForSource(sourceUrl: string): Promise<string | undefined> {
        const existing = await this.secrets.get(SECRET_KEY_PREFIX + sourceUrl);
        if (existing) {
            return existing;
        }
        if (this.declinedSources.has(sourceUrl)) {
            return undefined;
        }

        const pat = await this.promptForPat(sourceUrl);
        if (pat) {
            await this.secrets.store(SECRET_KEY_PREFIX + sourceUrl, pat);
        } else {
            this.declinedSources.add(sourceUrl);
        }
        return pat;
    }

    public async forgetPatForSource(sourceUrl: string): Promise<void> {
        await this.secrets.delete(SECRET_KEY_PREFIX + sourceUrl);
        this.declinedSources.delete(sourceUrl);
    }

    private async promptForPat(sourceUrl: string): Promise<string | undefined> {
        return vscode.window.showInputBox({
            title: 'NuGet Lens: Azure Artifacts Authentication',
            prompt: `Enter a Personal Access Token (PAT) with Packaging (Read) scope for feed: ${sourceUrl}`,
            password: true,
            ignoreFocusOut: true
        });
    }
}
