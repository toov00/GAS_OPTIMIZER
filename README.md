# Solidity Gas Optimizer

A static analysis tool that parses Solidity smart contracts and identifies gas optimization opportunities. The analyzer examines your contract's Abstract Syntax Tree (AST) to detect common patterns that waste gas and provides actionable recommendations with estimated savings.

## Quick Start

```bash
# Install dependencies (if any)
npm install

# Analyze a contract
node analyzer.js path/to/Contract.sol

# Filter by severity
node analyzer.js Contract.sol --min-severity=medium

# Generate JSON output
node analyzer.js Contract.sol --format=json --output=report.json

# Verbose mode for debugging
node analyzer.js Contract.sol --verbose
```

## How It Works

The analyzer uses a four-stage pipeline:

1. **Lexical Analysis**: Tokenizes Solidity source code into a stream of tokens, handling comments, strings, numbers, and operators.

2. **Parsing**: Builds an Abstract Syntax Tree (AST) from the token stream, preserving the structure of contracts, functions, statements, and expressions.

3. **Pattern Matching**: Traverses the AST applying optimization rules. The analyzer tracks context (current contract, function, variable scope) to make accurate recommendations.

4. **Report Generation**: Formats findings into human-readable text or structured JSON, including severity levels, gas savings estimates, and code examples.

## Gas Cost Reference

Understanding gas costs helps prioritize optimizations. Here are the key operations:

| Operation | Gas Cost | Notes |
|-----------|----------|-------|
| SLOAD (storage read) | 2100 (cold) / 100 (warm) | First read is cold, subsequent reads are warm |
| SSTORE (storage write) | 20000 (new) / 5000 (update) | Writing to a zero slot costs more |
| MLOAD/MSTORE (memory) | 3 | Memory operations are cheap |
| ADD/SUB | 3 | Basic arithmetic |
| MUL/DIV | 5 | Multiplication and division |
| CALL | 2600+ | External calls have base cost plus per-byte costs |

Storage operations dominate gas costs. A single unnecessary SLOAD in a loop can cost thousands of gas.

## Optimization Patterns

### Storage Optimizations

These typically offer the highest impact because storage operations are expensive.

#### Cache Storage Variables in Loops

Reading from storage in a loop condition executes on every iteration. Cache the value before the loop.

```solidity
// Inefficient: SLOAD on every iteration
function processItems() external {
    for (uint i = 0; i < items.length; i++) {
        total += items[i];
    }
}

// Optimized: Single SLOAD, then use memory
function processItems() external {
    uint256[] memory arr = items;
    uint256 len = arr.length;
    for (uint i = 0; i < len; i++) {
        total += arr[i];
    }
}
```

Savings: Approximately 2000 gas per avoided SLOAD in the loop condition.

#### Storage Variable Packing

EVM storage slots are 32 bytes. Variables smaller than 32 bytes can share a slot if they fit together.

```solidity
// Inefficient: Uses 3 storage slots
contract Bad {
    uint128 a;    // Slot 0 (16 bytes, 16 bytes unused)
    uint256 b;    // Slot 1 (32 bytes, full)
    uint128 c;    // Slot 2 (16 bytes, 16 bytes unused)
}

// Optimized: Uses 2 storage slots
contract Good {
    uint128 a;    // Slot 0 (16 bytes)
    uint128 c;    // Slot 0 (16 bytes, packed with a)
    uint256 b;    // Slot 1 (32 bytes)
}
```

Savings: Approximately 20,000 gas per eliminated slot on deployment, plus runtime savings.

#### Use immutable and constant

Values that never change should use `immutable` (set in constructor) or `constant` (compile-time constant). These are embedded in bytecode, eliminating SLOAD operations.

```solidity
// Inefficient: Storage read every access
address public owner;

// Optimized: No storage read needed
address public immutable owner;
uint256 public constant MAX_SUPPLY = 10000;
```

Savings: Approximately 2100 gas per read avoided.

### Function Parameter Optimizations

#### Prefer calldata over memory

For external functions with array or struct parameters that aren't modified, use `calldata` instead of `memory`. This avoids copying data to memory.

```solidity
// Inefficient: Copies array to memory
function process(uint256[] memory data) external {
    // data is copied to memory
}

// Optimized: Reads directly from calldata
function process(uint256[] calldata data) external {
    // data is read from calldata, no copy
}
```

Savings: Approximately 60 gas per word plus memory expansion costs.

#### Use external instead of public

For functions that aren't called internally, `external` is more gas efficient than `public` because it can read directly from calldata.

```solidity
// Inefficient: public copies calldata to memory
function process(uint256[] memory data) public { }

// Optimized: external reads calldata directly
function process(uint256[] calldata data) external { }
```

