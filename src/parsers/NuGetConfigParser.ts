import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { NuGetSource } from '../models/NuGetSource';

export const NUGET_ORG_URL = 'https://api.nuget.org/v3/index.json';

const DEFAULT_SOURCE: NuGetSource = {
    name: 'nuget.org',
    url: NUGET_ORG_URL,
    isAzureArtifacts: false
};

const AZURE_ARTIFACTS_HOST = /pkgs\.dev\.azure\.com|\.pkgs\.visualstudio\.com/i;

export function isAzureArtifactsUrl(url: string): boolean {
    return AZURE_ARTIFACTS_HOST.test(url);
}

export class NuGetConfigParser {

    public resolveSources(fromFilePath: string): NuGetSource[] {
        const configPath = this.findNuGetConfig(path.dirname(fromFilePath));
        if (!configPath) {
            return [DEFAULT_SOURCE];
        }

        const sources = this.parseSources(configPath);
        return sources.length > 0 ? sources : [DEFAULT_SOURCE];
    }

    private findNuGetConfig(startDir: string): string | undefined {
        let dir = startDir;
        while (true) {
            const entries = this.tryReadDir(dir);
            const match = entries.find(e => e.toLowerCase() === 'nuget.config');
            if (match) {
                return path.join(dir, match);
            }
            const parent = path.dirname(dir);
            if (parent === dir) {
                return undefined;
            }
            dir = parent;
        }
    }

    private tryReadDir(dir: string): string[] {
        try {
            return fs.readdirSync(dir);
        } catch {
            return [];
        }
    }

    private parseSources(configPath: string): NuGetSource[] {
        try {
            const xml = fs.readFileSync(configPath, 'utf8');
            const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
            const parsed = parser.parse(xml);

            const adds = parsed?.configuration?.packageSources?.add;
            if (!adds) {
                return [];
            }

            const list = Array.isArray(adds) ? adds : [adds];
            return list
                .filter(entry => entry.key && entry.value)
                .map(entry => ({
                    name: entry.key,
                    url: entry.value,
                    isAzureArtifacts: isAzureArtifactsUrl(entry.value)
                }));
        } catch {
            return [];
        }
    }
}
