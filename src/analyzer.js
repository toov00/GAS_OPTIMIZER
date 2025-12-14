/**
 * Gas Optimization Analyzer
 * 
 * Analyzes the AST for gas optimization opportunities.
 * Contains pattern matchers for common gas-wasting patterns.
 */

class Analyzer {
    constructor(ast, source) {
        this.ast = ast;
        this.source = source;
        this.sourceLines = source.split('\n');
        this.findings = [];
        
        // Track context during traversal
        this.currentContract = null;
        this.currentFunction = null;
        this.stateVariables = new Map();
        this.localVariables = new Map();
    }

    /**
     * Main analysis entry point
     */
    analyze() {
        // First pass: collect state variables
        this.collectStateVariables(this.ast);

        // Second pass: run all analyzers
        this.analyzeNode(this.ast);

        // Post-analysis checks
        this.checkStoragePacking();

        return this.findings;
    }

    /**
     * Collect all state variables for reference
     */
    collectStateVariables(node) {
        if (!node) return;

        if (node.type === 'ContractDefinition') {
            this.currentContract = node.name;
            this.stateVariables.set(node.name, []);
        }

        if (node.type === 'StateVariableDeclaration' && this.currentContract) {
            const vars = this.stateVariables.get(this.currentContract) || [];
            vars.push({
                name: node.name,
                typeName: node.typeName,
                isConstant: node.isConstant,
                isImmutable: node.isImmutable,
                line: node.line
            });
            this.stateVariables.set(this.currentContract, vars);
        }

        // Recurse
        if (node.children) node.children.forEach(c => this.collectStateVariables(c));
        if (node.members) node.members.forEach(m => this.collectStateVariables(m));
    }

    /**
     * Recursive AST traversal
     */
    analyzeNode(node) {
        if (!node) return;

        // Track context
        if (node.type === 'ContractDefinition') {
            this.currentContract = node.name;
        }
        if (node.type === 'FunctionDefinition') {
            this.currentFunction = node;
            this.localVariables.clear();
            
            // Run function-level analyzers
            this.checkCalldataVsMemory(node);
            this.checkFunctionVisibility(node);
        }

        // Run pattern-specific analyzers
        switch (node.type) {
            case 'ForStatement':
                this.checkLoopOptimizations(node);
                break;
            case 'WhileStatement':
            case 'DoWhileStatement':
                this.checkLoopCondition(node);
                break;
            case 'RequireStatement':
                this.checkRequireString(node);
                break;
            case 'StateVariableDeclaration':
                this.checkStateVariableOptimizations(node);
                break;
            case 'VariableDeclarationStatement':
                this.checkVariableDeclaration(node);
                break;
            case 'BinaryExpression':
                this.checkBinaryExpression(node);
                break;
            case 'UnaryExpression':
                this.checkIncrementStyle(node);
                break;
            case 'MemberExpression':
                this.checkStorageAccess(node);
                break;
            case 'AssignmentExpression':
                this.checkAssignment(node);
                break;
            case 'IfStatement':
                this.checkConditionOrder(node);
                break;
        }

        // Recurse into children
        this.traverseChildren(node);
    }

    /**
     * Traverse all child nodes
     */
    traverseChildren(node) {
        const childKeys = [
            'children', 'members', 'body', 'statements', 'parameters',
            'returns', 'init', 'condition', 'update', 'thenBranch',
            'elseBranch', 'left', 'right', 'operand', 'expression',
            'callee', 'arguments', 'object', 'index', 'elements',
            'initialValue', 'value', 'error', 'fields', 'catchClauses'
        ];

        for (const key of childKeys) {
            const child = node[key];
            if (Array.isArray(child)) {
                child.forEach(c => this.analyzeNode(c));
            } else if (child && typeof child === 'object') {
                this.analyzeNode(child);
            }
        }
    }

    // ========================================
    // GAS OPTIMIZATION RULES
    // ========================================

    /**
     * CHECK: Use calldata instead of memory for read-only function parameters
     */
    checkCalldataVsMemory(funcNode) {
        if (!funcNode.parameters) return;
        if (funcNode.visibility !== 'external') return;

        for (const param of funcNode.parameters) {
            if (param.dataLocation === 'memory') {
                // Check if parameter is modified in function body
                const isModified = this.isParameterModified(param.name, funcNode.body);
                
                if (!isModified) {
                    this.addFinding({
                        rule: 'USE_CALLDATA',
                        severity: 'medium',
                        line: param.line,
                        column: param.column,
                        message: `Parameter '${param.name}' can use 'calldata' instead of 'memory'`,
                        description: 'For external functions, using calldata for read-only array/struct parameters saves gas by avoiding memory copy.',
                        gasSavings: '~60 gas per word + memory expansion costs',
                        before: this.getSourceLine(param.line),
                        after: this.getSourceLine(param.line).replace('memory', 'calldata')
                    });
                }
            }
        }
    }