### Loop Optimizations

#### Cache array length

Reading `array.length` from storage in a loop condition is expensive. Cache it first.

```solidity
// Inefficient
for (uint i = 0; i < array.length; i++) { }

// Optimized
uint256 len = array.length;
for (uint i = 0; i < len; i++) { }
```

#### Use unchecked for safe increments

When loop bounds are known and overflow is impossible, use `unchecked` blocks to skip overflow checks.

```solidity
// Inefficient: Overflow check on every iteration
for (uint i = 0; i < len; i++) { }

// Optimized: Skip overflow check when safe
for (uint i = 0; i < len; ) {
    // loop body
    unchecked { ++i; }
}
```

Savings: Approximately 60-80 gas per iteration.

#### Prefer prefix increment

Use `++i` instead of `i++` to avoid creating a temporary variable.

```solidity
// Inefficient: Creates temporary
i++;

// Optimized: Modifies in place
++i;
```

Savings: Approximately 5 gas per operation.

### Error Handling Optimizations

#### Custom errors over revert strings

Custom errors (introduced in Solidity 0.8.4) are more gas efficient than revert strings. They use only 4 bytes for the error selector instead of storing the entire string in bytecode.

```solidity
// Inefficient: String stored in bytecode
require(balance >= amount, "Insufficient balance");

// Optimized: Only 4-byte selector
error InsufficientBalance(uint256 available, uint256 required);
if (balance < amount) revert InsufficientBalance(balance, amount);
```

Savings: Approximately 50 gas on deployment plus runtime savings per revert.

### Arithmetic Optimizations

#### Bit shifts for powers of two

Multiplication and division by powers of two can use bit shifts, which are cheaper.

```solidity
// Inefficient: MUL/DIV operations
uint256 x = y * 2;
uint256 z = y / 4;

// Optimized: Bit shifts
uint256 x = y << 1;  // Multiply by 2
uint256 z = y >> 2;  // Divide by 4
```

Savings: Approximately 5 gas per operation.

#### Short-circuit evaluation

Order conditions to place cheaper checks first. If the first condition fails in an AND chain, the second won't be evaluated.

```solidity
// Inefficient: Expensive check first
if (expensiveStorageRead() && cheapLocalCheck) { }

// Optimized: Cheap check first
if (cheapLocalCheck && expensiveStorageRead()) { }
```

### Comparison Optimizations

#### Use != 0 instead of > 0 for unsigned integers

For unsigned integers, checking `!= 0` is slightly cheaper than `> 0` because it uses the ISZERO opcode.

```solidity
// Inefficient: GT comparison
require(amount > 0);

// Optimized: ISZERO is cheaper
require(amount != 0);
```

Savings: Approximately 6 gas.

## Command Line Options

```
node analyzer.js <contract.sol> [options]

Options:
  --format=<text|json>     Output format (default: text)
  --min-severity=<level>   Minimum severity: low, medium, high (default: low)
  --output=<file>          Write report to file instead of stdout
  --verbose                Show detailed analysis steps
  --help, -h               Show help message
```

## Understanding Severity Levels

Findings are categorized by severity based on estimated gas savings:

| Level | Description | Typical Savings |
|-------|-------------|-----------------|
| HIGH | Critical optimizations with significant impact | >1000 gas |
| MEDIUM | Substantial improvements | 100-1000 gas |
| LOW | Minor optimizations | <100 gas |
| INFO | Best practices and suggestions | Varies |

The analyzer estimates savings based on gas cost tables and operation frequency. Actual savings depend on execution frequency and contract state.

## Report Format

Text reports include:

- Summary statistics by severity level
- Estimated total gas savings (deployment and per-transaction)
- Detailed findings with:
  - Rule identifier (e.g., H-01, M-02)
  - Location (line number and function)
  - Description of the issue
  - Estimated gas savings
  - Before/after code examples

JSON reports provide structured data suitable for CI/CD integration or further processing.

## Examples

The `examples/` directory contains sample contracts demonstrating common inefficiencies:

```bash
# Analyze the example contract
node analyzer.js examples/Inefficient.sol

# Compare with optimized version
node analyzer.js examples/Optimized.sol
```

## Limitations

This analyzer focuses on common gas optimization patterns. It does not:

- Perform data flow analysis to track variable modifications
- Analyze cross-function dependencies
- Consider contract interaction patterns
- Optimize assembly code
- Suggest architectural changes

For complex optimizations, manual review and gas profiling tools are recommended.

## Requirements

- Node.js >= 14.0.0
- No external dependencies (pure JavaScript implementation)

## License

MIT
