/**
 * Solidity Lexer
 * 
 * Tokenizes Solidity source code into a stream of tokens
 * for parsing and analysis.
 * 
 * @class Lexer
 */
class Lexer {
    /**
     * Create a new Lexer instance
     * @param {string} source - Source code to tokenize
     * @throws {Error} If source is not a string
     */
    constructor(source) {
        if (typeof source !== 'string') {
            throw new Error('Source must be a string');
        }
        this.source = source;
        this.pos = 0;
        this.line = 1;
        this.column = 1;
        this.tokens = [];
    }

    // Solidity keywords
    static KEYWORDS = new Set([
        'pragma', 'solidity', 'import', 'contract', 'interface', 'library',
        'abstract', 'is', 'using', 'for', 'struct', 'enum', 'event', 'error',
        'function', 'modifier', 'constructor', 'fallback', 'receive',
        'public', 'private', 'internal', 'external', 'pure', 'view', 'payable',
        'virtual', 'override', 'constant', 'immutable', 'anonymous', 'indexed',
        'storage', 'memory', 'calldata',
        'if', 'else', 'while', 'do', 'for', 'break', 'continue', 'return',
        'try', 'catch', 'revert', 'require', 'assert',
        'new', 'delete', 'emit', 'assembly', 'unchecked',
        'mapping', 'address', 'bool', 'string', 'bytes', 'byte',
        'int', 'int8', 'int16', 'int32', 'int64', 'int128', 'int256',
        'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uint128', 'uint256',
        'bytes1', 'bytes2', 'bytes4', 'bytes8', 'bytes16', 'bytes32',
        'true', 'false', 'wei', 'gwei', 'ether', 'seconds', 'minutes',
        'hours', 'days', 'weeks', 'years', 'this', 'super', 'type'
    ]);

    // Token types
    static TOKEN_TYPES = {
        // Literals
        IDENTIFIER: 'IDENTIFIER',
        NUMBER: 'NUMBER',
        STRING: 'STRING',
        HEX_STRING: 'HEX_STRING',
        
        // Keywords
        KEYWORD: 'KEYWORD',
        
        // Operators
        PLUS: 'PLUS',
        MINUS: 'MINUS',
        STAR: 'STAR',
        SLASH: 'SLASH',
        PERCENT: 'PERCENT',
        POWER: 'POWER',
        AMPERSAND: 'AMPERSAND',
        PIPE: 'PIPE',
        CARET: 'CARET',
        TILDE: 'TILDE',
        LT: 'LT',
        GT: 'GT',
        LTE: 'LTE',
        GTE: 'GTE',
        EQ: 'EQ',
        NEQ: 'NEQ',
        AND: 'AND',
        OR: 'OR',
        NOT: 'NOT',
        ASSIGN: 'ASSIGN',
        PLUS_ASSIGN: 'PLUS_ASSIGN',
        MINUS_ASSIGN: 'MINUS_ASSIGN',
        STAR_ASSIGN: 'STAR_ASSIGN',
        SLASH_ASSIGN: 'SLASH_ASSIGN',
        INCREMENT: 'INCREMENT',
        DECREMENT: 'DECREMENT',
        LSHIFT: 'LSHIFT',
        RSHIFT: 'RSHIFT',
        ARROW: 'ARROW',
        QUESTION: 'QUESTION',
        COLON: 'COLON',
        
        // Delimiters
        LPAREN: 'LPAREN',
        RPAREN: 'RPAREN',
        LBRACE: 'LBRACE',
        RBRACE: 'RBRACE',
        LBRACKET: 'LBRACKET',
        RBRACKET: 'RBRACKET',
        SEMICOLON: 'SEMICOLON',
        COMMA: 'COMMA',
        DOT: 'DOT',
        
        // Special
        COMMENT: 'COMMENT',
        NATSPEC: 'NATSPEC',
        EOF: 'EOF'
    };

