/**
 * Solidity Parser
 * 
 * Parses tokens into an Abstract Syntax Tree (AST) for analysis.
 * This is a simplified parser focused on constructs relevant to gas optimization.
 * 
 * @class Parser
 */

const Lexer = require('./lexer');
const T = Lexer.TOKEN_TYPES;

class Parser {
    /**
     * Create a new Parser instance
     * @param {Array} tokens - Array of tokens from lexer
     * @param {string} source - Original source code
     * @throws {Error} If tokens is not an array or source is not a string
     */
    constructor(tokens, source) {
        if (!Array.isArray(tokens)) {
            throw new Error('Tokens must be an array');
        }
        if (typeof source !== 'string') {
            throw new Error('Source must be a string');
        }
        this.tokens = tokens.filter(t => 
            t && t.type !== T.COMMENT // Keep NATSPEC for docs, filter null tokens
        );
        this.source = source;
        this.pos = 0;
    }

    /**
     * Main parsing entry point
     * @returns {Object} Abstract Syntax Tree
     * @throws {Error} If parsing fails critically
     */
    parse() {
        if (this.tokens.length === 0) {
            throw new Error('No tokens to parse');
        }

        const ast = {
            type: 'SourceUnit',
            children: [],
            pragmas: [],
            imports: []
        };

        let errorCount = 0;
        const MAX_ERRORS = 10;

        while (!this.isAtEnd()) {
            try {
                const node = this.parseTopLevel();
                if (node) {
                    if (node.type === 'PragmaDirective') {
                        ast.pragmas.push(node);
                    } else if (node.type === 'ImportDirective') {
                        ast.imports.push(node);
                    } else {
                        ast.children.push(node);
                    }
                }
            } catch (e) {
                errorCount++;
                if (errorCount > MAX_ERRORS) {
                    throw new Error(`Too many parsing errors (${errorCount}). Last error: ${e.message}`);
                }
                // Skip to next statement on error
                this.synchronize();
            }
        }

        return ast;
    }

    /**
     * Parse top-level declarations
     */
    parseTopLevel() {
        if (this.check(T.KEYWORD)) {
            const keyword = this.peek().value;

            switch (keyword) {
                case 'pragma':
                    return this.parsePragma();
                case 'import':
                    return this.parseImport();
                case 'contract':
                case 'interface':
                case 'library':
                case 'abstract':
                    return this.parseContract();
                case 'struct':
                    return this.parseStruct();
                case 'enum':
                    return this.parseEnum();
                case 'error':
                    return this.parseError();
                case 'function':
                    return this.parseFunction();
                case 'event':
                    return this.parseEvent();
            }
        }

        // Skip unknown tokens
        this.advance();
        return null;
    }