    /**
     * CHECK: Consider external visibility for public functions not called internally
     */
    checkFunctionVisibility(funcNode) {
        if (funcNode.visibility === 'public' && funcNode.parameters.length > 0) {
            // Check for array/struct parameters
            const hasComplexParams = funcNode.parameters.some(p => 
                p.typeName && (
                    p.typeName.name?.includes('[]') || 
                    p.typeName.name?.includes('string') ||
                    p.typeName.name?.includes('bytes')
                )
            );

            if (hasComplexParams) {
                this.addFinding({
                    rule: 'EXTERNAL_VISIBILITY',
                    severity: 'low',
                    line: funcNode.line,
                    column: funcNode.column,
                    message: `Function '${funcNode.name}' could be external if not called internally`,
                    description: 'External functions with complex parameters are more gas efficient than public functions.',
                    gasSavings: 'Varies based on parameter size'
                });
            }
        }
    }

    /**
     * CHECK: Loop optimizations (caching length, unchecked increment, etc.)
     */
    checkLoopOptimizations(forNode) {
        // Check for storage array length in condition
        if (forNode.condition && forNode.condition.type === 'BinaryExpression') {
            const right = forNode.condition.right;
            if (right && right.type === 'MemberExpression' && right.member === 'length') {
                const obj = right.object;
                if (obj && obj.type === 'Identifier') {
                    // Check if this is a state variable
                    const stateVars = this.stateVariables.get(this.currentContract) || [];
                    const isStateVar = stateVars.some(v => v.name === obj.name);

                    if (isStateVar) {
                        this.addFinding({
                            rule: 'CACHE_ARRAY_LENGTH',
                            severity: 'high',
                            line: forNode.line,
                            column: forNode.column,
                            message: `Cache '${obj.name}.length' outside the loop`,
                            description: 'Reading storage array length on each iteration costs ~2100 gas (cold) or ~100 gas (warm) per SLOAD.',
                            gasSavings: '~100-2100 gas per iteration',
                            before: `for (uint i = 0; i < ${obj.name}.length; i++)`,
                            after: `uint256 len = ${obj.name}.length;\nfor (uint i = 0; i < len; i++)`
                        });
                    }
                }
            }
        }

        // Check for unchecked increment
        if (forNode.update) {
            const hasUnchecked = this.containsUnchecked(forNode.body);
            if (!hasUnchecked && this.isSimpleIncrement(forNode.update)) {
                this.addFinding({
                    rule: 'UNCHECKED_INCREMENT',
                    severity: 'medium',
                    line: forNode.line,
                    column: forNode.column,
                    message: 'Use unchecked block for loop counter increment',
                    description: 'When loop bounds are known, overflow is impossible. Using unchecked saves ~60-80 gas per iteration.',
                    gasSavings: '~60-80 gas per iteration',
                    before: 'for (uint i = 0; i < len; i++)',
                    after: 'for (uint i = 0; i < len; ) {\n    // ... loop body ...\n    unchecked { ++i; }\n}'
                });
            }
        }

        // Check for i++ vs ++i
        if (forNode.update && this.usesPostIncrement(forNode.update)) {
            this.addFinding({
                rule: 'PREFIX_INCREMENT',
                severity: 'low',
                line: forNode.update.line || forNode.line,
                column: forNode.update.column || forNode.column,
                message: 'Use ++i instead of i++',
                description: 'Prefix increment is slightly more gas efficient as it doesn\'t create a temporary variable.',
                gasSavings: '~5 gas per operation'
            });
        }
    }

    /**
     * CHECK: Require statements with string messages
     */
    checkRequireString(node) {
        if (node.message && node.message.type === 'StringLiteral') {
            this.addFinding({
                rule: 'CUSTOM_ERRORS',
                severity: 'medium',
                line: node.line,
                column: node.column,
                message: 'Use custom errors instead of revert strings',
                description: 'Custom errors are more gas efficient than require strings. They use only 4 bytes selector.',
                gasSavings: '~50 gas deployment + runtime savings per revert',
                before: `require(${this.getSourceLine(node.line).trim()}`,
                after: 'if (!condition) revert CustomError();'
            });
        }
    }

