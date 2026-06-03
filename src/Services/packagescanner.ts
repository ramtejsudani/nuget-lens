import * as vscode from 'vscode';
import { DirectoryPackagesParser } from '../parsers/DirectoryPackagesParser';


export class PackageScanner {

     public async getPackages() {
         const parser = new DirectoryPackagesParser();
		 const packages = [];
		const activeDocument = vscode.window.activeTextEditor?.document;
        if (activeDocument) {
            const fileName = activeDocument.fileName.toLowerCase();
            const xml = activeDocument.getText();

            if (fileName.endsWith('directory.packages.props')) {
                packages.push(
                    ...parser
                        .parseDirectoryPackages(xml)
                        .map(pkg => ({ ...pkg, filePath: activeDocument.uri.fsPath }))
                );
                 return packages;
			}
		}
     }
    
}