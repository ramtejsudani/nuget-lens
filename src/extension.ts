// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { PackageScanner } from './Services/packagescanner';
import { CredentialService } from './Services/CredentialService';
import { NuGetClient } from './Services/NuGetClient';
import { UpgradeService, outputPackageSummary } from './Services/UpgradeService';
import { NuGetConfigParser } from './parsers/NuGetConfigParser';
import { PackageCodeLensProvider, UPGRADE_COMMAND, SHOW_WARNING_COMMAND, WarningCommandArgs } from './providers/PackageCodeLensProvider';
import { upgradePackageCommand } from './commands/upgradePackage';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('NuGet Lens activated');
	const outputChannel = vscode.window.createOutputChannel('NuGet Lens');
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.text = 'NuGet Lens';
    statusBarItem.color = new vscode.ThemeColor('charts.green');
    statusBarItem.tooltip = 'NuGet Lens';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
	outputChannel.appendLine('[NuGet Lens] Extension activated at ' + new Date().toLocaleTimeString());

	const scanner = new PackageScanner();
	const credentialService = new CredentialService(context.secrets);
	const nugetClient = new NuGetClient(credentialService, outputChannel);
	const upgradeService = new UpgradeService(nugetClient, outputChannel);
	const configParser = new NuGetConfigParser();
	const codeLensProvider = new PackageCodeLensProvider(scanner, upgradeService);

	async function logPackagesAndUpgrades(document: vscode.TextDocument): Promise<void> {
		if (!PackageScanner.isSupportedFile(document.fileName)) {
			return;
		}

		const packages = scanner.getPackagesFromDocument(document);
		if (packages.length === 0) {
			outputChannel.appendLine(`[NuGet Lens] No package references found in ${document.fileName}`);
			return;
		}

		outputChannel.appendLine(`[NuGet Lens] Found ${packages.length} package(s) in ${document.fileName}`);
		const infos = await upgradeService.checkPackages(document.uri.fsPath, packages);
		outputPackageSummary(outputChannel, packages, infos);
	}

	const viewCurrentFileCommand =
        vscode.commands.registerCommand(
            'nuget-lens.viewPackagesInCurrentFile',
            async () => {
               const packages = (await scanner.getPackages()) || [];
                if (packages.length === 0) {
                    vscode.window.showInformationMessage(
                        'No package references were found in the active document.'
                    );
                    return;
                }
				outputChannel.show(true);
				const activeDocument = vscode.window.activeTextEditor!.document;
				await logPackagesAndUpgrades(activeDocument);
            }
        );

	const upgradeCommand = vscode.commands.registerCommand(UPGRADE_COMMAND, async (args) => {
		await upgradePackageCommand(args);
		codeLensProvider.refresh();
	});

	const showWarningCommand = vscode.commands.registerCommand(
		SHOW_WARNING_COMMAND,
		async (args: WarningCommandArgs) => {
			await vscode.window.showWarningMessage(`${args.packageId}: ${args.message}`);
		}
	);

	const setCredentialsCommand = vscode.commands.registerCommand(
		'nuget-lens.setFeedCredentials',
		async () => {
			const activeDocument = vscode.window.activeTextEditor?.document;
			if (!activeDocument || !PackageScanner.isSupportedFile(activeDocument.fileName)) {
				vscode.window.showInformationMessage('Open a Directory.Packages.props, .csproj, or packages.config file first to set feed credentials.');
				return;
			}

			const sources = configParser.resolveSources(activeDocument.uri.fsPath).filter(s => s.isAzureArtifacts);
			if (sources.length === 0) {
				vscode.window.showInformationMessage('No Azure Artifacts feeds were found in nuget.config for this file.');
				return;
			}

			const picked = sources.length === 1
				? sources[0]
				: await vscode.window.showQuickPick(sources.map(s => ({ label: s.name, description: s.url, source: s })))
					.then(choice => choice?.source);

			if (!picked) {
				return;
			}

			await credentialService.forgetPatForSource(picked.url);
			const pat = await credentialService.getPatForSource(picked.url);
			if (pat) {
				vscode.window.showInformationMessage(`NuGet Lens: credentials updated for ${picked.name}.`);
				codeLensProvider.refresh();
			}
		}
	);

	const codeLensRegistration = vscode.languages.registerCodeLensProvider(
		[
			{ language: 'xml' },
			{ pattern: '**/*.csproj' },
			{ pattern: '**/packages.config' }
		],
		codeLensProvider
	);

	const openListener = vscode.workspace.onDidOpenTextDocument(document => {
		void logPackagesAndUpgrades(document);
	});

	const activeEditorListener = vscode.window.onDidChangeActiveTextEditor(editor => {
		if (editor) {
			void logPackagesAndUpgrades(editor.document);
		}
	});

	if (vscode.window.activeTextEditor) {
		void logPackagesAndUpgrades(vscode.window.activeTextEditor.document);
	}

	context.subscriptions.push(
		viewCurrentFileCommand,
		upgradeCommand,
		showWarningCommand,
		setCredentialsCommand,
		codeLensRegistration,
		openListener,
		activeEditorListener,
		outputChannel
	);
}

// This method is called when your extension is deactivated
export function deactivate() {}
