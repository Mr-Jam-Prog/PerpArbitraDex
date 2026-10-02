#!/usr/bin/env python3
"""
scripts/security/08d/validate_08d_ledgers.py
Triage integrity validator enforcing AST entrypoint set-equality, AST symbol resolution,
generic test coverage validation, non-templated rationales, split disposition schema checks,
machine-resolvable root evidence, resolving safety evidence refs, and exact count invariants.
Computes every declared check deterministically via VALIDATION_CHECKS registry.
"""

import os
import json
import sys
import hashlib

DECLARED_CHECKS = [
    "UNMAPPED_PRODUCTION_DIAGNOSTICS",
    "DUPLICATE_DIAGNOSTIC_MAPPING",
    "MULTIMAPPED_PRODUCTION_DIAGNOSTICS",
    "UNKNOWN_SOURCE_SYMBOLS",
    "ROOT_WITHOUT_EVIDENCE",
    "ROOT_WITHOUT_MACHINE_EVIDENCE",
    "ROOT_DIAGNOSTIC_IDS_UNKNOWN",
    "ROOT_SEMANTIC_EVIDENCE_UNRESOLVED",
    "DIAGNOSTIC_WITHOUT_DISPOSITION",
    "DIAGNOSTIC_WITHOUT_ID",
    "DIAGNOSTIC_WITHOUT_CLASSIFICATION",
    "DIAGNOSTIC_WITHOUT_ROOT_OR_STANDALONE_DISPOSITION",
    "DIAGNOSTIC_WITHOUT_RATIONALE",
    "DIAGNOSTIC_WITHOUT_REQUIRED_GATE",
    "DIAGNOSTIC_WITHOUT_REVIEW_STATUS",
    "BLOCKER_DETAIL_WITHOUT_BLOCKER_ROOT",
    "ECONOMIC_DETAIL_WITHOUT_ECONOMIC_ROOT",
    "ROOT_DETAIL_CLASSIFICATION_MISMATCH",
    "ROOT_DETAIL_GATE_MISMATCH",
    "GENERIC_OR_TEMPLATED_SECURITY_RATIONALES",
    "UNSUPPORTED_SAFETY_ASSERTIONS",
    "SAFETY_EVIDENCE_REFS_UNRESOLVED",
    "FUNCTIONS_WITH_FABRICATED_TEST_COVERAGE",
    "TEST_EVIDENCE_WITHOUT_PROOF",
    "EXACT_TEST_REFERENCE_WITHOUT_RESOLVABLE_PROOF",
    "AST_ENTRYPOINT_SET_MISMATCH",
    "INTERNAL_FUNCTION_SET_MISMATCH",
    "UNKNOWN_BLOCKED_BY_ROOT_IDS",
    "UNCLASSIFIED_AUTH_MODIFIERS",
    "VALIDATOR_UNIMPLEMENTED_CHECKS"
]

def make_diagnostic_id(file_path, line, col, msg):
    raw = f"{file_path}:{line}:{col}:{msg}"
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()

def check_unmapped_production_diagnostics(prod_baseline, ledger):
    baseline_ids = set(make_diagnostic_id(w['file'], w['line'], w['column'], w['message']) for w in prod_baseline)
    ledger_ids = set(item.get("diagnostic_id") for item in ledger if item.get("diagnostic_id"))
    diff = baseline_ids.symmetric_difference(ledger_ids)
    return len(diff)

def check_duplicate_and_multimapped(ledger):
    seen_dids = {}
    for item in ledger:
        did = item.get("diagnostic_id")
        if did:
            seen_dids[did] = seen_dids.get(did, 0) + 1
    duplicates = sum(1 for c in seen_dids.values() if c == 2)
    multimapped = sum(c - 1 for c in seen_dids.values() if c > 2)
    return duplicates, multimapped