    /**
     * CHECK: State variable optimizations (constant, immutable)
     */
    checkStateVariableOptimizations(node) {
        // Check if variable could be constant
        if (!node.isConstant && !node.isImmutable && node.initialValue) {
            const initValue = node.initialValue;
            if (this.isConstantValue(initValue)) {
                // Check if variable is ever modified
                // This is a simplified check - a full implementation would track all assignments
                this.addFinding({
                    rule: 'USE_CONSTANT',
                    severity: 'high',
                    line: node.line,
                    column: node.column,
                    message: `Consider making '${node.name}' constant or immutable`,
                    description: 'Constants and immutables are embedded in bytecode, avoiding SLOAD operations (~2100 gas).',
                    gasSavings: '~2100 gas per read',
                    before: `${this.getTypeName(node.typeName)} ${node.name} = ...`,
                    after: `${this.getTypeName(node.typeName)} constant ${node.name} = ...`
                });
            }
        }

        // Check for address that could be immutable
        if (!node.isConstant && !node.isImmutable) {
            const typeName = this.getTypeName(node.typeName);
            if (typeName === 'address' && node.visibility !== 'constant') {
                this.addFinding({
                    rule: 'USE_IMMUTABLE',
                    severity: 'medium',
                    line: node.line,
                    column: node.column,
                    message: `Consider making '${node.name}' immutable if set only in constructor`,
                    description: 'Immutable variables are stored in bytecode after construction, saving SLOAD gas.',
                    gasSavings: '~2100 gas per read'
                });
            }
        }
    }

    /**
     * CHECK: Binary expression optimizations
     */
    checkBinaryExpression(node) {
        // Check for > 0 instead of != 0 for unsigned integers
        if (node.operator === '>' && 
            node.right && 
            node.right.type === 'NumberLiteral' && 
            node.right.value === '0') {
            this.addFinding({
                rule: 'USE_NEQ_ZERO',
                severity: 'low',
                line: node.line,
                column: node.column,
                message: 'Use != 0 instead of > 0 for unsigned integer comparison',
                description: 'ISZERO opcode is slightly cheaper than GT for checking non-zero values.',
                gasSavings: '~6 gas',
                before: 'require(amount > 0)',
                after: 'require(amount != 0)'
            });
        }

        // Check for multiplication/division by powers of 2
        if ((node.operator === '*' || node.operator === '/') && 
            node.right && 
            node.right.type === 'NumberLiteral') {
            const value = parseInt(node.right.value);
            if (this.isPowerOfTwo(value) && value > 1) {
                const shift = Math.log2(value);
                const shiftOp = node.operator === '*' ? '<<' : '>>';
                this.addFinding({
                    rule: 'USE_SHIFT',
                    severity: 'low',
                    line: node.line,
                    column: node.column,
                    message: `Use bit shift instead of ${node.operator} ${value}`,
                    description: 'Bit shift operations are cheaper than multiplication/division for powers of 2.',
                    gasSavings: '~5 gas',
                    before: `x ${node.operator} ${value}`,
                    after: `x ${shiftOp} ${shift}`
                });
            }
        }
    }

    /**
     * CHECK: Increment/decrement style
     */
    checkIncrementStyle(node) {
        if (!node.prefix && (node.operator === '++' || node.operator === '--')) {
            // Already covered in loop check, but flag standalone uses too
            if (!this.currentFunction || !this.isInLoopUpdate(node)) {
                this.addFinding({
                    rule: 'PREFIX_INCREMENT',
                    severity: 'low',
                    line: node.line,
                    column: node.column,
                    message: `Use ${node.operator[0]}${node.operator} (prefix) instead of ${node.operator} (postfix)`,
                    description: 'Prefix increment/decrement is slightly more gas efficient.',
                    gasSavings: '~5 gas'
                });
            }
        }
    }

    /**
     * CHECK: Storage access patterns
     */
    checkStorageAccess(node) {
        // This is a simplified check - tracks member access patterns
        // A full implementation would use data flow analysis
    }

