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

const RESTORE_SOURCE_PROPERTIES = ['RestoreAdditionalProjectSources', 'RestoreSources'];

export function extractMsBuildRestoreSources(xmlContent: string): string[] {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const parsed = parser.parse(xmlContent);
    const groups = parsed?.Project?.PropertyGroup;
    if (!groups) {
        return [];
    }

    const urls: string[] = [];
    for (const group of Array.isArray(groups) ? groups : [groups]) {
        for (const prop of RESTORE_SOURCE_PROPERTIES) {
            const values = group?.[prop];
            if (values === undefined) {
                continue;
            }
            for (const value of Array.isArray(values) ? values : [values]) {
                const text = typeof value === 'object' && value !== null ? value['#text'] : value;
                if (typeof text !== 'string') {
                    continue;
                }
                for (const part of text.split(';')) {
                    const url = part.trim();
                    // Skip MSBuild property references like $(RestoreSources); only literal feeds are usable.
                    if (/^https?:\/\//i.test(url) && !url.includes('$(')) {
                        urls.push(url);
                    }
                }
            }
        }
    }
    return urls;
}

function dedupeByUrl(sources: NuGetSource[]): NuGetSource[] {
    const seen = new Set<string>();
    return sources.filter(s => {
        const key = s.url.replace(/\/+$/, '').toLowerCase();
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

export class NuGetConfigParser {

    public resolveSources(fromFilePath: string): NuGetSource[] {
        const startDir = path.dirname(fromFilePath);
        const configPath = this.findUp(startDir, 'nuget.config');
        const configSources = configPath ? this.parseSources(configPath) : [];
        const baseSources = configSources.length > 0 ? configSources : [DEFAULT_SOURCE];

        return dedupeByUrl([...baseSources, ...this.resolveMsBuildSources(startDir)]);
    }

    // Feeds can also be added from MSBuild via RestoreAdditionalProjectSources / RestoreSources in
    // Directory.Packages.props or Directory.Build.props (often inside a Condition, e.g. a develop
    // channel). Conditions aren't evaluated: every literal feed URL found is consulted, since the
    // extension wants to see every version a line could be upgraded to.
    private resolveMsBuildSources(startDir: string): NuGetSource[] {
        const sources: NuGetSource[] = [];
        for (const fileName of ['directory.packages.props', 'directory.build.props']) {
            const filePath = this.findUp(startDir, fileName);
            if (!filePath) {
                continue;
            }
            try {
                const urls = extractMsBuildRestoreSources(fs.readFileSync(filePath, 'utf8'));
                for (const url of urls) {
                    sources.push({
                        name: `${path.basename(filePath)} (${url})`,
                        url,
                        isAzureArtifacts: isAzureArtifactsUrl(url)
                    });
                }
            } catch {
                // unreadable/malformed props file: fall back to nuget.config sources only
            }
        }
        return sources;
    }

    private findUp(startDir: string, lowerCaseFileName: string): string | undefined {
        let dir = startDir;
        while (true) {
            const entries = this.tryReadDir(dir);
            const match = entries.find(e => e.toLowerCase() === lowerCaseFileName);
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
