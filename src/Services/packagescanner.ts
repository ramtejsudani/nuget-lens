import * as path from 'path';
import * as vscode from 'vscode';
import { DirectoryPackagesParser } from '../parsers/DirectoryPackagesParser';
import { CsprojParser } from '../parsers/CsprojParser';
import { PackagesConfigParser } from '../parsers/PackagesConfigParser';
import { PackageReference } from '../models/PackageReference';

type FileKind = 'directory.packages.props' | 'csproj' | 'packages.config';

export class PackageScanner {

    private readonly directoryPackagesParser = new DirectoryPackagesParser();
    private readonly csprojParser = new CsprojParser();
    private readonly packagesConfigParser = new PackagesConfigParser();

    public static getFileKind(fileName: string): FileKind | undefined {
        const base = path.basename(fileName).toLowerCase();
        if (base === 'directory.packages.props') {
            return 'directory.packages.props';
        }
        if (base.endsWith('.csproj')) {
            return 'csproj';
        }
        if (base === 'packages.config') {
            return 'packages.config';
        }
        return undefined;
    }

    public static isSupportedFile(fileName: string): boolean {
        return PackageScanner.getFileKind(fileName) !== undefined;
    }

    public getPackagesFromDocument(document: vscode.TextDocument): PackageReference[] {
        const kind = PackageScanner.getFileKind(document.fileName);
        if (!kind) {
            return [];
        }

        const packages = this.parseByKind(kind, document.getText());
        return packages.map(pkg => ({ ...pkg, filePath: document.uri.fsPath }));
    }

    public async getPackages(): Promise<PackageReference[]> {
        const activeDocument = vscode.window.activeTextEditor?.document;
        if (!activeDocument) {
            return [];
        }
        return this.getPackagesFromDocument(activeDocument);
    }

    private parseByKind(kind: FileKind, text: string): PackageReference[] {
        switch (kind) {
            case 'directory.packages.props':
                return this.directoryPackagesParser.parseDirectoryPackages(text);
            case 'csproj':
                return this.csprojParser.parseCsproj(text);
            case 'packages.config':
                return this.packagesConfigParser.parsePackagesConfig(text);
        }
    }
}
