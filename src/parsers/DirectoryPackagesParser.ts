import { XMLParser } from "fast-xml-parser";
import { PackageReference } from "../models/PackageReference";
import { assignLineNumbersByTag } from "../utils/xmlLineNumbers";


export class DirectoryPackagesParser {

    public parseDirectoryPackages(xmlContent: string): PackageReference[] {
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: ""
        });
    const parsed = parser.parse(xmlContent);

    const packages: PackageReference[] = [];

    const itemGroups = parsed?.Project?.ItemGroup;

    if (!itemGroups) {
        return packages;
    }

    const groups = Array.isArray(itemGroups)
        ? itemGroups
        : [itemGroups];

    for (const group of groups) {

        const packageVersions =
            group.PackageVersion ||
			group.packageVersion ||
			group.PackageReference;

        if (!packageVersions) {
            continue;
        }

            const entries = Array.isArray(packageVersions)
            ? packageVersions
            : [packageVersions];

            for (const pkg of entries) {
                packages.push({
                    packageId: pkg.Include || pkg.Package || '',
                    version: pkg.Version || pkg.version || '',
                    filePath: ''
                });
            }
    }

    assignLineNumbersByTag(xmlContent, /<PackageVersion\b[^>]*>/g, packages);

    return packages;

}
}
