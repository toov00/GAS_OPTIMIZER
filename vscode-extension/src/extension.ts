import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// Constants
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const PROCESS_TIMEOUT = 60000; // 60 seconds
const DEBOUNCE_DELAY = 500; // 500ms
const MAX_OUTPUT_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_DIAGNOSTIC_RANGE = 50; // Maximum characters to highlight
const DEFAULT_NODE_PATH = 'node';
const EXTENSION_NAME = 'gas-optimizer';
const ANALYZER_SCRIPT_NAME = 'analyzer_server.js';

interface Finding {
    id: string;
    type: string;
    severity: string;
    title: string;
    description: string;
    location: {
        line: number;
        column: number;
    };
    function: string;
    contract: string;
    gasSavings: string;
    before: string;
    after: string;
}

interface AnalysisResult {
    file: string;
    summary: {
        high: number;
        medium: number;
        low: number;
        total: number;
    };
    findings: Finding[];
    parse_errors: string[];
}

class GasOptimizerDiagnosticProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private outputChannel: vscode.OutputChannel;
    private activeProcesses: Map<string, ChildProcess> = new Map();
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection(EXTENSION_NAME);
        this.outputChannel = vscode.window.createOutputChannel('Gas Optimizer');
    }

    private getConfig(): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration('gas-optimizer');
    }

    private validatePath(filePath: string): boolean {
        if (!filePath || typeof filePath !== 'string') {
            return false;
        }
        const normalized = path.normalize(filePath);
        return !normalized.includes('..') && (path.isAbsolute(normalized) || !normalized.startsWith('..'));
    }

    private sanitizeNodePath(nodePath: string): string {
        if (!nodePath || typeof nodePath !== 'string') {
            return DEFAULT_NODE_PATH;
        }
        
        const sanitized = nodePath.trim().replace(/[;&|`$(){}[\]<>]/g, '');
        if (!sanitized || sanitized.length === 0) {
            return DEFAULT_NODE_PATH;
        }
        
        if (!/^[a-zA-Z0-9./_\- ]+$/.test(sanitized)) {
            return DEFAULT_NODE_PATH;
        }
        
        return sanitized;
    }

    private getSeverity(findingSeverity: string): vscode.DiagnosticSeverity {
        switch (findingSeverity.toLowerCase()) {
            case 'high':
                return vscode.DiagnosticSeverity.Warning;
            case 'medium':
                return vscode.DiagnosticSeverity.Information;
            case 'low':
                return vscode.DiagnosticSeverity.Hint;
            default:
                return vscode.DiagnosticSeverity.Information;
        }
    }

    private async runAnalyzer(filePath: string, sourceCode: string): Promise<AnalysisResult | null> {
        return new Promise((resolve, reject) => {
            const config = this.getConfig();
            const nodePathRaw = config.get<string>('nodePath', 'node');
            const nodePath = this.sanitizeNodePath(nodePathRaw);
            const analyzerPath = config.get<string>('analyzerPath', '');
            const minSeverity = config.get<string>('minSeverity', 'low');

            // Validate file size
            if (sourceCode.length > MAX_FILE_SIZE) {
                const fileSizeMB = Math.round(sourceCode.length / 1024 / 1024);
                const maxSizeMB = MAX_FILE_SIZE / 1024 / 1024;
                reject(new Error(`File too large (${fileSizeMB}MB). Maximum size is ${maxSizeMB}MB.`));
                return;
            }

            // Cancel any existing process for this file
            const existingProcess = this.activeProcesses.get(filePath);
            if (existingProcess) {
                try {
                    existingProcess.kill();
                } catch (e) {
                    // Ignore errors when killing
                }
                this.activeProcesses.delete(filePath);
            }

            // Determine the analyzer script path
            let scriptPath: string;
            if (analyzerPath && analyzerPath.trim().length > 0) {
                if (!this.validatePath(analyzerPath)) {
                    reject(new Error('Invalid analyzer path provided'));
                    return;
                }
                if (!fs.existsSync(analyzerPath)) {
                    reject(new Error(`Analyzer script not found at: ${analyzerPath}`));
                    return;
                }
                scriptPath = analyzerPath;
            } else {
                const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (workspaceRoot) {
                    const workspacePath = path.join(workspaceRoot, 'vscode-extension', ANALYZER_SCRIPT_NAME);
                    if (fs.existsSync(workspacePath)) {
                        scriptPath = workspacePath;
                    } else {
                        reject(new Error(`Analyzer script not found. Tried: ${workspacePath}`));
                        return;
                    }
                } else {
                    const allExtensions = vscode.extensions.all;
                    const extension = allExtensions.find(ext => 
                        ext.packageJSON.name === EXTENSION_NAME
                    );
                    const extensionPath = extension?.extensionPath;
                    if (extensionPath) {
                        scriptPath = path.join(extensionPath, ANALYZER_SCRIPT_NAME);
                        if (!fs.existsSync(scriptPath)) {
                            reject(new Error(`Analyzer script not found at ${scriptPath}`));
                            return;
                        }
                    } else {
                        reject(new Error('Could not find analyzer script. No workspace or extension path available.'));
                        return;
                    }
                }
            }

            this.outputChannel.appendLine(`Running analyzer: ${nodePath} ${scriptPath}`);
            this.outputChannel.appendLine(`File: ${filePath}`);

            const process = spawn(nodePath, [scriptPath, '--severity', minSeverity], {
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: false
            });

            const timeout = setTimeout(() => {
                if (process && !process.killed) {
                    process.kill();
                    this.activeProcesses.delete(filePath);
                    reject(new Error(`Analyzer process timed out after ${PROCESS_TIMEOUT / 1000} seconds`));
                }
            }, PROCESS_TIMEOUT);

            this.activeProcesses.set(filePath, process);

            let stdout = '';
            let stderr = '';

            process.stdout.on('data', (data: Buffer) => {
                stdout += data.toString();
                if (stdout.length > MAX_OUTPUT_SIZE) {
                    process.kill();
                    this.activeProcesses.delete(filePath);
                    clearTimeout(timeout);
                    reject(new Error('Analyzer output too large'));
                }
            });

            process.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
                if (stderr.length > MAX_OUTPUT_SIZE) {
                    process.kill();
                    this.activeProcesses.delete(filePath);
                    clearTimeout(timeout);
                    reject(new Error('Analyzer error output too large'));
                }
            });

            process.on('error', (error) => {
                clearTimeout(timeout);
                this.activeProcesses.delete(filePath);
                this.outputChannel.appendLine(`Error: ${error.message}`);
                reject(new Error(`Failed to start analyzer: ${error.message}`));
            });

            process.on('close', (code) => {
                clearTimeout(timeout);
                this.activeProcesses.delete(filePath);

                if (code !== 0) {
                    this.outputChannel.appendLine(`Process exited with code ${code}`);
                    if (stderr) {
                        this.outputChannel.appendLine(`Stderr: ${stderr.substring(0, 1000)}`);
                    }
                    reject(new Error(`Analyzer process exited with code ${code}${stderr ? ': ' + stderr.substring(0, 200) : ''}`));
                    return;
                }

                if (!stdout || stdout.trim().length === 0) {
                    reject(new Error('Analyzer produced no output'));
                    return;
                }

                try {
                    const result = JSON.parse(stdout);
                    if (!result || typeof result !== 'object') {
                        reject(new Error('Invalid analyzer output format'));
                        return;
                    }
                    resolve(result);
                } catch (error: any) {
                    this.outputChannel.appendLine(`Failed to parse JSON: ${stdout.substring(0, 500)}`);
                    reject(new Error(`Failed to parse analyzer output: ${error.message || error}`));
                }
            });

            try {
                const input = JSON.stringify({ source: sourceCode, filename: path.basename(filePath) });
                process.stdin.write(input + '\n');
                process.stdin.end();
            } catch (error: any) {
                clearTimeout(timeout);
                process.kill();
                this.activeProcesses.delete(filePath);
                reject(new Error(`Failed to send input to analyzer: ${error.message || error}`));
            }
        });
    }

    async analyzeDocument(document: vscode.TextDocument, skipDebounce: boolean = false): Promise<void> {
        const config = this.getConfig();
        if (document.languageId !== 'solidity' || !config.get<boolean>('enable', true)) {
            return;
        }

        if (!skipDebounce) {
            const uri = document.uri.toString();
            const existingTimer = this.debounceTimers.get(uri);
            if (existingTimer) {
                clearTimeout(existingTimer);
            }

            const timer = setTimeout(() => {
                this.debounceTimers.delete(uri);
                this.analyzeDocument(document, true);
            }, DEBOUNCE_DELAY);

            this.debounceTimers.set(uri, timer);
            return;
        }

        const filePath = document.uri.fsPath;
        const sourceCode = document.getText();

        this.outputChannel.appendLine(`Analyzing: ${filePath}`);

        try {
            const result = await this.runAnalyzer(filePath, sourceCode);

            if (!result) {
                this.outputChannel.appendLine('Analyzer returned no result');
                this.diagnosticCollection.set(document.uri, []);
                return;
            }

            this.outputChannel.appendLine(`Analyzer returned result with ${result.findings?.length || 0} findings`);

            if (result.parse_errors && result.parse_errors.length > 0) {
                this.outputChannel.appendLine('Parse errors:');
                result.parse_errors.forEach(error => {
                    this.outputChannel.appendLine(`  - ${error}`);
                });
            }

            const diagnostics: vscode.Diagnostic[] = [];
            const maxLine = document.lineCount - 1;

            const findings = result.findings || [];
            this.outputChannel.appendLine(`Processing ${findings.length} findings...`);

            for (const finding of findings) {
                let line = finding.location.line - 1;
                
                if (line < 0) {
                    line = 0;
                } else if (line > maxLine) {
                    line = maxLine;
                }
                
                const column = Math.max(0, finding.location.column - 1);
                
                let lineText = '';
                try {
                    lineText = document.lineAt(line).text;
                } catch (e) {
                    this.outputChannel.appendLine(`Warning: Could not get line ${line + 1}, using line 0`);
                    line = 0;
                    lineText = document.lineAt(0).text;
                }
                
                const endColumn = Math.min(
                    Math.max(column + MAX_DIAGNOSTIC_RANGE, column + 1),
                    lineText.length
                );

                const range = new vscode.Range(
                    line,
                    column,
                    line,
                    endColumn
                );

                const severity = this.getSeverity(finding.severity);
                let message = finding.title;
                if (finding.description) {
                    message += `\n\n${finding.description}`;
                }
                if (finding.gasSavings) {
                    message += `\n\nEstimated savings: ${finding.gasSavings}`;
                }
                if (finding.after) {
                    message += `\n\nSuggested fix:\n${finding.after}`;
                }

                const diagnostic = new vscode.Diagnostic(range, message, severity);
                diagnostic.source = 'gas-optimizer';
                diagnostic.code = finding.type;

                diagnostics.push(diagnostic);
                this.outputChannel.appendLine(`Added diagnostic: ${finding.severity} - ${finding.title} at line ${line + 1}`);
            }

            this.diagnosticCollection.set(document.uri, diagnostics);

            const totalFindings = findings.length;
            const summary = result.summary || { high: 0, medium: 0, low: 0, total: totalFindings };
            
            if (totalFindings > 0) {
                this.outputChannel.appendLine(
                    `Found ${totalFindings} optimization opportunities: ` +
                    `${summary.high} High, ` +
                    `${summary.medium} Medium, ` +
                    `${summary.low} Low`
                );
                if (diagnostics.length > 0) {
                    vscode.window.showInformationMessage(
                        `Found ${totalFindings} gas optimization opportunity${totalFindings > 1 ? 'ies' : ''}. Check Problems panel for details.`
                    );
                }
            } else {
                this.outputChannel.appendLine('No optimization opportunities found.');
            }

        } catch (error: any) {
            this.outputChannel.appendLine(`Error: ${error.message}`);
            vscode.window.showErrorMessage(`Gas Optimizer: ${error.message}`);
        }
    }

    async analyzeWorkspace(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showWarningMessage('No workspace folder open');
            return;
        }

        this.outputChannel.clear();
        this.outputChannel.appendLine('Scanning workspace...');

        const solFiles = await vscode.workspace.findFiles(
            '**/*.sol',
            '**/{node_modules,test,mock,Mock}/**',
            100
        );

        if (solFiles.length === 0) {
            vscode.window.showInformationMessage('No Solidity files found in workspace');
            return;
        }

        const progressOptions: vscode.ProgressOptions = {
            location: vscode.ProgressLocation.Notification,
            title: 'Scanning workspace for gas optimizations',
            cancellable: false
        };

        let totalFindings = 0;
        let processedFiles = 0;

        await vscode.window.withProgress(progressOptions, async (progress) => {
            for (const file of solFiles) {
                try {
                    progress.report({
                        increment: 100 / solFiles.length,
                        message: `Analyzing ${path.basename(file.fsPath)} (${processedFiles + 1}/${solFiles.length})`
                    });

                    const document = await vscode.workspace.openTextDocument(file);
                    await this.analyzeDocument(document, true);
                    const diagnostics = this.diagnosticCollection.get(file);
                    if (diagnostics) {
                        totalFindings += diagnostics.length;
                    }
                    processedFiles++;
                } catch (error: any) {
                    this.outputChannel.appendLine(`Error analyzing ${file.fsPath}: ${error.message}`);
                    processedFiles++;
                }
            }
        });

        vscode.window.showInformationMessage(
            `Workspace scan complete. Found ${totalFindings} optimization opportunities across ${solFiles.length} files.`
        );
    }

    clearDiagnostics(): void {
        this.diagnosticCollection.clear();
    }

    clearDiagnosticsForFile(uri: vscode.Uri): void {
        this.diagnosticCollection.delete(uri);
    }

    dispose(): void {
        for (const [filePath, process] of this.activeProcesses.entries()) {
            try {
                if (!process.killed) {
                    process.kill();
                }
            } catch (e) {
                // Ignore errors
            }
        }
        this.activeProcesses.clear();

        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();

        this.diagnosticCollection.dispose();
        this.outputChannel.dispose();
    }
}

let diagnosticProvider: GasOptimizerDiagnosticProvider;

export function activate(context: vscode.ExtensionContext) {
    diagnosticProvider = new GasOptimizerDiagnosticProvider();

    const scanCommand = vscode.commands.registerCommand('gas-optimizer.scan', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'solidity') {
            await diagnosticProvider.analyzeDocument(editor.document);
            vscode.window.showInformationMessage('Gas optimization scan complete. Check Problems panel for results.');
        } else {
            vscode.window.showWarningMessage('Please open a Solidity file to scan');
        }
    });

    const scanWorkspaceCommand = vscode.commands.registerCommand('gas-optimizer.scanWorkspace', async () => {
        await diagnosticProvider.analyzeWorkspace();
    });

    const onSaveDisposable = vscode.workspace.onDidSaveTextDocument(async (document) => {
        const config = vscode.workspace.getConfiguration('gas-optimizer');
        if (config.get<boolean>('runOnSave', true) && document.languageId === 'solidity') {
            await diagnosticProvider.analyzeDocument(document, false);
        }
    });

    const onOpenDisposable = vscode.workspace.onDidOpenTextDocument(async (document) => {
        const config = vscode.workspace.getConfiguration('gas-optimizer');
        if (config.get<boolean>('enable', true) && document.languageId === 'solidity') {
            await diagnosticProvider.analyzeDocument(document, false);
        }
    });

    const onDeleteDisposable = vscode.workspace.onDidDeleteFiles(async (event) => {
        for (const file of event.files) {
            diagnosticProvider.clearDiagnosticsForFile(file);
        }
    });

    context.subscriptions.push(
        scanCommand,
        scanWorkspaceCommand,
        onSaveDisposable,
        onOpenDisposable,
        onDeleteDisposable,
        diagnosticProvider
    );
}

export function deactivate() {
    if (diagnosticProvider) {
        diagnosticProvider.dispose();
    }
}
