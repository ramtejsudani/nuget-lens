import { XMLParser } from 'fast-xml-parser';
import { PackageReference } from '../models/PackageReference';
import { assignLineNumbersByTag } from '../utils/xmlLineNumbers';

export class PackagesConfigParser {

    public parsePackagesConfig(xmlContent: string): PackageReference[] {
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: ''
        });
        const parsed = parser.parse(xmlContent);

        const packages: PackageReference[] = [];
        const entries = parsed?.packages?.package;

        if (!entries) {
            return packages;
        }

        const list = Array.isArray(entries) ? entries : [entries];

        for (const pkg of list) {
            const packageId = pkg.id || '';
            const version = pkg.version || '';
            if (!packageId || !version) {
                continue;
            }
            packages.push({
                packageId,
                version: String(version),
                filePath: ''
            });
        }

        assignLineNumbersByTag(xmlContent, /<package\b[^>]*>/g, packages);

        return packages;
    }
}