    /**
     * CHECK: Condition ordering for short-circuit evaluation
     */
    checkConditionOrder(node) {
        if (node.condition && node.condition.type === 'BinaryExpression') {
            const cond = node.condition;
            if (cond.operator === '&&' || cond.operator === '||') {
                // Check if left side is more expensive than right
                const leftCost = this.estimateExpressionCost(cond.left);
                const rightCost = this.estimateExpressionCost(cond.right);

                if (leftCost > rightCost && rightCost > 0) {
                    this.addFinding({
                        rule: 'SHORT_CIRCUIT',
                        severity: 'low',
                        line: node.line,
                        column: node.column,
                        message: 'Consider reordering conditions for short-circuit optimization',
                        description: 'Place cheaper conditions first in && chains (or more likely true conditions in || chains).',
                        gasSavings: 'Varies based on conditions'
                    });
                }
            }
        }
    }

    /**
     * CHECK: Variable declaration optimizations
     */
    checkVariableDeclaration(node) {
        // Check for default value initialization
        if (node.initialValue && 
            node.initialValue.type === 'NumberLiteral' && 
            node.initialValue.value === '0') {
            this.addFinding({
                rule: 'DEFAULT_VALUE',
                severity: 'low',
                line: node.line,
                column: node.column,
                message: 'Remove explicit zero initialization',
                description: 'Variables are automatically initialized to 0. Explicit initialization wastes gas.',
                gasSavings: '~3 gas',
                before: 'uint256 x = 0;',
                after: 'uint256 x;'
            });
        }
    }

    /**
     * CHECK: Assignment patterns
     */
    checkAssignment(node) {
        // Check for x = x + 1 instead of x += 1 or ++x
        if (node.operator === '=' && 
            node.right && 
            node.right.type === 'BinaryExpression' &&
            node.left && 
            node.left.type === 'Identifier') {
            const leftName = node.left.name;
            const right = node.right;
            
            if ((right.operator === '+' || right.operator === '-') &&
                right.left && 
                right.left.type === 'Identifier' &&
                right.left.name === leftName &&
                right.right &&
                right.right.type === 'NumberLiteral' &&
                right.right.value === '1') {
                const op = right.operator === '+' ? '++' : '--';
                this.addFinding({
                    rule: 'USE_INCREMENT_OPERATOR',
                    severity: 'low',
                    line: node.line,
                    column: node.column,
                    message: `Use ${op}${leftName} instead of ${leftName} = ${leftName} ${right.operator} 1`,
                    description: 'Increment/decrement operators are more gas efficient.',
                    gasSavings: '~5 gas'
                });
            }
        }
    }

    /**
     * CHECK: Storage variable packing
     */
    checkStoragePacking() {
        for (const [contractName, vars] of this.stateVariables) {
            if (vars.length < 2) continue;

            // Get type sizes
            const typeSizes = vars.map(v => ({
                ...v,
                size: this.getTypeSize(this.getTypeName(v.typeName))
            }));

            // Check if reordering could save slots
            let currentSlot = 0;
            let currentSlotUsed = 0;

            for (const v of typeSizes) {
                if (v.size === 32 || currentSlotUsed + v.size > 32) {
                    currentSlot++;
                    currentSlotUsed = v.size;
                } else {
                    currentSlotUsed += v.size;
                }
            }

            // Try optimal packing
            const sorted = [...typeSizes].sort((a, b) => b.size - a.size);
            let optimalSlots = 0;
            let optimalUsed = 0;

            for (const v of sorted) {
                if (v.size === 32 || optimalUsed + v.size > 32) {
                    optimalSlots++;
                    optimalUsed = v.size;
                } else {
                    optimalUsed += v.size;
                }
            }

            if (optimalSlots < currentSlot) {
                this.addFinding({
                    rule: 'STORAGE_PACKING',
                    severity: 'high',
                    line: vars[0].line,
                    message: `Contract '${contractName}' can optimize storage layout`,
                    description: `Reordering state variables could reduce storage slots from ${currentSlot + 1} to ${optimalSlots + 1}.`,
                    gasSavings: `~${(currentSlot - optimalSlots) * 20000} gas on deployment + runtime savings`,
                    suggestion: 'Group smaller variables together to pack into single 32-byte slots.'
                });
            }
        }
    }

    /**
     * Check loop condition for storage reads
     */
    checkLoopCondition(node) {
        if (!node.condition) return;

        const storageReads = this.findStorageReads(node.condition);
        if (storageReads.length > 0) {
            this.addFinding({
                rule: 'CACHE_STORAGE_IN_LOOP',
                severity: 'high',
                line: node.line,
                column: node.column,
                message: `Cache storage variable(s) before loop: ${storageReads.join(', ')}`,
                description: 'Storage reads in loop conditions are executed every iteration, costing ~100-2100 gas each.',
                gasSavings: '~100-2100 gas per iteration per variable'
            });
        }
    }

