# Solidity Gas Optimizer: VS Code Extension

A VS Code extension that analyzes Solidity code to find gas optimization opportunities and displays results in the Problems panel.

## What It Does

Automatically scans Solidity files for gas inefficiencies. Shows findings directly in the Problems panel with severity levels, estimated gas savings, and code suggestions.

**Features:**
- Real-time analysis on file open and save
- Visual diagnostics in Problems panel
- Workspace-wide scanning
- Configurable severity thresholds
- Gas savings estimates for each finding

## Installation

**Requirements:** Node.js 14.0.0+

1. Navigate to extension directory:
```bash
cd vscode-extension
```

2. Install dependencies and build:
```bash
npm install
npm run compile
```

3. Package the extension:
```bash
npm install -g @vscode/vsce
npm run package
```

4. Install in VS Code:
```bash
code --install-extension solidity-gas-optimizer-1.0.0.vsix
```

## Usage

### Quick Start

The extension automatically analyzes `.sol` files on open and save. Results appear in the Problems panel.

**Manual commands** (Command Palette: `Ctrl+Shift+P` / `Cmd+Shift+P`):

- `Gas Optimizer: Check for Gas Optimizations` - Analyze current file
- `Gas Optimizer: Check Workspace for Gas Optimizations` - Scan all `.sol` files

### Configuration

Configure in VS Code Settings (search for "gas-optimizer"):

- `gas-optimizer.enable`: Enable/disable extension (default: `true`)
- `gas-optimizer.runOnSave`: Auto-analyze on save (default: `true`)
- `gas-optimizer.minSeverity`: Minimum severity to show (default: `low`)
- `gas-optimizer.nodePath`: Node.js interpreter path (default: `node`)
- `gas-optimizer.analyzerPath`: Custom analyzer script path (optional)

## Detection Patterns

1. **Storage Optimizations** (High): Caching variables, packing storage slots, using immutable/constant
2. **Function Parameter Optimizations** (Medium): Preferring calldata over memory, external over public
3. **Loop Optimizations** (Medium): Caching array lengths, unchecked increments, prefix operators
4. **Error Handling Optimizations** (Medium): Custom errors instead of revert strings
5. **Arithmetic Optimizations** (Low): Bit shifts for powers of two, short-circuit evaluation
6. **Comparison Optimizations** (Low): Using != 0 instead of > 0 for unsigned integers

## Troubleshooting

**Extension not working?** Verify Node.js 14.0+ is installed, check Output panel for errors.

**No results showing?** Lower `minSeverity` setting, verify file has `.sol` extension, check Output panel for error messages.

**Import errors?** Make sure the analyzer modules are accessible from the extension directory and Node.js path is correctly configured.

## Development

```bash
npm install
npm run compile    # Compile TypeScript
npm run watch      # Watch mode for development
```

Press `F5` in VS Code to launch Extension Development Host.

## License

MIT License
