import { XMLParser } from 'fast-xml-parser';
import { PackageReference } from '../models/PackageReference';
import { assignLineNumbersByTag } from '../utils/xmlLineNumbers';

export class CsprojParser {

    public parseCsproj(xmlContent: string): PackageReference[] {
        // A "Version" attribute and a child <Version> element would collide under the empty
        // attribute prefix used by the other parsers, so csproj uses the "@_" prefix instead.
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_'
        });
        const parsed = parser.parse(xmlContent);

        const packages: PackageReference[] = [];
        const itemGroups = parsed?.Project?.ItemGroup;

        if (!itemGroups) {
            return packages;
        }

        const groups = Array.isArray(itemGroups) ? itemGroups : [itemGroups];

        for (const group of groups) {
            const refs = group.PackageReference;
            if (!refs) {
                continue;
            }

            const entries = Array.isArray(refs) ? refs : [refs];

            for (const pkg of entries) {
                const packageId = pkg['@_Include'] || pkg['@_Update'] || '';
                const version = pkg['@_Version'] ?? this.extractChildVersion(pkg.Version);

                // Central Package Management leaves Version off the csproj reference entirely;
                // there is nothing to check here since the version lives in Directory.Packages.props.
                if (!packageId || !version) {
                    continue;
                }

                packages.push({
                    packageId,
                    version: String(version),
                    filePath: ''
                });
            }
        }

        assignLineNumbersByTag(xmlContent, /<PackageReference\b[^>]*>/g, packages);

        return packages;
    }

    private extractChildVersion(value: unknown): string | undefined {
        if (typeof value === 'string' || typeof value === 'number') {
            return String(value);
        }
        if (value && typeof value === 'object' && '#text' in value) {
            return String((value as { '#text': unknown })['#text']);
        }
        return undefined;
    }
}
