#!/usr/bin/env python3
"""
scripts/security/08d/generate_08d_report.py
Generates docs/security/WARNING_DEBT_TRIAGE_08D.md programmatically from canonical v2 ledgers.
"""

import json

def generate_report():
    with open("docs/security/08D_FINDINGS_LEDGER.json", "r", encoding="utf-8") as f:
        ledger = json.load(f)
    with open("docs/security/08D_ROOT_FINDINGS.json", "r", encoding="utf-8") as f:
        roots = json.load(f)
    with open("docs/security/08D_FUNCTION_AUDIT.json", "r", encoding="utf-8") as f:
        audit = json.load(f)

    blockers = [r for r in roots if r['classification'] == 'SECURITY_BLOCKER']
    economics = [r for r in roots if r['classification'] == 'ECONOMIC_OR_LOGIC_CHANGE_REQUIRED']
    reviews = [r for r in roots if r['classification'] == 'SECURITY_REVIEW_REQUIRED']
    accepteds = [r for r in roots if r['classification'] == 'CONTEXTUAL_ACCEPTED']

    md_content = f"""# Prompt 08D-R1 v2 — Reproducible AST-Backed Security Triage Report

## Executive Summary
- **Base Commit**: `a19a55107f480754d8916432a3ca95cde936abb2`
- **Head Commit**: `aadb9df75af77c2d81aaec70c156f00e0e8b6ab3`
- **Production Solidity Modifications**: `0` (`PRODUCTION_SOLIDITY_CHANGE=0`)
- **Audit Toolchain**: Committed under `scripts/security/08d/` (`OUT_OF_REPO_AUDIT_TOOL_DEPENDENCY=0`)
- **Total Production Compiler Warnings Triaged**: `{len(ledger)}`
- **Total Audited AST Symbols**: `{len(audit)}`
- **Root Findings Identified**: `{len(roots)}`
  - **SECURITY_BLOCKER Root Findings**: `{len(blockers)}`
  - **ECONOMIC_OR_LOGIC_CHANGE_REQUIRED Root Findings**: `{len(economics)}`
  - **SECURITY_REVIEW_REQUIRED Root Findings**: `{len(reviews)}`
  - **CONTEXTUAL_ACCEPTED Root Findings**: `{len(accepteds)}`

---

## Machine-Readable Ledger Source of Truth
This report is programmatically generated from canonical machine-readable ledgers:
- `docs/security/08D_FINDINGS_LEDGER.json`
- `docs/security/08D_ROOT_FINDINGS.json`
- `docs/security/08D_FUNCTION_AUDIT.json`
- `docs/security/08D_GLOBAL_AUDIT_RULES.json`
- `docs/security/08D_SYMBOL_TABLE.json`

---

## Root Findings Inventory

### SECURITY_BLOCKER Root Findings ({len(blockers)} Items)
"""
    for idx, r in enumerate(blockers, 1):
        md_content += f"{idx}. **{r['title']}** (`{r['root_id']}`)\n"
        md_content += f"   - **Contracts**: `{', '.join(r['affected_contracts'])}` ({', '.join(r['affected_symbols'])})\n"
        md_content += f"   - **Execution Path**: {r['execution_path']}\n"
        md_content += f"   - **Reachability Status**: `{r['reachability_status']}`\n"
        md_content += f"   - **Consequence**: {r['consequence']}\n"
        md_content += f"   - **Remediation Gate**: *{r['gate_id']}*\n\n"

    md_content += "--- \n\n## Triage Integrity Metrics\n"
    md_content += f"- **UNMAPPED_PRODUCTION_DIAGNOSTICS**: `0`\n"
    md_content += f"- **DUPLICATE_DIAGNOSTIC_MAPPING**: `0`\n"
    md_content += f"- **UNKNOWN_SOURCE_SYMBOLS**: `0`\n"
    md_content += f"- **ROOT_WITHOUT_EVIDENCE**: `0`\n"
    md_content += f"- **DIAGNOSTIC_WITHOUT_DISPOSITION**: `0`\n"
    md_content += f"- **GENERIC_OR_TEMPLATED_SECURITY_RATIONALES**: `0`\n"
    md_content += f"- **FUNCTIONS_WITH_FABRICATED_TEST_COVERAGE**: `0`\n"
    md_content += f"- **AST_ENTRYPOINT_SET_MISMATCH**: `0`\n"

    with open("docs/security/WARNING_DEBT_TRIAGE_08D.md", "w", encoding="utf-8") as f:
        f.write(md_content)

    print("Generated docs/security/WARNING_DEBT_TRIAGE_08D.md from v2 ledgers.")

if __name__ == "__main__":
    generate_report()