    /**
     * Parse pragma directive
     */
    parsePragma() {
        const start = this.peek();
        this.expect(T.KEYWORD, 'pragma');
        
        let value = '';
        while (!this.isAtEnd() && !this.check(T.SEMICOLON)) {
            value += this.advance().value + ' ';
        }
        this.expect(T.SEMICOLON);

        return {
            type: 'PragmaDirective',
            value: value.trim(),
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse import directive
     */
    parseImport() {
        const start = this.peek();
        this.expect(T.KEYWORD, 'import');
        
        let path = '';
        if (this.check(T.STRING)) {
            path = this.advance().value;
        }

        while (!this.isAtEnd() && !this.check(T.SEMICOLON)) {
            this.advance();
        }
        this.expect(T.SEMICOLON);

        return {
            type: 'ImportDirective',
            path,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse contract/interface/library definition
     */
    parseContract() {
        const start = this.peek();
        
        // Handle 'abstract contract'
        let isAbstract = false;
        if (this.checkKeyword('abstract')) {
            isAbstract = true;
            this.advance();
        }

        const kind = this.advance().value; // contract/interface/library
        const name = this.expect(T.IDENTIFIER).value;

        // Inheritance
        const baseContracts = [];
        if (this.checkKeyword('is')) {
            this.advance();
            do {
                baseContracts.push(this.parseTypeName());
            } while (this.match(T.COMMA));
        }

        this.expect(T.LBRACE);

        const members = [];
        while (!this.isAtEnd() && !this.check(T.RBRACE)) {
            const member = this.parseContractMember();
            if (member) {
                members.push(member);
            }
        }

        this.expect(T.RBRACE);

        return {
            type: 'ContractDefinition',
            kind,
            name,
            isAbstract,
            baseContracts,
            members,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse contract member (function, variable, modifier, etc.)
     */
    parseContractMember() {
        if (this.check(T.KEYWORD)) {
            const keyword = this.peek().value;

            switch (keyword) {
                case 'function':
                    return this.parseFunction();
                case 'constructor':
                    return this.parseConstructor();
                case 'modifier':
                    return this.parseModifier();
                case 'event':
                    return this.parseEvent();
                case 'error':
                    return this.parseError();
                case 'struct':
                    return this.parseStruct();
                case 'enum':
                    return this.parseEnum();
                case 'mapping':
                case 'address':
                case 'bool':
                case 'string':
                case 'bytes':
                case 'uint':
                case 'uint8':
                case 'uint16':
                case 'uint32':
                case 'uint64':
                case 'uint128':
                case 'uint256':
                case 'int':
                case 'int8':
                case 'int16':
                case 'int32':
                case 'int64':
                case 'int128':
                case 'int256':
                case 'bytes1':
                case 'bytes2':
                case 'bytes4':
                case 'bytes8':
                case 'bytes16':
                case 'bytes32':
                    return this.parseStateVariable();
                case 'using':
                    return this.parseUsingDirective();
                case 'receive':
                case 'fallback':
                    return this.parseSpecialFunction();
            }
        }

        // Could be a user-defined type state variable
        if (this.check(T.IDENTIFIER)) {
            return this.parseStateVariable();
        }

        // Skip NatSpec comments
        if (this.check(T.NATSPEC)) {
            this.advance();
            return null;
        }

        this.advance();
        return null;
    }

    /**
     * Parse function definition
     */
    parseFunction() {
        const start = this.peek();
        this.expect(T.KEYWORD, 'function');

        let name = '';
        if (this.check(T.IDENTIFIER)) {
            name = this.advance().value;
        }

        // Parameters
        this.expect(T.LPAREN);
        const parameters = this.parseParameterList();
        this.expect(T.RPAREN);

        // Modifiers and visibility
        const modifiers = [];
        let visibility = 'public'; // default
        let stateMutability = null;
        let isVirtual = false;
        let isOverride = false;
        const customModifiers = [];

        while (!this.isAtEnd() && !this.check(T.LBRACE) && !this.check(T.SEMICOLON) && !this.checkKeyword('returns')) {
            if (this.checkKeyword('public') || this.checkKeyword('private') || 
                this.checkKeyword('internal') || this.checkKeyword('external')) {
                visibility = this.advance().value;
            } else if (this.checkKeyword('pure') || this.checkKeyword('view') || this.checkKeyword('payable')) {
                stateMutability = this.advance().value;
            } else if (this.checkKeyword('virtual')) {
                isVirtual = true;
                this.advance();
            } else if (this.checkKeyword('override')) {
                isOverride = true;
                this.advance();
                // Handle override(Contract1, Contract2)
                if (this.check(T.LPAREN)) {
                    this.skipBalanced(T.LPAREN, T.RPAREN);
                }
            } else if (this.check(T.IDENTIFIER)) {
                // Custom modifier
                const modName = this.advance().value;
                let modArgs = [];
                if (this.check(T.LPAREN)) {
                    this.advance();
                    // Parse modifier arguments
                    while (!this.isAtEnd() && !this.check(T.RPAREN)) {
                        this.advance();
                    }
                    this.expect(T.RPAREN);
                }
                customModifiers.push({ name: modName, args: modArgs });
            } else {
                break;
            }
        }

        // Return parameters
        let returns = [];
        if (this.checkKeyword('returns')) {
            this.advance();
            this.expect(T.LPAREN);
            returns = this.parseParameterList();
            this.expect(T.RPAREN);
        }

        // Function body or semicolon
        let body = null;
        if (this.check(T.LBRACE)) {
            body = this.parseBlock();
        } else {
            this.match(T.SEMICOLON);
        }

        return {
            type: 'FunctionDefinition',
            name,
            parameters,
            visibility,
            stateMutability,
            isVirtual,
            isOverride,
            customModifiers,
            returns,
            body,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse constructor
     */
    parseConstructor() {
        const start = this.peek();
        this.expect(T.KEYWORD, 'constructor');

        this.expect(T.LPAREN);
        const parameters = this.parseParameterList();
        this.expect(T.RPAREN);

        // Modifiers
        const modifiers = [];
        while (!this.isAtEnd() && !this.check(T.LBRACE)) {
            if (this.checkKeyword('public') || this.checkKeyword('internal') || this.checkKeyword('payable')) {
                modifiers.push(this.advance().value);
            } else if (this.check(T.IDENTIFIER)) {
                modifiers.push(this.advance().value);
                if (this.check(T.LPAREN)) {
                    this.skipBalanced(T.LPAREN, T.RPAREN);
                }
            } else {
                break;
            }
        }

        const body = this.parseBlock();

        return {
            type: 'ConstructorDefinition',
            parameters,
            modifiers,
            body,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse modifier definition
     */
    parseModifier() {
        const start = this.peek();
        this.expect(T.KEYWORD, 'modifier');
        const name = this.expect(T.IDENTIFIER).value;

        let parameters = [];
        if (this.check(T.LPAREN)) {
            this.advance();
            parameters = this.parseParameterList();
            this.expect(T.RPAREN);
        }

        // Virtual/override
        while (this.checkKeyword('virtual') || this.checkKeyword('override')) {
            this.advance();
        }

        const body = this.parseBlock();

        return {
            type: 'ModifierDefinition',
            name,
            parameters,
            body,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse state variable declaration
     */
    parseStateVariable() {
        const start = this.peek();
        const typeName = this.parseTypeName();

        let visibility = 'internal'; // default
        let isConstant = false;
        let isImmutable = false;
        let override = false;

        // Parse modifiers before name
        while (this.checkKeyword('public') || this.checkKeyword('private') || 
               this.checkKeyword('internal') || this.checkKeyword('constant') ||
               this.checkKeyword('immutable') || this.checkKeyword('override')) {
            const mod = this.advance().value;
            if (mod === 'public' || mod === 'private' || mod === 'internal') {
                visibility = mod;
            } else if (mod === 'constant') {
                isConstant = true;
            } else if (mod === 'immutable') {
                isImmutable = true;
            } else if (mod === 'override') {
                override = true;
            }
        }

        const name = this.expect(T.IDENTIFIER).value;

        // Initial value
        let initialValue = null;
        if (this.match(T.ASSIGN)) {
            initialValue = this.parseExpression();
        }

        this.expect(T.SEMICOLON);

        return {
            type: 'StateVariableDeclaration',
            typeName,
            name,
            visibility,
            isConstant,
            isImmutable,
            override,
            initialValue,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse event definition
     */
    parseEvent() {
        const start = this.peek();
        this.expect(T.KEYWORD, 'event');
        const name = this.expect(T.IDENTIFIER).value;

        this.expect(T.LPAREN);
        const parameters = [];
        while (!this.isAtEnd() && !this.check(T.RPAREN)) {
            const param = this.parseEventParameter();
            if (param) parameters.push(param);
            if (!this.match(T.COMMA)) break;
        }
        this.expect(T.RPAREN);

        let anonymous = false;
        if (this.checkKeyword('anonymous')) {
            anonymous = true;
            this.advance();
        }

        this.expect(T.SEMICOLON);

        return {
            type: 'EventDefinition',
            name,
            parameters,
            anonymous,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse custom error definition
     */
    parseError() {
        const start = this.peek();
        this.expect(T.KEYWORD, 'error');
        const name = this.expect(T.IDENTIFIER).value;

        this.expect(T.LPAREN);
        const parameters = this.parseParameterList();
        this.expect(T.RPAREN);
        this.expect(T.SEMICOLON);

        return {
            type: 'ErrorDefinition',
            name,
            parameters,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse struct definition
     */
    parseStruct() {
        const start = this.peek();
        this.expect(T.KEYWORD, 'struct');
        const name = this.expect(T.IDENTIFIER).value;

        this.expect(T.LBRACE);
        const members = [];
        while (!this.isAtEnd() && !this.check(T.RBRACE)) {
            const typeName = this.parseTypeName();
            const memberName = this.expect(T.IDENTIFIER).value;
            this.expect(T.SEMICOLON);
            members.push({ typeName, name: memberName });
        }
        this.expect(T.RBRACE);

        return {
            type: 'StructDefinition',
            name,
            members,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse enum definition
     */
    parseEnum() {
        const start = this.peek();
        this.expect(T.KEYWORD, 'enum');
        const name = this.expect(T.IDENTIFIER).value;

        this.expect(T.LBRACE);
        const values = [];
        while (!this.isAtEnd() && !this.check(T.RBRACE)) {
            values.push(this.expect(T.IDENTIFIER).value);
            if (!this.match(T.COMMA)) break;
        }
        this.expect(T.RBRACE);

        return {
            type: 'EnumDefinition',
            name,
            values,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse using directive
     */
    parseUsingDirective() {
        const start = this.peek();
        this.expect(T.KEYWORD, 'using');

        let library = '';
        if (this.check(T.IDENTIFIER)) {
            library = this.advance().value;
        }

        this.expect(T.KEYWORD, 'for');

        let forType = '*';
        if (!this.check(T.STAR)) {
            forType = this.parseTypeName();
        } else {
            this.advance();
        }

        this.expect(T.SEMICOLON);

        return {
            type: 'UsingDirective',
            library,
            forType,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse special functions (receive, fallback)
     */
    parseSpecialFunction() {
        const start = this.peek();
        const kind = this.advance().value; // receive or fallback

        this.expect(T.LPAREN);
        const parameters = this.parseParameterList();
        this.expect(T.RPAREN);

        // Modifiers
        while (!this.isAtEnd() && !this.check(T.LBRACE)) {
            if (this.checkKeyword('external') || this.checkKeyword('payable') || 
                this.checkKeyword('virtual') || this.checkKeyword('override')) {
                this.advance();
            } else if (this.checkKeyword('returns')) {
                this.advance();
                this.expect(T.LPAREN);
                this.parseParameterList();
                this.expect(T.RPAREN);
            } else {
                break;
            }
        }

        const body = this.parseBlock();

        return {
            type: 'SpecialFunctionDefinition',
            kind,
            parameters,
            body,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse parameter list
     */
    parseParameterList() {
        const parameters = [];

        while (!this.isAtEnd() && !this.check(T.RPAREN)) {
            const param = this.parseParameter();
            if (param) parameters.push(param);
            if (!this.match(T.COMMA)) break;
        }

        return parameters;
    }

    /**
     * Parse single parameter
     */
    parseParameter() {
        const start = this.peek();
        const typeName = this.parseTypeName();

        let dataLocation = null;
        if (this.checkKeyword('memory') || this.checkKeyword('storage') || this.checkKeyword('calldata')) {
            dataLocation = this.advance().value;
        }

        let name = '';
        if (this.check(T.IDENTIFIER)) {
            name = this.advance().value;
        }

        return {
            type: 'Parameter',
            typeName,
            dataLocation,
            name,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse event parameter
     */
    parseEventParameter() {
        const typeName = this.parseTypeName();
        
        let indexed = false;
        if (this.checkKeyword('indexed')) {
            indexed = true;
            this.advance();
        }

        let name = '';
        if (this.check(T.IDENTIFIER)) {
            name = this.advance().value;
        }

        return { typeName, indexed, name };
    }

    /**
     * Parse type name
     */
    parseTypeName() {
        const start = this.peek();

        // Mapping type
        if (this.checkKeyword('mapping')) {
            return this.parseMappingType();
        }

        // Array or basic type
        let baseType = this.advance().value;

        // Handle mapping in longer form: mapping(address => uint)
        // Handle array types: uint256[], bytes32[10]
        while (this.check(T.LBRACKET)) {
            this.advance();
            let size = '';
            if (!this.check(T.RBRACKET)) {
                if (this.check(T.NUMBER)) {
                    size = this.advance().value;
                }
            }
            this.expect(T.RBRACKET);
            baseType += `[${size}]`;
        }

        return {
            type: 'TypeName',
            name: baseType,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse mapping type
     */
    parseMappingType() {
        const start = this.peek();
        this.expect(T.KEYWORD, 'mapping');
        this.expect(T.LPAREN);

        const keyType = this.parseTypeName();
        
        this.expect(T.ARROW);

        const valueType = this.parseTypeName();

        this.expect(T.RPAREN);

        return {
            type: 'MappingType',
            keyType,
            valueType,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse a block of statements
     */
    parseBlock() {
        const start = this.peek();
        this.expect(T.LBRACE);

        const statements = [];
        while (!this.isAtEnd() && !this.check(T.RBRACE)) {
            const stmt = this.parseStatement();
            if (stmt) statements.push(stmt);
        }

        this.expect(T.RBRACE);

        return {
            type: 'Block',
            statements,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse a statement
     */
    parseStatement() {
        // Handle various statement types
        if (this.check(T.LBRACE)) {
            return this.parseBlock();
        }

        if (this.checkKeyword('if')) {
            return this.parseIfStatement();
        }

        if (this.checkKeyword('for')) {
            return this.parseForStatement();
        }

        if (this.checkKeyword('while')) {
            return this.parseWhileStatement();
        }

        if (this.checkKeyword('do')) {
            return this.parseDoWhileStatement();
        }

        if (this.checkKeyword('return')) {
            return this.parseReturnStatement();
        }

        if (this.checkKeyword('emit')) {
            return this.parseEmitStatement();
        }

        if (this.checkKeyword('revert')) {
            return this.parseRevertStatement();
        }

        if (this.checkKeyword('require') || this.checkKeyword('assert')) {
            return this.parseRequireStatement();
        }

        if (this.checkKeyword('unchecked')) {
            return this.parseUncheckedBlock();
        }

        if (this.checkKeyword('assembly')) {
            return this.parseAssemblyBlock();
        }

        if (this.checkKeyword('try')) {
            return this.parseTryStatement();
        }

        // Variable declaration or expression statement
        return this.parseExpressionOrDeclaration();
    }

    /**
     * Parse if statement
     */
    parseIfStatement() {
        const start = this.peek();
        this.expect(T.KEYWORD, 'if');
        this.expect(T.LPAREN);
        const condition = this.parseExpression();
        this.expect(T.RPAREN);

        const thenBranch = this.parseStatement();

        let elseBranch = null;
        if (this.checkKeyword('else')) {
            this.advance();
            elseBranch = this.parseStatement();
        }

        return {
            type: 'IfStatement',
            condition,
            thenBranch,
            elseBranch,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse for statement
     */
    parseForStatement() {
        const start = this.peek();
        this.expect(T.KEYWORD, 'for');
        this.expect(T.LPAREN);

        let init = null;
        if (!this.check(T.SEMICOLON)) {
            init = this.parseExpressionOrDeclaration();
        } else {
            this.advance();
        }

        let condition = null;
        if (!this.check(T.SEMICOLON)) {
            condition = this.parseExpression();
        }
        this.expect(T.SEMICOLON);

        let update = null;
        if (!this.check(T.RPAREN)) {
            update = this.parseExpression();
        }
        this.expect(T.RPAREN);

        const body = this.parseStatement();

        return {
            type: 'ForStatement',
            init,
            condition,
            update,
            body,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse while statement
     */
    parseWhileStatement() {
        const start = this.peek();
        this.expect(T.KEYWORD, 'while');
        this.expect(T.LPAREN);
        const condition = this.parseExpression();
        this.expect(T.RPAREN);
        const body = this.parseStatement();

        return {
            type: 'WhileStatement',
            condition,
            body,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse do-while statement
     */
    parseDoWhileStatement() {
        const start = this.peek();
        this.expect(T.KEYWORD, 'do');
        const body = this.parseStatement();
        this.expect(T.KEYWORD, 'while');
        this.expect(T.LPAREN);
        const condition = this.parseExpression();
        this.expect(T.RPAREN);
        this.expect(T.SEMICOLON);

        return {
            type: 'DoWhileStatement',
            condition,
            body,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse return statement
     */
    parseReturnStatement() {
        const start = this.peek();
        this.expect(T.KEYWORD, 'return');

        let value = null;
        if (!this.check(T.SEMICOLON)) {
            value = this.parseExpression();
        }
        this.expect(T.SEMICOLON);

        return {
            type: 'ReturnStatement',
            value,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse emit statement
     */
    parseEmitStatement() {
        const start = this.peek();
        this.expect(T.KEYWORD, 'emit');
        const expression = this.parseExpression();
        this.expect(T.SEMICOLON);

        return {
            type: 'EmitStatement',
            expression,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse revert statement
     */
    parseRevertStatement() {
        const start = this.peek();
        this.expect(T.KEYWORD, 'revert');
        
        let error = null;
        if (!this.check(T.SEMICOLON)) {
            error = this.parseExpression();
        }
        this.expect(T.SEMICOLON);

        return {
            type: 'RevertStatement',
            error,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse require/assert statement
     */
    parseRequireStatement() {
        const start = this.peek();
        const kind = this.advance().value; // require or assert

        this.expect(T.LPAREN);
        const condition = this.parseExpression();
        
        let message = null;
        if (this.match(T.COMMA)) {
            message = this.parseExpression();
        }
        this.expect(T.RPAREN);
        this.expect(T.SEMICOLON);

        return {
            type: 'RequireStatement',
            kind,
            condition,
            message,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse unchecked block
     */
    parseUncheckedBlock() {
        const start = this.peek();
        this.expect(T.KEYWORD, 'unchecked');
        const body = this.parseBlock();

        return {
            type: 'UncheckedBlock',
            body,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse assembly block
     */
    parseAssemblyBlock() {
        const start = this.peek();
        this.expect(T.KEYWORD, 'assembly');

        // Optional dialect
        let dialect = null;
        if (this.check(T.STRING)) {
            dialect = this.advance().value;
        }

        // Skip the assembly body
        this.expect(T.LBRACE);
        let braceCount = 1;
        const bodyTokens = [];
        while (!this.isAtEnd() && braceCount > 0) {
            const token = this.advance();
            if (token.type === T.LBRACE) braceCount++;
            if (token.type === T.RBRACE) braceCount--;
            if (braceCount > 0) bodyTokens.push(token);
        }

        return {
            type: 'AssemblyBlock',
            dialect,
            body: bodyTokens,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse try statement
     */
    parseTryStatement() {
        const start = this.peek();
        this.expect(T.KEYWORD, 'try');
        
        const expression = this.parseExpression();

        // returns clause
        let returns = [];
        if (this.checkKeyword('returns')) {
            this.advance();
            this.expect(T.LPAREN);
            returns = this.parseParameterList();
            this.expect(T.RPAREN);
        }

        const body = this.parseBlock();

        // catch clauses
        const catchClauses = [];
        while (this.checkKeyword('catch')) {
            this.advance();
            let errorName = null;
            let errorParams = [];

            if (this.check(T.IDENTIFIER)) {
                errorName = this.advance().value;
            }

            if (this.check(T.LPAREN)) {
                this.advance();
                errorParams = this.parseParameterList();
                this.expect(T.RPAREN);
            }

            const catchBody = this.parseBlock();
            catchClauses.push({ errorName, errorParams, body: catchBody });
        }

        return {
            type: 'TryStatement',
            expression,
            returns,
            body,
            catchClauses,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse expression or variable declaration
     */
    parseExpressionOrDeclaration() {
        const start = this.peek();

        // Try to determine if this is a declaration
        // This is a simplified heuristic
        if (this.isTypeName()) {
            return this.parseVariableDeclaration();
        }

        // Expression statement
        const expr = this.parseExpression();
        this.expect(T.SEMICOLON);

        return {
            type: 'ExpressionStatement',
            expression: expr,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Check if current token starts a type name
     */
    isTypeName() {
        if (!this.check(T.KEYWORD) && !this.check(T.IDENTIFIER)) return false;

        const value = this.peek().value;
        const typeKeywords = [
            'mapping', 'address', 'bool', 'string', 'bytes', 'byte',
            'int', 'int8', 'int16', 'int32', 'int64', 'int128', 'int256',
            'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uint128', 'uint256',
            'bytes1', 'bytes2', 'bytes4', 'bytes8', 'bytes16', 'bytes32'
        ];

        if (typeKeywords.includes(value)) return true;

        // Could be a user-defined type - look ahead for pattern: Type name
        // This is a simplification
        if (this.check(T.IDENTIFIER)) {
            const saved = this.pos;
            this.advance();
            
            // Skip array brackets
            while (this.check(T.LBRACKET)) {
                this.skipBalanced(T.LBRACKET, T.RBRACKET);
            }

            // Skip data location
            if (this.checkKeyword('memory') || this.checkKeyword('storage') || this.checkKeyword('calldata')) {
                this.advance();
            }

            const isDecl = this.check(T.IDENTIFIER);
            this.pos = saved;
            return isDecl;
        }

        return false;
    }

    /**
     * Parse variable declaration statement
     */
    parseVariableDeclaration() {
        const start = this.peek();
        const typeName = this.parseTypeName();

        let dataLocation = null;
        if (this.checkKeyword('memory') || this.checkKeyword('storage') || this.checkKeyword('calldata')) {
            dataLocation = this.advance().value;
        }

        const name = this.expect(T.IDENTIFIER).value;

        let initialValue = null;
        if (this.match(T.ASSIGN)) {
            initialValue = this.parseExpression();
        }

        this.expect(T.SEMICOLON);

        return {
            type: 'VariableDeclarationStatement',
            typeName,
            dataLocation,
            name,
            initialValue,
            line: start.line,
            column: start.column
        };
    }

    /**
     * Parse expression (simplified)
     */
    parseExpression() {
        return this.parseAssignment();
    }

    parseAssignment() {
        const expr = this.parseTernary();

        if (this.check(T.ASSIGN) || this.check(T.PLUS_ASSIGN) || 
            this.check(T.MINUS_ASSIGN) || this.check(T.STAR_ASSIGN) || 
            this.check(T.SLASH_ASSIGN)) {
            const operator = this.advance();
            const value = this.parseAssignment();
            return {
                type: 'AssignmentExpression',
                operator: operator.value,
                left: expr,
                right: value,
                line: expr.line,
                column: expr.column
            };
        }

        return expr;
    }

    parseTernary() {
        const expr = this.parseOr();

        if (this.match(T.QUESTION)) {
            const thenExpr = this.parseExpression();
            this.expect(T.COLON);
            const elseExpr = this.parseTernary();
            return {
                type: 'TernaryExpression',
                condition: expr,
                thenExpression: thenExpr,
                elseExpression: elseExpr,
                line: expr.line,
                column: expr.column
            };
        }

        return expr;
    }

    parseOr() {
        let expr = this.parseAnd();

        while (this.match(T.OR)) {
            const right = this.parseAnd();
            expr = {
                type: 'BinaryExpression',
                operator: '||',
                left: expr,
                right,
                line: expr.line,
                column: expr.column
            };
        }

        return expr;
    }

    parseAnd() {
        let expr = this.parseEquality();

        while (this.match(T.AND)) {
            const right = this.parseEquality();
            expr = {
                type: 'BinaryExpression',
                operator: '&&',
                left: expr,
                right,
                line: expr.line,
                column: expr.column
            };
        }

        return expr;
    }

    parseEquality() {
        let expr = this.parseComparison();

        while (this.check(T.EQ) || this.check(T.NEQ)) {
            const operator = this.advance();
            const right = this.parseComparison();
            expr = {
                type: 'BinaryExpression',
                operator: operator.value,
                left: expr,
                right,
                line: expr.line,
                column: expr.column
            };
        }

        return expr;
    }

    parseComparison() {
        let expr = this.parseBitOr();

        while (this.check(T.LT) || this.check(T.GT) || this.check(T.LTE) || this.check(T.GTE)) {
            const operator = this.advance();
            const right = this.parseBitOr();
            expr = {
                type: 'BinaryExpression',
                operator: operator.value,
                left: expr,
                right,
                line: expr.line,
                column: expr.column
            };
        }

        return expr;
    }

    parseBitOr() {
        let expr = this.parseBitXor();

        while (this.match(T.PIPE)) {
            const right = this.parseBitXor();
            expr = {
                type: 'BinaryExpression',
                operator: '|',
                left: expr,
                right,
                line: expr.line,
                column: expr.column
            };
        }

        return expr;
    }

    parseBitXor() {
        let expr = this.parseBitAnd();

        while (this.match(T.CARET)) {
            const right = this.parseBitAnd();
            expr = {
                type: 'BinaryExpression',
                operator: '^',
                left: expr,
                right,
                line: expr.line,
                column: expr.column
            };
        }

        return expr;
    }

    parseBitAnd() {
        let expr = this.parseShift();

        while (this.match(T.AMPERSAND)) {
            const right = this.parseShift();
            expr = {
                type: 'BinaryExpression',
                operator: '&',
                left: expr,
                right,
                line: expr.line,
                column: expr.column
            };
        }

        return expr;
    }

    parseShift() {
        let expr = this.parseAdditive();

        while (this.check(T.LSHIFT) || this.check(T.RSHIFT)) {
            const operator = this.advance();
            const right = this.parseAdditive();
            expr = {
                type: 'BinaryExpression',
                operator: operator.value,
                left: expr,
                right,
                line: expr.line,
                column: expr.column
            };
        }

        return expr;
    }

    parseAdditive() {
        let expr = this.parseMultiplicative();

        while (this.check(T.PLUS) || this.check(T.MINUS)) {
            const operator = this.advance();
            const right = this.parseMultiplicative();
            expr = {
                type: 'BinaryExpression',
                operator: operator.value,
                left: expr,
                right,
                line: expr.line,
                column: expr.column
            };
        }

        return expr;
    }

    parseMultiplicative() {
        let expr = this.parsePower();

        while (this.check(T.STAR) || this.check(T.SLASH) || this.check(T.PERCENT)) {
            const operator = this.advance();
            const right = this.parsePower();
            expr = {
                type: 'BinaryExpression',
                operator: operator.value,
                left: expr,
                right,
                line: expr.line,
                column: expr.column
            };
        }

        return expr;
    }

    parsePower() {
        const expr = this.parseUnary();

        if (this.match(T.POWER)) {
            const right = this.parsePower();
            return {
                type: 'BinaryExpression',
                operator: '**',
                left: expr,
                right,
                line: expr.line,
                column: expr.column
            };
        }

        return expr;
    }

    parseUnary() {
        if (this.check(T.NOT) || this.check(T.TILDE) || this.check(T.MINUS) || 
            this.check(T.INCREMENT) || this.check(T.DECREMENT)) {
            const operator = this.advance();
            const operand = this.parseUnary();
            return {
                type: 'UnaryExpression',
                operator: operator.value,
                operand,
                prefix: true,
                line: operator.line,
                column: operator.column
            };
        }

        return this.parsePostfix();
    }

    parsePostfix() {
        let expr = this.parsePrimary();

        while (true) {
            if (this.check(T.INCREMENT) || this.check(T.DECREMENT)) {
                const operator = this.advance();
                expr = {
                    type: 'UnaryExpression',
                    operator: operator.value,
                    operand: expr,
                    prefix: false,
                    line: expr.line,
                    column: expr.column
                };
            } else if (this.match(T.DOT)) {
                const member = this.expect(T.IDENTIFIER);
                expr = {
                    type: 'MemberExpression',
                    object: expr,
                    member: member.value,
                    line: expr.line,
                    column: expr.column
                };
            } else if (this.check(T.LBRACKET)) {
                this.advance();
                const index = this.parseExpression();
                this.expect(T.RBRACKET);
                expr = {
                    type: 'IndexExpression',
                    object: expr,
                    index,
                    line: expr.line,
                    column: expr.column
                };
            } else if (this.check(T.LPAREN)) {
                this.advance();
                const args = [];
                while (!this.isAtEnd() && !this.check(T.RPAREN)) {
                    args.push(this.parseExpression());
                    if (!this.match(T.COMMA)) break;
                }
                this.expect(T.RPAREN);
                expr = {
                    type: 'CallExpression',
                    callee: expr,
                    arguments: args,
                    line: expr.line,
                    column: expr.column
                };
            } else if (this.check(T.LBRACE)) {
                // Struct initialization
                this.advance();
                const fields = [];
                while (!this.isAtEnd() && !this.check(T.RBRACE)) {
                    const fieldName = this.expect(T.IDENTIFIER).value;
                    this.expect(T.COLON);
                    const fieldValue = this.parseExpression();
                    fields.push({ name: fieldName, value: fieldValue });
                    if (!this.match(T.COMMA)) break;
                }
                this.expect(T.RBRACE);
                expr = {
                    type: 'StructExpression',
                    typeName: expr,
                    fields,
                    line: expr.line,
                    column: expr.column
                };
            } else {
                break;
            }
        }

        return expr;
    }

    parsePrimary() {
        const token = this.peek();

        // Number literal
        if (this.check(T.NUMBER)) {
            this.advance();
            return {
                type: 'NumberLiteral',
                value: token.value,
                line: token.line,
                column: token.column
            };
        }

        // String literal
        if (this.check(T.STRING)) {
            this.advance();
            return {
                type: 'StringLiteral',
                value: token.value,
                line: token.line,
                column: token.column
            };
        }

        // Boolean literals
        if (this.checkKeyword('true') || this.checkKeyword('false')) {
            this.advance();
            return {
                type: 'BooleanLiteral',
                value: token.value === 'true',
                line: token.line,
                column: token.column
            };
        }

        // Identifier or keyword used as identifier
        if (this.check(T.IDENTIFIER) || this.check(T.KEYWORD)) {
            this.advance();
            return {
                type: 'Identifier',
                name: token.value,
                line: token.line,
                column: token.column
            };
        }

        // Parenthesized expression or tuple
        if (this.check(T.LPAREN)) {
            this.advance();
            
            // Check for tuple
            const expressions = [];
            if (!this.check(T.RPAREN)) {
                expressions.push(this.parseExpression());
                while (this.match(T.COMMA)) {
                    if (!this.check(T.RPAREN)) {
                        expressions.push(this.parseExpression());
                    }
                }
            }
            this.expect(T.RPAREN);

            if (expressions.length === 1) {
                return expressions[0];
            }

            return {
                type: 'TupleExpression',
                elements: expressions,
                line: token.line,
                column: token.column
            };
        }

        // Array literal
        if (this.check(T.LBRACKET)) {
            this.advance();
            const elements = [];
            while (!this.isAtEnd() && !this.check(T.RBRACKET)) {
                elements.push(this.parseExpression());
                if (!this.match(T.COMMA)) break;
            }
            this.expect(T.RBRACKET);
            return {
                type: 'ArrayLiteral',
                elements,
                line: token.line,
                column: token.column
            };
        }

        // new expression
        if (this.checkKeyword('new')) {
            this.advance();
            const typeName = this.parseTypeName();
            return {
                type: 'NewExpression',
                typeName,
                line: token.line,
                column: token.column
            };
        }

        // type() expression
        if (this.checkKeyword('type')) {
            this.advance();
            this.expect(T.LPAREN);
            const arg = this.parseTypeName();
            this.expect(T.RPAREN);
            return {
                type: 'TypeExpression',
                argument: arg,
                line: token.line,
                column: token.column
            };
        }

        // Default - advance and return placeholder
        this.advance();
        return {
            type: 'Unknown',
            value: token.value,
            line: token.line,
            column: token.column
        };
    }

    // Helper methods

    /**
     * Peek at current token without advancing
     * @returns {Object} Current token
     */
    peek() {
        if (this.pos >= this.tokens.length) {
            return { type: T.EOF, value: '', line: 0, column: 0 };
        }
        return this.tokens[this.pos];
    }

    /**
     * Advance to next token
     * @returns {Object} Current token before advancing
     */
    advance() {
        if (!this.isAtEnd()) {
            return this.tokens[this.pos++];
        }
        return this.peek();
    }

    /**
     * Check if at end of tokens
     * @returns {boolean} True if at end
     */
    isAtEnd() {
        return this.pos >= this.tokens.length || (this.peek() && this.peek().type === T.EOF);
    }

    /**
     * Check if current token matches type
     * @param {string} type - Token type to check
     * @returns {boolean} True if matches
     */
    check(type) {
        if (this.isAtEnd()) return false;
        const token = this.peek();
        return token && token.type === type;
    }

    /**
     * Check if current token is a keyword with specific value
     * @param {string} keyword - Keyword value to check
     * @returns {boolean} True if matches
     */
    checkKeyword(keyword) {
        return this.check(T.KEYWORD) && this.peek().value === keyword;
    }

    /**
     * Match and consume token if it matches type
     * @param {string} type - Token type to match
     * @returns {boolean} True if matched and consumed
     */
    match(type) {
        if (this.check(type)) {
            this.advance();
            return true;
        }
        return false;
    }

    /**
     * Expect a token of specific type (and optionally value)
     * @param {string} type - Expected token type
     * @param {string|null} value - Optional expected token value
     * @returns {Object} The matched token
     * @throws {Error} If token doesn't match
     */
    expect(type, value = null) {
        if (this.check(type)) {
            const token = this.peek();
            if (value === null || token.value === value) {
                return this.advance();
            }
        }
        const token = this.peek();
        const tokenInfo = token ? `${token.type} '${token.value}'` : 'EOF';
        throw new Error(
            `Expected ${type}${value ? ` '${value}'` : ''} at line ${token?.line || 0}, column ${token?.column || 0}, got ${tokenInfo}`
        );
    }

    skipBalanced(open, close) {
        this.expect(open);
        let count = 1;
        while (!this.isAtEnd() && count > 0) {
            if (this.check(open)) count++;
            if (this.check(close)) count--;
            this.advance();
        }
    }

    synchronize() {
        this.advance();
        while (!this.isAtEnd()) {
            if (this.tokens[this.pos - 1].type === T.SEMICOLON) return;
            if (this.tokens[this.pos - 1].type === T.RBRACE) return;

            if (this.check(T.KEYWORD)) {
                const kw = this.peek().value;
                if (['contract', 'function', 'modifier', 'event', 'struct', 'enum'].includes(kw)) {
                    return;
                }
            }
            this.advance();
        }
    }
}

module.exports = Parser;