    /**
     * Main tokenization method
     * @returns {Array} Array of tokens
     * @throws {Error} If tokenization fails
     */
    tokenize() {
        try {
            while (!this.isAtEnd()) {
                this.skipWhitespace();
                if (this.isAtEnd()) break;

                const token = this.nextToken();
                if (token) {
                    this.tokens.push(token);
                } else {
                    // Unknown character - skip with warning
                    const char = this.peek();
                    if (char !== '\0') {
                        this.advance(); // Skip unknown character
                    }
                }
            }

            this.tokens.push(this.makeToken(Lexer.TOKEN_TYPES.EOF, ''));
            return this.tokens;
        } catch (error) {
            throw new Error(`Tokenization error at line ${this.line}, column ${this.column}: ${error.message}`);
        }
    }

    /**
     * Get the next token from the source
     */
    nextToken() {
        const char = this.peek();

        // Comments
        if (char === '/' && (this.peekNext() === '/' || this.peekNext() === '*')) {
            return this.readComment();
        }

        // Strings
        if (char === '"' || char === "'") {
            return this.readString(char);
        }

        // Hex strings
        if (char === 'h' && this.source.substring(this.pos, this.pos + 4) === 'hex"') {
            return this.readHexString();
        }

        // Numbers
        if (this.isDigit(char) || (char === '.' && this.isDigit(this.peekNext()))) {
            return this.readNumber();
        }

        // Identifiers and keywords
        if (this.isAlpha(char) || char === '_' || char === '$') {
            return this.readIdentifier();
        }

        // Operators and delimiters
        return this.readOperator();
    }

    /**
     * Read a comment (single-line or multi-line)
     */
    readComment() {
        const startLine = this.line;
        const startColumn = this.column;
        let value = '';

        if (this.peekNext() === '/') {
            // Single-line comment
            this.advance(); // /
            this.advance(); // /
            
            // Check for NatSpec
            const isNatSpec = this.peek() === '/' || this.peek() === '!';
            
            while (!this.isAtEnd() && this.peek() !== '\n') {
                value += this.advance();
            }

            return {
                type: isNatSpec ? Lexer.TOKEN_TYPES.NATSPEC : Lexer.TOKEN_TYPES.COMMENT,
                value: value.trim(),
                line: startLine,
                column: startColumn,
                isMultiline: false
            };
        } else {
            // Multi-line comment
            this.advance(); // /
            this.advance(); // *
            
            // Check for NatSpec
            const isNatSpec = this.peek() === '*' || this.peek() === '!';
            
            while (!this.isAtEnd()) {
                if (this.peek() === '*' && this.peekNext() === '/') {
                    this.advance(); // *
                    this.advance(); // /
                    break;
                }
                value += this.advance();
            }

            return {
                type: isNatSpec ? Lexer.TOKEN_TYPES.NATSPEC : Lexer.TOKEN_TYPES.COMMENT,
                value: value.trim(),
                line: startLine,
                column: startColumn,
                isMultiline: true
            };
        }
    }

    /**
     * Read a string literal
     */
    readString(quote) {
        const startLine = this.line;
        const startColumn = this.column;
        let value = '';

        this.advance(); // Opening quote

        while (!this.isAtEnd() && this.peek() !== quote) {
            if (this.peek() === '\\') {
                value += this.advance(); // backslash
                if (!this.isAtEnd()) {
                    value += this.advance(); // escaped char
                }
            } else {
                value += this.advance();
            }
        }

        if (!this.isAtEnd()) {
            this.advance(); // Closing quote
        }

        return {
            type: Lexer.TOKEN_TYPES.STRING,
            value,
            line: startLine,
            column: startColumn
        };
    }

    /**
     * Read a hex string (hex"...")
     */
    readHexString() {
        const startLine = this.line;
        const startColumn = this.column;
        
        this.advance(); // h
        this.advance(); // e
        this.advance(); // x
        this.advance(); // "
        
        let value = '';
        while (!this.isAtEnd() && this.peek() !== '"') {
            value += this.advance();
        }
        
        if (!this.isAtEnd()) {
            this.advance(); // Closing quote
        }

        return {
            type: Lexer.TOKEN_TYPES.HEX_STRING,
            value,
            line: startLine,
            column: startColumn
        };
    }

