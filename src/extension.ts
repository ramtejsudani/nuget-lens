// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { DirectoryPackagesParser } from './parsers/DirectoryPackagesParser';
import { PackageScanner } from './Services/packagescanner';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('NuGet Lens activated');
	const outputChannel = vscode.window.createOutputChannel('NuGet Version Lens');
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.text = 'NuGet Lens';
    statusBarItem.color = new vscode.ThemeColor('charts.green');
    statusBarItem.tooltip = 'NuGet Version Lens';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
	outputChannel.show(true);
    outputChannel.appendLine('[NuGet Version Lens] Extension activated at ' + new Date().toLocaleTimeString());

	
 	const scanner = new PackageScanner();
 	

	    const viewCurrentFileCommand =
        vscode.commands.registerCommand(
            'nuget-version-lens.viewPackagesInCurrentFile',
            async () => {
               const packages = (await scanner.getPackages()) || [];
                if (packages.length === 0) {
                    vscode.window.showInformationMessage(
                        'No package references were found in the active document.'
                    );
                    return;
                }
				console.log(`Found ${packages.length} packages in the active document`);
				outputChannel.appendLine(`[NuGet Version Lens] Found ${packages.length} packages in the active document`);
				outputChannel.appendLine(`[NuGet Version Lens] Packages: ${packages.map(p => p.packageId + ' ' + p.version).join(', ')}`);
                vscode.window.showQuickPick(
                    packages.map(pkg => ({
                        label: pkg.packageId,
                        description: pkg.version
                    })),
                    { placeHolder: 'Packages in the active file' }
                );
            }
        );

	context.subscriptions.push(viewCurrentFileCommand);

	async function refreshPackages() {
    const packages = await scanner.getPackages();

    outputChannel.appendLine(
        `Found ${packages?.length ?? 0} packages`
    );

    // Update CodeLens / Decorations / TreeView here
}
	// Auto-log when an XML document is opened
    const onOpenDocument = vscode.workspace.onDidOpenTextDocument((document) => {
		        outputChannel.appendLine(`language=${document.languageId}, file=${document.fileName}`);
        if (document.fileName.match(/\.(csproj|props|config)$/i)) {
			refreshPackages();
            outputChannel.appendLine(`[NuGet Version Lens] Opened: ${document.fileName.split(/[\\/]/).pop()}`);
        }
    });
    context.subscriptions.push(onOpenDocument);
}

// This method is called when your extension is deactivated
export function deactivate() {}
