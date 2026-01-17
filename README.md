# SOLIDITIY GAS OPTIMIZER + ANALYZER

A static analysis tool that parses Solidity smart contracts and suggests gas-saving improvements.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Gas Optimization Patterns](#gas-optimization-patterns)
4. [Installation & Usage](#installation--usage)
5. [Understanding the Analysis](#understanding-the-analysis)

---

## Overview

### What is Gas?

Gas is the unit measuring computational effort in Ethereum. Every operation (OPCODE) costs gas:

| Operation | Gas Cost |
|-----------|----------|
| SLOAD (storage read) | 2100 (cold) / 100 (warm) |
| SSTORE (storage write) | 20000 (new) / 5000 (update) |
| MLOAD/MSTORE (memory) | 3 |
| ADD/SUB | 3 |
| MUL/DIV | 5 |
| CALL | 2600+ |

### Why Optimize?

- **Cost Savings**: Users pay less for transactions
- **Block Limits**: Complex operations may exceed block gas limits
- **UX**: Lower gas = faster confirmation times
- **Scalability**: Efficient contracts scale better

---

## Architecture

1. **Lexer/Parser**: Tokenizes and parses Solidity source code
2. **AST Builder**: Constructs Abstract Syntax Tree representation
3. **Pattern Matcher**: Applies optimization rules against AST
4. **Report Generator**: Produces actionable recommendations

---

## Gas Optimization Patterns

### Category 1: Storage Optimizations (Highest Impact)

#### 1.1 Cache Storage Variables in Memory
```solidity
// BAD: Multiple SLOADs (2100 gas each cold read)
function bad() external {
    for (uint i = 0; i < myArray.length; i++) {  // SLOAD each iteration
        total += myArray[i];
    }
}

// GOOD: Single SLOAD, use memory
function good() external {
    uint256[] memory arr = myArray;  // Single SLOAD
    uint256 len = arr.length;
    for (uint i = 0; i < len; i++) {
        total += arr[i];
    }
}
```
**Savings**: ~2000 gas per avoided SLOAD

#### 1.2 Storage Variable Packing
```solidity
// BAD: Uses 3 storage slots (32 bytes each)
contract Bad {
    uint128 a;    // Slot 0
    uint256 b;    // Slot 1 (can't pack, too big)
    uint128 c;    // Slot 2
}

// GOOD: Uses 2 storage slots
contract Good {
    uint128 a;    // Slot 0 (16 bytes)
    uint128 c;    // Slot 0 (16 bytes) - packed!
    uint256 b;    // Slot 1
}
```
**Savings**: ~20,000 gas per eliminated slot write

#### 1.3 Use `immutable` and `constant`
```solidity
// BAD: Storage read every access
address public owner;

// GOOD: Embedded in bytecode (no SLOAD)
address public immutable owner;
uint256 public constant MAX_SUPPLY = 10000;
```
**Savings**: ~2100 gas per read avoided

### Category 2: Function Optimizations

#### 2.1 Use `calldata` Instead of `memory`
```solidity
// BAD: Copies array to memory
function bad(uint256[] memory data) external {
    // ...
}

// GOOD: Reads directly from calldata
function good(uint256[] calldata data) external {
    // ...
}
```
**Savings**: ~60 gas per word + memory expansion costs

#### 2.2 Use `external` Instead of `public`
```solidity
// BAD: public copies calldata to memory
function bad(uint256[] memory data) public { }

// GOOD: external can read calldata directly
function good(uint256[] calldata data) external { }
```

### Category 3: Loop Optimizations

#### 3.1 Cache Array Length
```solidity
// BAD: Reads length each iteration
for (uint i = 0; i < array.length; i++) { }

// GOOD: Cached length
uint256 len = array.length;
for (uint i = 0; i < len; i++) { }
```

#### 3.2 Use `unchecked` for Counter Increment
```solidity
// BAD: Overflow checks (unnecessary post-0.8.0 for bounded loops)
for (uint i = 0; i < len; i++) { }

// GOOD: Skip overflow check when safe
for (uint i = 0; i < len; ) {
    // ...
    unchecked { ++i; }
}
```
**Savings**: ~60-80 gas per iteration

#### 3.3 Use `++i` Instead of `i++`
```solidity
// BAD: Creates temporary variable
i++;

// GOOD: Modifies in place
++i;
```
**Savings**: ~5 gas per operation

### Category 4: Data Type Optimizations

#### 4.1 Use `bytes32` Instead of `string`
```solidity
// BAD: Dynamic string storage
string public name = "MyToken";

// GOOD: Fixed-size bytes32
bytes32 public constant name = "MyToken";
```

#### 4.2 Use Custom Errors Instead of Revert Strings
```solidity
// BAD: Stores string in bytecode
require(balance >= amount, "Insufficient balance");

// GOOD: Custom error (4 bytes selector only)
error InsufficientBalance(uint256 available, uint256 required);
if (balance < amount) revert InsufficientBalance(balance, amount);
```
**Savings**: ~50 gas deployment + runtime savings

### Category 5: Arithmetic Optimizations

#### 5.1 Use Shift Operators for Powers of 2
```solidity
// BAD: MUL/DIV operations
uint256 x = y * 2;
uint256 z = y / 4;

// GOOD: Bit shifts
uint256 x = y << 1;  // * 2
uint256 z = y >> 2;  // / 4
```
**Savings**: ~5 gas per operation

#### 5.2 Short-Circuit Conditions
```solidity
// BAD: Expensive check first
if (expensiveCheck() && cheapCheck) { }

// GOOD: Cheap check first (may skip expensive)
if (cheapCheck && expensiveCheck()) { }
```

### Category 6: Comparison Optimizations

#### 6.1 Use `!= 0` Instead of `> 0` for Unsigned
```solidity
// BAD: GT comparison
require(amount > 0);

// GOOD: ISZERO is cheaper
require(amount != 0);
```
**Savings**: ~6 gas

---

## Installation & Usage

```bash
# Clone and install
cd gas-optimizer
npm install

# Analyze a contract
node analyzer.js path/to/Contract.sol

# Analyze with severity filter
node analyzer.js path/to/Contract.sol --min-severity=medium

# Output as JSON
node analyzer.js path/to/Contract.sol --format=json
```

---

## Understanding the Analysis

### Severity Levels

| Level | Description | Typical Savings |
|-------|-------------|-----------------|
| HIGH | Critical optimizations | >1000 gas |
| MEDIUM | Significant improvements | 100-1000 gas |
| LOW | Minor optimizations | <100 gas |
| ℹINFO | Best practices | Varies |

### Report Format

```
════════════════════════════════════════════════════════════
  GAS OPTIMIZATION REPORT
════════════════════════════════════════════════════════════

Contract: MyContract.sol
Analysis Date: 2024-01-15

FINDINGS SUMMARY
────────────────────────────────────────────────────────────
  High:   2 findings
  Medium: 5 findings
  Low:    8 findings
  Info:   3 findings

ESTIMATED SAVINGS: ~45,000 gas (deployment) + ~2,500 gas (per tx)

DETAILED FINDINGS
────────────────────────────────────────────────────────────

[H-01] Storage Variable Not Cached in Loop
  Location: Line 45, function processItems()
  Current:  Reads `items.length` on each iteration
  Suggested: Cache length before loop
  Savings: ~2,100 gas per iteration

  Before:
    for (uint i = 0; i < items.length; i++) {

  After:
    uint256 len = items.length;
    for (uint i = 0; i < len; i++) {
```
