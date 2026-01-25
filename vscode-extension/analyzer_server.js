#!/usr/bin/env node
/**
 * Server script for VS Code extension to analyze Solidity code.
 * Reads JSON from stdin and outputs analysis results as JSON.
 */

const fs = require('fs');
const path = require('path');

// Add parent directory to path to import analyzer modules
const scriptDir = __dirname;
const parentDir = path.resolve(scriptDir, '..');

// Import analyzer modules
const Lexer = require(path.join(parentDir, 'src', 'lexer'));
const Parser = require(path.join(parentDir, 'src', 'parser'));
const Analyzer = require(path.join(parentDir, 'src', 'analyzer'));
const Reporter = require(path.join(parentDir, 'src', 'reporter'));

const MAX_INPUT_SIZE = 50 * 1024 * 1024; // 50MB

function severityFromString(s) {
    if (typeof s !== 'string') {
        return 'low';
    }
    const lower = s.toLowerCase();
    if (['high', 'medium', 'low'].includes(lower)) {
        return lower;
    }
    return 'low';
}

function main() {
    // Parse command line arguments
    let minSeverity = 'low';
    if (process.argv.length > 3 && process.argv[2] === '--severity') {
        minSeverity = severityFromString(process.argv[3]);
    }

    // Read input from stdin
    let stdinContent = '';
    process.stdin.setEncoding('utf8');
    
    process.stdin.on('data', (chunk) => {
        stdinContent += chunk;
        if (stdinContent.length > MAX_INPUT_SIZE) {
            const error = {
                error: 'Input too large',
                parse_errors: [`Input exceeds maximum size of ${MAX_INPUT_SIZE / 1024 / 1024}MB`]
            };
            console.error(JSON.stringify(error));
            process.exit(1);
        }
    });

    process.stdin.on('end', () => {
        try {
            const inputData = JSON.parse(stdinContent);
            const sourceCode = inputData.source || '';
            const filename = inputData.filename || 'contract.sol';

            // Sanitize filename
            const sanitizedFilename = filename.replace(/[\/\\\.\.]/g, '_').replace(/^_+/, '') || 'contract.sol';

            if (!sourceCode || sourceCode.trim().length === 0) {
                const emptyResult = {
                    file: sanitizedFilename,
                    summary: {
                        high: 0,
                        medium: 0,
                        low: 0,
                        total: 0
                    },
                    findings: [],
                    parse_errors: ['No source code provided']
                };
                console.log(JSON.stringify(emptyResult));
                return;
            }

            // Run analysis
            try {
                const lexer = new Lexer(sourceCode);
                const tokens = lexer.tokenize();

                if (tokens.length === 0) {
                    throw new Error('No tokens generated from source file');
                }

                const parser = new Parser(tokens, sourceCode);
                const ast = parser.parse();

                if (!ast || !ast.children) {
                    throw new Error('Failed to parse source file');
                }

                const analyzer = new Analyzer(ast, sourceCode);
                const findings = analyzer.analyze();

                if (!Array.isArray(findings)) {
                    throw new Error('Analysis returned invalid results');
                }

                // Filter by severity
                const severityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
                const minLevel = severityOrder[minSeverity] || 0;
                const filteredFindings = findings.filter(f => 
                    (severityOrder[f.severity] || 0) >= minLevel
                );

                // Convert findings to extension format
                const convertedFindings = filteredFindings.map((f, index) => ({
                    id: `${f.rule}-${f.line || 0}-${index}`,
                    type: f.rule || 'UNKNOWN',
                    severity: f.severity || 'low',
                    title: f.message || 'Gas optimization opportunity',
                    description: f.description || '',
                    location: {
                        line: f.line || 1,
                        column: f.column || 1
                    },
                    function: f.function || '',
                    contract: f.contract || '',
                    gasSavings: f.gasSavings || '',
                    before: f.before || '',
                    after: f.after || ''
                }));

                // Calculate summary
                const summary = {
                    high: 0,
                    medium: 0,
                    low: 0,
                    total: convertedFindings.length
                };

                convertedFindings.forEach(f => {
                    if (summary.hasOwnProperty(f.severity)) {
                        summary[f.severity]++;
                    }
                });

                const result = {
                    file: sanitizedFilename,
                    summary: summary,
                    findings: convertedFindings,
                    parse_errors: []
                };

                console.log(JSON.stringify(result));
            } catch (error) {
                const errorResult = {
                    error: `Analysis error: ${error.message}`,
                    parse_errors: [error.message],
                    file: sanitizedFilename,
                    summary: {
                        high: 0,
                        medium: 0,
                        low: 0,
                        total: 0
                    },
                    findings: []
                };
                console.error(JSON.stringify(errorResult));
                process.exit(1);
            }
        } catch (error) {
            const parseError = {
                error: `Invalid JSON input: ${error.message}`,
                parse_errors: [error.message]
            };
            console.error(JSON.stringify(parseError));
            process.exit(1);
        }
    });
}

main();