def check_unknown_symbols_and_blocked_roots(roots, symbol_table, ledger):
    ast_all_sigs = set(s["canonical_signature"] for s in symbol_table)
    all_root_ids = set(r["root_id"] for r in roots)
    ledger_dids = set(item.get("diagnostic_id") for item in ledger)

    unknown_syms = 0
    unknown_blocked = 0
    unknown_root_dids = 0
    unresolved_semantic_ev = 0
    roots_without_machine_ev = 0

    for r in roots:
        for aff_sym in r.get("affected_symbols", []):
            if aff_sym not in ast_all_sigs:
                unknown_syms += 1
        for blocked_id in r.get("blocked_by_root_ids", []):
            if blocked_id not in all_root_ids:
                unknown_blocked += 1

        r_dids = r.get("diagnostic_ids", [])
        for r_did in r_dids:
            if r_did not in ledger_dids:
                unknown_root_dids += 1

        sem_ev = r.get("semantic_evidence", [])
        for ev in sem_ev:
            if ev.get("canonical_signature") and ev.get("canonical_signature") not in ast_all_sigs:
                unresolved_semantic_ev += 1

        if not r_dids and not sem_ev:
            roots_without_machine_ev += 1

    return unknown_syms, unknown_blocked, unknown_root_dids, unresolved_semantic_ev, roots_without_machine_ev

def check_disposition_schema_splits(ledger, roots):
    root_dict = {r["root_id"]: r for r in roots}
    all_root_ids = set(r["root_id"] for r in roots)

    missing_id = 0
    missing_classification = 0
    missing_root_or_disp = 0
    missing_rationale = 0
    missing_gate = 0
    missing_review_status = 0

    blocker_mismatch = 0
    economic_mismatch = 0
    class_mismatch = 0
    gate_mismatch = 0
    templated_rat = 0
    unsupported_assertions = 0
    unresolved_safety_refs = 0

    for item in ledger:
        did = item.get("diagnostic_id")
        if not did:
            missing_id += 1

        classification = item.get("classification")
        if not classification:
            missing_classification += 1

        root_id = item.get("root_id")
        if not root_id:
            missing_root_or_disp += 1

        rat = item.get("code_specific_rationale")
        if not rat:
            missing_rationale += 1
        elif "required for baseline gate" in rat.lower() or "generic" in rat.lower() or "represents tolerated compiler warning debt (" in rat.lower() or len(rat) < 25:
            templated_rat += 1

        # UNSUPPORTED_SAFETY_ASSERTIONS and SAFETY_EVIDENCE_REFS_UNRESOLVED
        claims = item.get("safety_claims", [])
        refs = item.get("evidence_refs", [])

        if rat and any(unsupported in rat for unsupported in ["protected by nonReentrant", "mandated by interface", "bounded by prior validation"]):
            if not claims or not refs:
                unsupported_assertions += 1

        for ref in refs:
            if ref.startswith("ROOT_FINDING:"):
                r_target = ref.split("ROOT_FINDING:")[1]
                if r_target not in all_root_ids:
                    unresolved_safety_refs += 1
            elif ref.startswith("WARNING_BASELINE:"):
                b_did = ref.split("WARNING_BASELINE:")[1]
                if b_did != did:
                    unresolved_safety_refs += 1
            else:
                unresolved_safety_refs += 1

        gate_id = item.get("gate_id")
        if not gate_id:
            missing_gate += 1

        review_status = item.get("review_status")
        if not review_status:
            missing_review_status += 1

        if root_id and root_id in root_dict:
            r_obj = root_dict[root_id]
            if classification != r_obj.get("classification"):
                class_mismatch += 1
                if classification == "SECURITY_BLOCKER":
                    blocker_mismatch += 1
                elif classification == "ECONOMIC_OR_LOGIC_CHANGE_REQUIRED":
                    economic_mismatch += 1

            if gate_id != r_obj.get("gate_id"):
                gate_mismatch += 1

    diag_without_disp = missing_id + missing_classification + missing_root_or_disp + missing_rationale + missing_gate + missing_review_status

    return (diag_without_disp, missing_id, missing_classification, missing_root_or_disp,
            missing_rationale, missing_gate, missing_review_status, blocker_mismatch,
            economic_mismatch, class_mismatch, gate_mismatch, templated_rat, unsupported_assertions, unresolved_safety_refs)