    // ========================================
    // HELPER METHODS
    // ========================================

    addFinding(finding) {
        this.findings.push({
            ...finding,
            contract: this.currentContract,
            function: this.currentFunction?.name
        });
    }

    getSourceLine(lineNum) {
        return this.sourceLines[lineNum - 1] || '';
    }

    getTypeName(typeNode) {
        if (!typeNode) return 'unknown';
        if (typeof typeNode === 'string') return typeNode;
        if (typeNode.type === 'MappingType') {
            return `mapping(${this.getTypeName(typeNode.keyType)} => ${this.getTypeName(typeNode.valueType)})`;
        }
        return typeNode.name || 'unknown';
    }

    getTypeSize(typeName) {
        const sizes = {
            'bool': 1,
            'uint8': 1, 'int8': 1, 'bytes1': 1,
            'uint16': 2, 'int16': 2, 'bytes2': 2,
            'uint32': 4, 'int32': 4, 'bytes4': 4,
            'uint64': 8, 'int64': 8, 'bytes8': 8,
            'uint128': 16, 'int128': 16, 'bytes16': 16,
            'uint256': 32, 'int256': 32, 'bytes32': 32,
            'uint': 32, 'int': 32,
            'address': 20,
            'bytes': 32, 'string': 32 // Dynamic, but slot reference is 32
        };
        return sizes[typeName] || 32;
    }

    isConstantValue(node) {
        if (!node) return false;
        return ['NumberLiteral', 'StringLiteral', 'BooleanLiteral'].includes(node.type);
    }

    isPowerOfTwo(n) {
        return n > 0 && (n & (n - 1)) === 0;
    }

    isSimpleIncrement(node) {
        if (!node) return false;
        if (node.type === 'UnaryExpression') {
            return node.operator === '++' || node.operator === '--';
        }
        return false;
    }

    usesPostIncrement(node) {
        if (!node) return false;
        if (node.type === 'UnaryExpression') {
            return !node.prefix && (node.operator === '++' || node.operator === '--');
        }
        return false;
    }

    containsUnchecked(node) {
        if (!node) return false;
        if (node.type === 'UncheckedBlock') return true;
        
        const childKeys = ['statements', 'body', 'thenBranch', 'elseBranch'];
        for (const key of childKeys) {
            const child = node[key];
            if (Array.isArray(child)) {
                if (child.some(c => this.containsUnchecked(c))) return true;
            } else if (child) {
                if (this.containsUnchecked(child)) return true;
            }
        }
        return false;
    }

    isParameterModified(paramName, body) {
        if (!body) return false;
        // Simplified check - looks for assignments to the parameter
        const checkNode = (node) => {
            if (!node) return false;
            
            if (node.type === 'AssignmentExpression' && 
                node.left && 
                node.left.type === 'Identifier' && 
                node.left.name === paramName) {
                return true;
            }

            // Check children
            for (const key in node) {
                const child = node[key];
                if (Array.isArray(child)) {
                    if (child.some(c => checkNode(c))) return true;
                } else if (child && typeof child === 'object') {
                    if (checkNode(child)) return true;
                }
            }
            return false;
        };

        return checkNode(body);
    }

    isInLoopUpdate(node) {
        // This would require parent tracking - simplified for now
        return false;
    }

    findStorageReads(node) {
        const reads = [];
        const stateVars = this.stateVariables.get(this.currentContract) || [];
        const stateVarNames = new Set(stateVars.map(v => v.name));

        const check = (n) => {
            if (!n) return;
            if (n.type === 'Identifier' && stateVarNames.has(n.name)) {
                reads.push(n.name);
            }
            for (const key in n) {
                const child = n[key];
                if (Array.isArray(child)) {
                    child.forEach(check);
                } else if (child && typeof child === 'object') {
                    check(child);
                }
            }
        };

        check(node);
        return [...new Set(reads)];
    }

    estimateExpressionCost(node) {
        if (!node) return 0;

        // Rough cost estimation
        switch (node.type) {
            case 'CallExpression':
                return 100; // Function calls are expensive
            case 'MemberExpression':
                return 10; // Could be storage read
            case 'Identifier':
                return 3;
            case 'NumberLiteral':
            case 'BooleanLiteral':
                return 1;
            case 'BinaryExpression':
                return this.estimateExpressionCost(node.left) + 
                       this.estimateExpressionCost(node.right) + 3;
            default:
                return 5;
        }
    }
}

module.exports = Analyzer;
