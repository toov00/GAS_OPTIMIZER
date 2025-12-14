/**
 * Gas Optimization Report Generator
 * 
 * Generates human-readable or JSON reports from analysis findings.
 */

class Reporter {
    constructor(findings, options = {}) {
        this.findings = findings;
        this.filename = options.filename || 'Contract.sol';
        this.minSeverity = options.minSeverity || 'low';
        this.format = options.format || 'text';
        
        // Severity ordering
        this.severityOrder = { 'high': 3, 'medium': 2, 'low': 1, 'info': 0 };
    }

    /**
     * Generate the report
     */
    generate() {
        // Filter by minimum severity
        const filtered = this.filterBySeverity(this.findings);
        
        // Sort by severity (high first)
        const sorted = this.sortBySeverity(filtered);

        if (this.format === 'json') {
            return this.generateJSON(sorted);
        }
        return this.generateText(sorted);
    }

    /**
     * Filter findings by minimum severity
     */
    filterBySeverity(findings) {
        const minLevel = this.severityOrder[this.minSeverity] || 0;
        return findings.filter(f => 
            (this.severityOrder[f.severity] || 0) >= minLevel
        );
    }

    /**
     * Sort findings by severity
     */
    sortBySeverity(findings) {
        return [...findings].sort((a, b) => {
            const aLevel = this.severityOrder[a.severity] || 0;
            const bLevel = this.severityOrder[b.severity] || 0;
            if (bLevel !== aLevel) return bLevel - aLevel;
            return (a.line || 0) - (b.line || 0);
        });
    }

    /**
     * Generate JSON report
     */
    generateJSON(findings) {
        const report = {
            filename: this.filename,
            timestamp: new Date().toISOString(),
            summary: this.generateSummary(findings),
            findings: findings.map(f => ({
                ...f,
                id: `${f.rule}-${f.line || 0}`
            }))
        };
        return JSON.stringify(report, null, 2);
    }

    /**
     * Generate text report
     */
    generateText(findings) {
        const lines = [];
        const width = 70;

        // Header
        lines.push('');
        lines.push('═'.repeat(width));
        lines.push(this.center('GAS OPTIMIZATION REPORT', width));
        lines.push('═'.repeat(width));
        lines.push('');

        // File info
        lines.push(`  Contract: ${this.filename}`);
        lines.push(`  Analysis Date: ${new Date().toLocaleDateString()}`);
        lines.push('');

        // Summary
        const summary = this.generateSummary(findings);
        lines.push('FINDINGS SUMMARY');
        lines.push('─'.repeat(width));
        lines.push(`  High:   ${summary.high} findings`);
        lines.push(`  Medium: ${summary.medium} findings`);
        lines.push(`  Low:    ${summary.low} findings`);
        lines.push(`  Info:   ${summary.info} findings`);
        lines.push('');
        lines.push(`ESTIMATED SAVINGS: ${this.estimateTotalSavings(findings)}`);
        lines.push('');

        if (findings.length === 0) {
            lines.push('─'.repeat(width));
            lines.push('');
            lines.push('  No gas optimization issues found!');
            lines.push('');
            lines.push('═'.repeat(width));
            return lines.join('\n');
        }

        // Detailed findings
        lines.push('DETAILED FINDINGS');
        lines.push('─'.repeat(width));
        lines.push('');

        let highCount = 0, medCount = 0, lowCount = 0, infoCount = 0;

        for (const finding of findings) {
            let id;
            switch (finding.severity) {
                case 'high':
                    id = `H-${String(++highCount).padStart(2, '0')}`;
                    break;
                case 'medium':
                    id = `M-${String(++medCount).padStart(2, '0')}`;
                    break;
                case 'low':
                    id = `L-${String(++lowCount).padStart(2, '0')}`;
                    break;
                default:
                    id = `I-${String(++infoCount).padStart(2, '0')}`;
            }
            
            lines.push(`[${id}] ${finding.rule}`);
            lines.push(`   ${finding.message}`);
            
            if (finding.line) {
                const location = finding.function 
                    ? `Line ${finding.line}, in ${finding.function}()`
                    : `Line ${finding.line}`;
                lines.push(`   Location: ${location}`);
            }
            
            if (finding.description) {
                lines.push(`   ${finding.description}`);
            }
            
            if (finding.gasSavings) {
                lines.push(`   Savings: ${finding.gasSavings}`);
            }

            if (finding.before || finding.after) {
                lines.push('');
                if (finding.before) {
                    lines.push('   Before:');
                    finding.before.split('\n').forEach(l => 
                        lines.push(`     ${l}`)
                    );
                }
                if (finding.after) {
                    lines.push('   After:');
                    finding.after.split('\n').forEach(l => 
                        lines.push(`     ${l}`)
                    );
                }
            }

            lines.push('');
            lines.push('   ' + '·'.repeat(width - 3));
            lines.push('');
        }

        // Footer
        lines.push('═'.repeat(width));
        lines.push('');
        lines.push('Legend:');
        lines.push('  HIGH   - Critical optimizations (>1000 gas savings)');
        lines.push('  MEDIUM - Significant improvements (100-1000 gas)');
        lines.push('  LOW    - Minor optimizations (<100 gas)');
        lines.push('  INFO   - Best practices and suggestions');
        lines.push('');

        return lines.join('\n');
    }

    /**
     * Generate summary statistics
     */
    generateSummary(findings) {
        const summary = { high: 0, medium: 0, low: 0, info: 0, total: findings.length };
        for (const f of findings) {
            if (summary.hasOwnProperty(f.severity)) {
                summary[f.severity]++;
            }
        }
        return summary;
    }

    /**
     * Estimate total gas savings
     */
    estimateTotalSavings(findings) {
        let deployment = 0;
        let perTx = 0;

        for (const f of findings) {
            // Parse gas savings strings (rough estimates)
            const savings = f.gasSavings || '';
            
            if (savings.includes('deployment')) {
                const match = savings.match(/~?(\d+)/);
                if (match) deployment += parseInt(match[1]);
            }
            
            if (savings.includes('per') || savings.includes('iteration') || !savings.includes('deployment')) {
                const match = savings.match(/~?(\d+)/);
                if (match) perTx += parseInt(match[1]);
            }
        }

        const parts = [];
        if (deployment > 0) parts.push(`~${deployment.toLocaleString()} gas (deployment)`);
        if (perTx > 0) parts.push(`~${perTx.toLocaleString()} gas (per tx)`);

        return parts.length > 0 ? parts.join(' + ') : 'Varies';
    }

    /**
     * Center text
     */
    center(text, width) {
        const padding = Math.max(0, Math.floor((width - text.length) / 2));
        return ' '.repeat(padding) + text;
    }
}

module.exports = Reporter;