def check_fabricated_coverage_and_proofs(audit):
    fabricated = 0
    proofless = 0
    unresolvable_exact_refs = 0

    for a in audit:
        cov = a.get("test_coverage")
        proof_obj = a.get("test_evidence_object")

        if cov != "NO_TEST_EVIDENCE" and not proof_obj:
            proofless += 1

        if cov == "STATIC_REFERENCE_EXACT_CONTRACT_FUNCTION":
            if not proof_obj or not proof_obj.get("test_file") or not os.path.exists(proof_obj.get("test_file")):
                unresolvable_exact_refs += 1

        if cov == "COVERED_IN_UNIT_OR_FUZZ" and a.get("reachability") == "UNREACHABLE":
            fabricated += 1

    return fabricated, proofless, unresolvable_exact_refs

def check_entrypoint_and_internal_sets(symbol_table, audit):
    ast_concrete_sigs = set(
        s["canonical_signature"] for s in symbol_table
        if s["implemented"] and ((s["contract_kind"] != "interface" and not s["is_abstract"] and s["visibility"] in ["external", "public"]) or s["kind"] in ["receive", "fallback"])
    )
    audit_concrete_sigs = set(
        a["canonical_signature"] for a in audit
        if a["visibility"] in ["external", "public"] or a["kind"] in ["receive", "fallback"]
    )

    ast_internal_sigs = set(
        s["canonical_signature"] for s in symbol_table
        if s["implemented"] and s["visibility"] in ["internal", "private"]
    )
    audit_internal_sigs = set(
        a["canonical_signature"] for a in audit
        if a["visibility"] in ["internal", "private"]
    )

    concrete_mismatch = len(ast_concrete_sigs.symmetric_difference(audit_concrete_sigs))
    internal_mismatch = len(ast_internal_sigs.symmetric_difference(audit_internal_sigs))

    return concrete_mismatch, internal_mismatch

def check_unclassified_modifiers(audit):
    unclassified = 0
    for a in audit:
        if a.get("unclassified_modifiers"):
            unclassified += len(a["unclassified_modifiers"])
    return unclassified

