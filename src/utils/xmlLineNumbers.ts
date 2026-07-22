import { PackageReference } from '../models/PackageReference';

// XML parsers discard element positions, so line numbers are recovered by re-scanning the raw
// text for the element's opening tag in document order and zipping matches with the parsed
// entries (which are also produced in document order by fast-xml-parser).
export function assignLineNumbersByTag(xmlContent: string, tagRegex: RegExp, packages: PackageReference[]): void {
    const lines = xmlContent.split('\n');
    const lineStartOffsets: number[] = [];
    let offset = 0;
    for (const line of lines) {
        lineStartOffsets.push(offset);
        offset += line.length + 1;
    }

    let match: RegExpExecArray | null;
    let index = 0;
    while ((match = tagRegex.exec(xmlContent)) !== null && index < packages.length) {
        const matchIndex = match.index;
        let lineNumber = 0;
        for (let i = 0; i < lineStartOffsets.length; i++) {
            if (lineStartOffsets[i] <= matchIndex) {
                lineNumber = i;
            } else {
                break;
            }
        }
        packages[index].lineNumber = lineNumber;
        index++;
    }
}