    /**
     * Read a number (decimal, hex, or scientific notation)
     */
    readNumber() {
        const startLine = this.line;
        const startColumn = this.column;
        let value = '';

        // Check for hex number
        if (this.peek() === '0' && (this.peekNext() === 'x' || this.peekNext() === 'X')) {
            value += this.advance(); // 0
            value += this.advance(); // x
            while (!this.isAtEnd() && this.isHexDigit(this.peek())) {
                value += this.advance();
            }
        } else {
            // Decimal or scientific notation
            while (!this.isAtEnd() && this.isDigit(this.peek())) {
                value += this.advance();
            }

            // Decimal part
            if (this.peek() === '.' && this.isDigit(this.peekNext())) {
                value += this.advance(); // .
                while (!this.isAtEnd() && this.isDigit(this.peek())) {
                    value += this.advance();
                }
            }

            // Exponent
            if (this.peek() === 'e' || this.peek() === 'E') {
                value += this.advance();
                if (this.peek() === '+' || this.peek() === '-') {
                    value += this.advance();
                }
                while (!this.isAtEnd() && this.isDigit(this.peek())) {
                    value += this.advance();
                }
            }
        }

        // Unit suffix (wei, gwei, ether, seconds, etc.)
        if (this.isAlpha(this.peek())) {
            let unit = '';
            while (!this.isAtEnd() && this.isAlphaNumeric(this.peek())) {
                unit += this.advance();
            }
            value += ' ' + unit;
        }

        return {
            type: Lexer.TOKEN_TYPES.NUMBER,
            value,
            line: startLine,
            column: startColumn
        };
    }

    /**
     * Read an identifier or keyword
     */
    readIdentifier() {
        const startLine = this.line;
        const startColumn = this.column;
        let value = '';

        while (!this.isAtEnd() && (this.isAlphaNumeric(this.peek()) || this.peek() === '_' || this.peek() === '$')) {
            value += this.advance();
        }

        const type = Lexer.KEYWORDS.has(value) 
            ? Lexer.TOKEN_TYPES.KEYWORD 
            : Lexer.TOKEN_TYPES.IDENTIFIER;

        return {
            type,
            value,
            line: startLine,
            column: startColumn
        };
    }

    /**
     * Read operators and delimiters
     */
    readOperator() {
        const startLine = this.line;
        const startColumn = this.column;
        const char = this.advance();

        const twoChar = char + this.peek();
        const threeChar = twoChar + (this.pos + 1 < this.source.length ? this.source[this.pos + 1] : '');

        // Three-character operators
        const threeCharOps = {
            '>>=': Lexer.TOKEN_TYPES.RSHIFT_ASSIGN,
            '<<=': Lexer.TOKEN_TYPES.LSHIFT_ASSIGN
        };

        if (threeCharOps[threeChar]) {
            this.advance();
            this.advance();
            return this.makeToken(threeCharOps[threeChar], threeChar, startLine, startColumn);
        }

        // Two-character operators
        const twoCharOps = {
            '++': Lexer.TOKEN_TYPES.INCREMENT,
            '--': Lexer.TOKEN_TYPES.DECREMENT,
            '**': Lexer.TOKEN_TYPES.POWER,
            '==': Lexer.TOKEN_TYPES.EQ,
            '!=': Lexer.TOKEN_TYPES.NEQ,
            '<=': Lexer.TOKEN_TYPES.LTE,
            '>=': Lexer.TOKEN_TYPES.GTE,
            '&&': Lexer.TOKEN_TYPES.AND,
            '||': Lexer.TOKEN_TYPES.OR,
            '<<': Lexer.TOKEN_TYPES.LSHIFT,
            '>>': Lexer.TOKEN_TYPES.RSHIFT,
            '+=': Lexer.TOKEN_TYPES.PLUS_ASSIGN,
            '-=': Lexer.TOKEN_TYPES.MINUS_ASSIGN,
            '*=': Lexer.TOKEN_TYPES.STAR_ASSIGN,
            '/=': Lexer.TOKEN_TYPES.SLASH_ASSIGN,
            '=>': Lexer.TOKEN_TYPES.ARROW
        };

        if (twoCharOps[twoChar]) {
            this.advance();
            return this.makeToken(twoCharOps[twoChar], twoChar, startLine, startColumn);
        }

        // Single-character operators
        const singleCharOps = {
            '+': Lexer.TOKEN_TYPES.PLUS,
            '-': Lexer.TOKEN_TYPES.MINUS,
            '*': Lexer.TOKEN_TYPES.STAR,
            '/': Lexer.TOKEN_TYPES.SLASH,
            '%': Lexer.TOKEN_TYPES.PERCENT,
            '&': Lexer.TOKEN_TYPES.AMPERSAND,
            '|': Lexer.TOKEN_TYPES.PIPE,
            '^': Lexer.TOKEN_TYPES.CARET,
            '~': Lexer.TOKEN_TYPES.TILDE,
            '<': Lexer.TOKEN_TYPES.LT,
            '>': Lexer.TOKEN_TYPES.GT,
            '!': Lexer.TOKEN_TYPES.NOT,
            '=': Lexer.TOKEN_TYPES.ASSIGN,
            '?': Lexer.TOKEN_TYPES.QUESTION,
            ':': Lexer.TOKEN_TYPES.COLON,
            '(': Lexer.TOKEN_TYPES.LPAREN,
            ')': Lexer.TOKEN_TYPES.RPAREN,
            '{': Lexer.TOKEN_TYPES.LBRACE,
            '}': Lexer.TOKEN_TYPES.RBRACE,
            '[': Lexer.TOKEN_TYPES.LBRACKET,
            ']': Lexer.TOKEN_TYPES.RBRACKET,
            ';': Lexer.TOKEN_TYPES.SEMICOLON,
            ',': Lexer.TOKEN_TYPES.COMMA,
            '.': Lexer.TOKEN_TYPES.DOT
        };

        if (singleCharOps[char]) {
            return this.makeToken(singleCharOps[char], char, startLine, startColumn);
        }

        // Unknown character
        return null;
    }