VALIDATION_CHECKS = {
    "UNMAPPED_PRODUCTION_DIAGNOSTICS": lambda p, l, r, a, s: check_unmapped_production_diagnostics(p, l),
    "DUPLICATE_DIAGNOSTIC_MAPPING": lambda p, l, r, a, s: check_duplicate_and_multimapped(l)[0],
    "MULTIMAPPED_PRODUCTION_DIAGNOSTICS": lambda p, l, r, a, s: check_duplicate_and_multimapped(l)[1],
    "UNKNOWN_SOURCE_SYMBOLS": lambda p, l, r, a, s: check_unknown_symbols_and_blocked_roots(r, s, l)[0],
    "UNKNOWN_BLOCKED_BY_ROOT_IDS": lambda p, l, r, a, s: check_unknown_symbols_and_blocked_roots(r, s, l)[1],
    "ROOT_WITHOUT_EVIDENCE": lambda p, l, r, a, s: check_unknown_symbols_and_blocked_roots(r, s, l)[4],
    "ROOT_WITHOUT_MACHINE_EVIDENCE": lambda p, l, r, a, s: check_unknown_symbols_and_blocked_roots(r, s, l)[4],
    "ROOT_DIAGNOSTIC_IDS_UNKNOWN": lambda p, l, r, a, s: check_unknown_symbols_and_blocked_roots(r, s, l)[2],
    "ROOT_SEMANTIC_EVIDENCE_UNRESOLVED": lambda p, l, r, a, s: check_unknown_symbols_and_blocked_roots(r, s, l)[3],
    "DIAGNOSTIC_WITHOUT_DISPOSITION": lambda p, l, r, a, s: check_disposition_schema_splits(l, r)[0],
    "DIAGNOSTIC_WITHOUT_ID": lambda p, l, r, a, s: check_disposition_schema_splits(l, r)[1],
    "DIAGNOSTIC_WITHOUT_CLASSIFICATION": lambda p, l, r, a, s: check_disposition_schema_splits(l, r)[2],
    "DIAGNOSTIC_WITHOUT_ROOT_OR_STANDALONE_DISPOSITION": lambda p, l, r, a, s: check_disposition_schema_splits(l, r)[3],
    "DIAGNOSTIC_WITHOUT_RATIONALE": lambda p, l, r, a, s: check_disposition_schema_splits(l, r)[4],
    "DIAGNOSTIC_WITHOUT_REQUIRED_GATE": lambda p, l, r, a, s: check_disposition_schema_splits(l, r)[5],
    "DIAGNOSTIC_WITHOUT_REVIEW_STATUS": lambda p, l, r, a, s: check_disposition_schema_splits(l, r)[6],
    "BLOCKER_DETAIL_WITHOUT_BLOCKER_ROOT": lambda p, l, r, a, s: check_disposition_schema_splits(l, r)[7],
    "ECONOMIC_DETAIL_WITHOUT_ECONOMIC_ROOT": lambda p, l, r, a, s: check_disposition_schema_splits(l, r)[8],
    "ROOT_DETAIL_CLASSIFICATION_MISMATCH": lambda p, l, r, a, s: check_disposition_schema_splits(l, r)[9],
    "ROOT_DETAIL_GATE_MISMATCH": lambda p, l, r, a, s: check_disposition_schema_splits(l, r)[10],
    "GENERIC_OR_TEMPLATED_SECURITY_RATIONALES": lambda p, l, r, a, s: check_disposition_schema_splits(l, r)[11],
    "UNSUPPORTED_SAFETY_ASSERTIONS": lambda p, l, r, a, s: check_disposition_schema_splits(l, r)[12],
    "SAFETY_EVIDENCE_REFS_UNRESOLVED": lambda p, l, r, a, s: check_disposition_schema_splits(l, r)[13],
    "FUNCTIONS_WITH_FABRICATED_TEST_COVERAGE": lambda p, l, r, a, s: check_fabricated_coverage_and_proofs(a)[0],
    "TEST_EVIDENCE_WITHOUT_PROOF": lambda p, l, r, a, s: check_fabricated_coverage_and_proofs(a)[1],
    "EXACT_TEST_REFERENCE_WITHOUT_RESOLVABLE_PROOF": lambda p, l, r, a, s: check_fabricated_coverage_and_proofs(a)[2],
    "AST_ENTRYPOINT_SET_MISMATCH": lambda p, l, r, a, s: check_entrypoint_and_internal_sets(s, a)[0],
    "INTERNAL_FUNCTION_SET_MISMATCH": lambda p, l, r, a, s: check_entrypoint_and_internal_sets(s, a)[1],
    "UNCLASSIFIED_AUTH_MODIFIERS": lambda p, l, r, a, s: check_unclassified_modifiers(a),
    "VALIDATOR_UNIMPLEMENTED_CHECKS": lambda p, l, r, a, s: len(set(DECLARED_CHECKS) - set(VALIDATION_CHECKS.keys()))
}

def validate_ledgers(baseline_path="warnings-baseline.json",
                     ledger_path="docs/security/08D_FINDINGS_LEDGER.json",
                     root_path="docs/security/08D_ROOT_FINDINGS.json",
                     audit_path="docs/security/08D_FUNCTION_AUDIT.json",
                     symbol_table_path="docs/security/08D_SYMBOL_TABLE.json"):

    with open(baseline_path, "r", encoding="utf-8") as f:
        baseline = json.load(f)
    with open(ledger_path, "r", encoding="utf-8") as f:
        ledger = json.load(f)
    with open(root_path, "r", encoding="utf-8") as f:
        roots = json.load(f)
    with open(audit_path, "r", encoding="utf-8") as f:
        audit = json.load(f)
    with open(symbol_table_path, "r", encoding="utf-8") as f:
        symbol_table = json.load(f)

    prod_baseline = [w for w in baseline if w['file'].startswith('contracts/') and not w['file'].startswith('contracts/test/')]

    errors = {}
    for check_name in DECLARED_CHECKS:
        if check_name in VALIDATION_CHECKS:
            errors[check_name] = VALIDATION_CHECKS[check_name](prod_baseline, ledger, roots, audit, symbol_table)
        else:
            errors[check_name] = 1

    total_errors = sum(errors.values())
    print("=== AST-Backed Triage Integrity Validator Report ===")
    print(json.dumps(errors, indent=2))
    print(f"Total Validation Errors: {total_errors}")

    if total_errors > 0:
        print("❌ Validation FAILED.")
        sys.exit(1)

    print("✅ Validation PASSED with 0 errors.")

if __name__ == "__main__":
    validate_ledgers()
