#!/usr/bin/env node

/**
 * Solidity Gas Optimization Analyzer
 * 
 * A static analysis tool that parses Solidity contracts
 * and suggests gas-saving improvements.
 */

const fs = require('fs');
const path = require('path');
const Lexer = require('./src/lexer');
const Parser = require('./src/parser');
const Analyzer = require('./src/analyzer');
const Reporter = require('./src/reporter');

// CLI colors
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m'
};

function printBanner() {
    console.log(`
${colors.cyan}╔═══════════════════════════════════════════════════════════╗
║                                                               ║
║   ${colors.bright} Solidity Gas Optimization Analyzer${colors.reset}${colors.cyan}                    ║
║                                                               ║
║   Parses contracts and suggests gas-saving improvements       ║
║                                                               ║
╚═══════════════════════════════════════════════════════════╝${colors.reset}
`);
}

function printUsage() {
    console.log(`
${colors.bright}Usage:${colors.reset}
    node analyzer.js <contract.sol> [options]

${colors.bright}Options:${colors.reset}
    --format=<text|json>     Output format (default: text)
    --min-severity=<level>   Minimum severity: low, medium, high (default: low)
    --output=<file>          Write report to file
    --verbose                Show detailed analysis steps
    --help                   Show this help message

${colors.bright}Examples:${colors.reset}
    node analyzer.js MyContract.sol
    node analyzer.js MyContract.sol --format=json --output=report.json
    node analyzer.js MyContract.sol --min-severity=medium
`);
}

function parseArgs(args) {
    const options = {
        file: null,
        format: 'text',
        minSeverity: 'low',
        output: null,
        verbose: false,
        help: false
    };

    for (const arg of args) {
        if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--verbose' || arg === '-v') {
            options.verbose = true;
        } else if (arg.startsWith('--format=')) {
            options.format = arg.split('=')[1];
        } else if (arg.startsWith('--min-severity=')) {
            options.minSeverity = arg.split('=')[1];
        } else if (arg.startsWith('--output=')) {
            options.output = arg.split('=')[1];
        } else if (!arg.startsWith('-')) {
            options.file = arg;
        }
    }

    return options;
}

async function main() {
    printBanner();

    const args = process.argv.slice(2);
    const options = parseArgs(args);

    if (options.help || !options.file) {
        printUsage();
        process.exit(options.help ? 0 : 1);
    }

    // Check if file exists
    if (!fs.existsSync(options.file)) {
        console.error(`${colors.red}Error: File not found: ${options.file}${colors.reset}`);
        process.exit(1);
    }

    try {
        console.log(`${colors.gray}Analyzing: ${options.file}${colors.reset}\n`);

        // Read source code
        const source = fs.readFileSync(options.file, 'utf-8');

        // Step 1: Lexical Analysis
        if (options.verbose) {
            console.log(`${colors.blue}[1/4] Tokenizing source code...${colors.reset}`);
        }
        const lexer = new Lexer(source);
        const tokens = lexer.tokenize();

        // Step 2: Parsing
        if (options.verbose) {
            console.log(`${colors.blue}[2/4] Building AST...${colors.reset}`);
        }
        const parser = new Parser(tokens, source);
        const ast = parser.parse();

        // Step 3: Analysis
        if (options.verbose) {
            console.log(`${colors.blue}[3/4] Running optimization analysis...${colors.reset}`);
        }
        const analyzer = new Analyzer(ast, source);
        const findings = analyzer.analyze();

        // Step 4: Report Generation
        if (options.verbose) {
            console.log(`${colors.blue}[4/4] Generating report...${colors.reset}\n`);
        }
        const reporter = new Reporter(findings, {
            filename: path.basename(options.file),
            minSeverity: options.minSeverity,
            format: options.format
        });

        const report = reporter.generate();

        // Output report
        if (options.output) {
            fs.writeFileSync(options.output, report);
            console.log(`${colors.green}Report written to: ${options.output}${colors.reset}`);
        } else {
            console.log(report);
        }

        // Exit with error code if high severity issues found
        const highSeverityCount = findings.filter(f => f.severity === 'high').length;
        process.exit(highSeverityCount > 0 ? 1 : 0);

    } catch (error) {
        console.error(`${colors.red}Analysis Error: ${error.message}${colors.reset}`);
        if (options.verbose) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

main();