    // ========================================
    // HELPER METHODS
    // ========================================

    /**
     * Create a token object
     * @param {string} type - Token type
     * @param {string} value - Token value
     * @param {number} line - Line number
     * @param {number} column - Column number
     * @returns {Object} Token object
     */
    makeToken(type, value, line = this.line, column = this.column) {
        return { type, value, line, column };
    }

    /**
     * Peek at current character without advancing
     * @returns {string} Current character or null terminator
     */
    peek() {
        return this.isAtEnd() ? '\0' : this.source[this.pos];
    }

    /**
     * Peek at next character without advancing
     * @returns {string} Next character or null terminator
     */
    peekNext() {
        return this.pos + 1 >= this.source.length ? '\0' : this.source[this.pos + 1];
    }

    /**
     * Advance to next character
     * @returns {string} Current character
     */
    advance() {
        if (this.isAtEnd()) {
            return '\0';
        }
        const char = this.source[this.pos++];
        if (char === '\n') {
            this.line++;
            this.column = 1;
        } else {
            this.column++;
        }
        return char;
    }

    /**
     * Check if at end of source
     * @returns {boolean} True if at end
     */
    isAtEnd() {
        return this.pos >= this.source.length;
    }

    /**
     * Check if character is a digit
     * @param {string} char - Character to check
     * @returns {boolean} True if digit
     */
    isDigit(char) {
        return char >= '0' && char <= '9';
    }

    /**
     * Check if character is a hex digit
     * @param {string} char - Character to check
     * @returns {boolean} True if hex digit
     */
    isHexDigit(char) {
        return this.isDigit(char) || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F');
    }

    /**
     * Check if character is alphabetic
     * @param {string} char - Character to check
     * @returns {boolean} True if alphabetic
     */
    isAlpha(char) {
        return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');
    }

    /**
     * Check if character is alphanumeric
     * @param {string} char - Character to check
     * @returns {boolean} True if alphanumeric
     */
    isAlphaNumeric(char) {
        return this.isAlpha(char) || this.isDigit(char);
    }

    skipWhitespace() {
        while (!this.isAtEnd()) {
            const char = this.peek();
            if (char === ' ' || char === '\t' || char === '\r' || char === '\n') {
                this.advance();
            } else {
                break;
            }
        }
    }
}

module.exports = Lexer;
