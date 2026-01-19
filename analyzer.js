#!/usr/bin/env node

/**
 * Solidity Gas Optimization Analyzer
 * 
 * A static analysis tool that parses Solidity contracts
 * and suggests gas-saving improvements.
 * 
 * @module analyzer
 */

const fs = require('fs');
const path = require('path');
const Lexer = require('./src/lexer');
const Parser = require('./src/parser');
const Analyzer = require('./src/analyzer');
const Reporter = require('./src/reporter');

// Constants
const SUPPORTED_FORMATS = ['text', 'json'];
const SUPPORTED_SEVERITIES = ['low', 'medium', 'high'];
const DEFAULT_FORMAT = 'text';
const DEFAULT_SEVERITY = 'low';
const EXIT_CODE_SUCCESS = 0;
const EXIT_CODE_ERROR = 1;

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

/**
 * Parse command-line arguments
 * @param {string[]} args - Command-line arguments
 * @returns {Object} Parsed options
 */
function parseArgs(args) {
    const options = {
        file: null,
        format: DEFAULT_FORMAT,
        minSeverity: DEFAULT_SEVERITY,
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
            const format = arg.split('=')[1];
            if (SUPPORTED_FORMATS.includes(format)) {
                options.format = format;
            } else {
                throw new Error(`Unsupported format: ${format}. Supported formats: ${SUPPORTED_FORMATS.join(', ')}`);
            }
        } else if (arg.startsWith('--min-severity=')) {
            const severity = arg.split('=')[1];
            if (SUPPORTED_SEVERITIES.includes(severity)) {
                options.minSeverity = severity;
            } else {
                throw new Error(`Unsupported severity: ${severity}. Supported severities: ${SUPPORTED_SEVERITIES.join(', ')}`);
            }
        } else if (arg.startsWith('--output=')) {
            options.output = arg.split('=')[1];
        } else if (!arg.startsWith('-')) {
            options.file = arg;
        }
    }

    return options;
}

/**
 * Validate file path
 * @param {string} filePath - Path to validate
 * @throws {Error} If file doesn't exist or is not readable
 */
function validateFile(filePath) {
    if (!filePath) {
        throw new Error('No file specified');
    }

    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
        throw new Error(`Path is not a file: ${filePath}`);
    }

    // Check file extension
    if (!filePath.endsWith('.sol')) {
        console.warn(`${colors.yellow}Warning: File does not have .sol extension${colors.reset}`);
    }
}

/**
 * Read and validate source file
 * @param {string} filePath - Path to source file
 * @returns {string} File contents
 * @throws {Error} If file cannot be read
 */
function readSourceFile(filePath) {
    try {
        const source = fs.readFileSync(filePath, 'utf-8');
        if (!source || source.trim().length === 0) {
            throw new Error('File is empty');
        }
        return source;
    } catch (error) {
        if (error.code === 'EACCES') {
            throw new Error(`Permission denied: ${filePath}`);
        }
        if (error.code === 'ENOENT') {
            throw new Error(`File not found: ${filePath}`);
        }
        throw new Error(`Failed to read file: ${error.message}`);
    }
}

/**
 * Write report to file
 * @param {string} filePath - Output file path
 * @param {string} content - Report content
 * @throws {Error} If file cannot be written
 */
function writeReport(filePath, content) {
    try {
        const dir = path.dirname(filePath);
        if (dir && !fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, content, 'utf-8');
    } catch (error) {
        throw new Error(`Failed to write report: ${error.message}`);
    }
}

/**
 * Main entry point
 */
async function main() {
    printBanner();

    const args = process.argv.slice(2);
    let options;

    try {
        options = parseArgs(args);
    } catch (error) {
        console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
        printUsage();
        process.exit(EXIT_CODE_ERROR);
    }

    if (options.help || !options.file) {
        printUsage();
        process.exit(options.help ? EXIT_CODE_SUCCESS : EXIT_CODE_ERROR);
    }

    try {
        validateFile(options.file);
    } catch (error) {
        console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
        process.exit(EXIT_CODE_ERROR);
    }

    try {
        console.log(`${colors.gray}Analyzing: ${options.file}${colors.reset}\n`);

        // Read source code
        const source = readSourceFile(options.file);

        // Step 1: Lexical Analysis
        if (options.verbose) {
            console.log(`${colors.blue}[1/4] Tokenizing source code...${colors.reset}`);
        }
        const lexer = new Lexer(source);
        const tokens = lexer.tokenize();

        if (tokens.length === 0) {
            throw new Error('No tokens generated from source file');
        }

        // Step 2: Parsing
        if (options.verbose) {
            console.log(`${colors.blue}[2/4] Building AST...${colors.reset}`);
        }
        const parser = new Parser(tokens, source);
        const ast = parser.parse();

        if (!ast || !ast.children) {
            throw new Error('Failed to parse source file');
        }

        // Step 3: Analysis
        if (options.verbose) {
            console.log(`${colors.blue}[3/4] Running optimization analysis...${colors.reset}`);
        }
        const analyzer = new Analyzer(ast, source);
        const findings = analyzer.analyze();

        if (!Array.isArray(findings)) {
            throw new Error('Analysis returned invalid results');
        }

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
            writeReport(options.output, report);
            console.log(`${colors.green}Report written to: ${options.output}${colors.reset}`);
        } else {
            console.log(report);
        }

        // Exit with error code if high severity issues found
        const highSeverityCount = findings.filter(f => f.severity === 'high').length;
        process.exit(highSeverityCount > 0 ? EXIT_CODE_ERROR : EXIT_CODE_SUCCESS);

    } catch (error) {
        console.error(`${colors.red}Analysis Error: ${error.message}${colors.reset}`);
        if (options.verbose) {
            console.error(error.stack);
        }
        process.exit(EXIT_CODE_ERROR);
    }
}

main();
