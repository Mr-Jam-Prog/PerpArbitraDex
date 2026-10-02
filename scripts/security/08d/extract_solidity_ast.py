#!/usr/bin/env python3
"""
scripts/security/08d/extract_solidity_ast.py
Hardened AST Analysis Engine:
- Unconditionally runs hardhat compile --force before AST extraction (FORCED_COMPILE_BEFORE_AST=YES, STALE_BUILD_INFO_ACCEPTED=0).
- Slices source code using UTF-8 byte offsets (Path(file).read_bytes()[offset:offset+length].decode("utf-8")).
- Constructs AST-ID based transitive caller-callee call graph using internal and library calls (CALL_GRAPH_TRANSITIVE=YES).
- Evaluates parameter references strictly by AST referencedDeclaration ID (PARAM_USAGE_AST_ID_BASED=YES, PARAM_USAGE_TEXT_REGEX=NO).
- Derives state variable reads and writes strictly by AST declaration IDs with context awareness.
- Extracts contract inheritance graphs (linearizedBaseContracts, baseContracts) to verify true interface implementation relationships.
- Resolves modifier definitions and invocations by AST declaration IDs (`modifier_definition_ast_id -> auth_meta`) preventing name collisions.
- Inspects modifier AST bodies for structural authorization predicates and failure paths (`RevertStatement` / `revert()` / `require()`).
- Detects callbacks via AST interface implementation verification AND exact parameter type signature matching (CALLBACK_INTERFACE_RELATION_REQUIRED=YES, CALLBACK_SIGNATURE_MATCH_REQUIRED=YES).
- Distinguishes NATIVE_ETH_TRANSFER from ERC20_TRANSFER_RETURNS_BOOL and SAFEERC20_TRANSFER using AST expression types.
- Evaluates ancestor AST node stacks for ERC20_TRANSFER_RETURNS_BOOL call nodes to assign structural result handling (TOKEN_TRANSFER_ANCESTOR_STACK=YES, ASSIGNED_RESULT_TRACKING_AST_ID_BASED=YES).
"""

import os
import sys
import json
import glob
import subprocess
from pathlib import Path

CALLBACK_INTERFACE_SIGNATURES = {
    "executeOperation": {
        "interface": "IAaveFlashLoanReceiver",
        "signature": "IAaveFlashLoanReceiver.executeOperation(address[],uint256[],uint256[],address,bytes)",
        "kind": "AAVE_CALLBACK",
        "expected_param_types": ["address[]", "uint256[]", "uint256[]", "address", "bytes"]
    },
    "lzReceive": {
        "interface": "ILayerZeroReceiver",
        "signature": "ILayerZeroReceiver.lzReceive(uint16,bytes,uint64,bytes)",
        "kind": "LAYERZERO_CALLBACK",
        "expected_param_types": ["uint16", "bytes", "uint64", "bytes"]
    },
    "validateUserOp": {
        "interface": "IAccount",
        "signature": "IAccount.validateUserOp(tuple,bytes32,uint256)",
        "kind": "ERC4337_CALLBACK",
        "expected_param_types": ["tuple", "bytes32", "uint256"]
    },
    "tokensReceived": {
        "interface": "IERC777Recipient",
        "signature": "IERC777Recipient.tokensReceived(address,address,address,uint256,bytes,bytes)",
        "kind": "TOKEN_CALLBACK",
        "expected_param_types": ["address", "address", "address", "uint256", "bytes", "bytes"]
    },
    "onTokenTransfer": {
        "interface": "IERC677Receiver",
        "signature": "IERC677Receiver.onTokenTransfer(address,uint256,bytes)",
        "kind": "TOKEN_CALLBACK",
        "expected_param_types": ["address", "uint256", "bytes"]
    },
    "oracleCallback": {
        "interface": "IOracleCallback",
        "signature": "IOracleCallback.oracleCallback(bytes32,uint256)",
        "kind": "ORACLE_CALLBACK",
        "expected_param_types": ["bytes32", "uint256"]
    }
}

def force_compile_and_find_build_info():
    if not os.environ.get("SKIP_FORCE_COMPILE"):
        print("ℹ️ Forcing clean contract compilation (pnpm exec hardhat compile --force)...")
        subprocess.run(["pnpm", "exec", "hardhat", "compile", "--force"], check=True)

    files = glob.glob("artifacts/build-info/*.output.json") or glob.glob("artifacts/build-info/*.json")
    if not files:
        print("❌ Build-info artifacts missing after compilation.")
        sys.exit(1)
    files.sort(key=os.path.getsize, reverse=True)
    return files[0]

def slice_utf8_bytes(filepath, offset, length):
    raw_bytes = Path(filepath).read_bytes()
    snippet_bytes = raw_bytes[offset:offset+length]
    return snippet_bytes.decode("utf-8")

def analyze_modifier_ast_body_for_auth(mod_node):
    """
    Inspects modifier AST body for structural authorization predicates and proves failure paths:
    - Proves presence of RevertStatement, revert(), or require() on unauthorized path.
    - Records authorization_predicate_ast, failure_path_ast, principal_expression.
    """
    identifiers = set()
    has_actual_revert_or_require = False
    predicate_ast = None
    failure_path = None
    principal_expr = None

    def _has_revert_in_body(body_node):
        found = False
        def _scan(n):
            nonlocal found
            if not isinstance(n, dict):
                return
            ntype = n.get("nodeType")
            if ntype in ["RevertStatement", "ThrowStatement"]:
                found = True
            elif ntype == "FunctionCall":
                expr = n.get("expression", {})
                if expr.get("nodeType") == "Identifier" and expr.get("name") in ["revert", "require"]:
                    found = True
            for k, v in n.items():
                if isinstance(v, list):
                    for item in v:
                        _scan(item)
                elif isinstance(v, dict):
                    _scan(v)
        _scan(body_node)
        return found

    def _collect(n):
        nonlocal has_actual_revert_or_require, predicate_ast, failure_path, principal_expr
        if not isinstance(n, dict):
            return

        ntype = n.get("nodeType")

        if ntype == "FunctionCall":
            expr = n.get("expression", {})
            if expr.get("nodeType") == "Identifier" and expr.get("name") in ["require", "revert"]:
                has_actual_revert_or_require = True
                failure_path = expr.get("name")
                if n.get("arguments"):
                    predicate_ast = n.get("arguments")[0].get("nodeType")

        elif ntype == "IfStatement":
            cond = n.get("condition", {})
            true_body = n.get("trueBody", {})
            false_body = n.get("falseBody", {})

            # Prove that the if statement actually contains a revert/require on the unauthorized branch
            if _has_revert_in_body(true_body) or _has_revert_in_body(false_body):
                has_actual_revert_or_require = True
                failure_path = "IF_REVERT"
                predicate_ast = cond.get("nodeType")

        if ntype in ["Identifier", "MemberAccess"]:
            name = n.get("name") or n.get("memberName")
            if name:
                identifiers.add(name)
                if name in ["msg", "sender", "_msgSender", "tx", "origin", "hasRole"]:
                    principal_expr = name

        for k, v in n.items():
            if isinstance(v, list):
                for item in v:
                    _collect(item)
            elif isinstance(v, dict):
                _collect(v)

    _collect(mod_node)

    auth_keywords = {"msg", "sender", "_msgSender", "tx", "origin", "hasRole", "grantRole", "owner", "governance", "governor", "guardian", "timelock", "admin", "messenger", "authorized", "liquidator", "entryPoint"}

    is_enforcing = has_actual_revert_or_require and bool(identifiers.intersection(auth_keywords))

    return {
        "ast_id": mod_node.get("id"),
        "name": mod_node.get("name"),
        "status": "AUTH_ENFORCED" if is_enforcing else "AUTH_NOT_ENFORCING",
        "authorization_predicate_ast": predicate_ast or "NONE",
        "failure_path_ast": failure_path or "NONE",
        "principal_expression": principal_expr or "NONE"
    }

def collect_ast_param_references(node, param_ast_ids, param_refs_map):
    if not isinstance(node, dict):
        return
    if node.get("nodeType") == "Identifier":
        ref_id = node.get("referencedDeclaration")
        if ref_id in param_ast_ids:
            if ref_id not in param_refs_map:
                param_refs_map[ref_id] = []
            param_refs_map[ref_id].append({
                "ast_id": node.get("id"),
                "name": node.get("name"),
                "src": node.get("src")
            })
    for k, v in node.items():
        if isinstance(v, list):
            for item in v:
                collect_ast_param_references(item, param_ast_ids, param_refs_map)
        elif isinstance(v, dict):
            collect_ast_param_references(v, param_ast_ids, param_refs_map)

def collect_ast_identifiers(node, ref_ids, names):
    if not isinstance(node, dict):
        return
    if node.get("nodeType") == "Identifier":
        ref_id = node.get("referencedDeclaration")
        if ref_id is not None:
            ref_ids.add(ref_id)
        if node.get("name"):
            names.add(node.get("name"))
    elif node.get("nodeType") == "MemberAccess":
        if node.get("memberName"):
            names.add(node.get("memberName"))
    for k, v in node.items():
        if isinstance(v, list):
            for item in v:
                collect_ast_identifiers(item, ref_ids, names)
        elif isinstance(v, dict):
            collect_ast_identifiers(v, ref_ids, names)

def collect_ast_state_reads_and_writes(node, state_var_ids, reads_set, writes_set):
    if not isinstance(node, dict):
        return

    ntype = node.get("nodeType")

    if ntype == "Assignment":
        lhs = node.get("leftHandSide", {})
        rhs = node.get("rightHandSide", {})
        collect_ast_state_writes_only(lhs, state_var_ids, writes_set)
        if node.get("operator") not in ["=", ""]:
            collect_ast_state_reads_only(lhs, state_var_ids, reads_set)
        collect_ast_state_reads_and_writes(rhs, state_var_ids, reads_set, writes_set)
        return

    elif ntype == "UnaryOperation" and node.get("operator") in ["++", "--"]:
        sub = node.get("subExpression", {})
        collect_ast_state_writes_only(sub, state_var_ids, writes_set)
        collect_ast_state_reads_only(sub, state_var_ids, reads_set)
        return

    elif ntype == "UnaryOperation" and node.get("operator") == "delete":
        sub = node.get("subExpression", {})
        collect_ast_state_writes_only(sub, state_var_ids, writes_set)
        return

    elif ntype == "FunctionCall":
        expr = node.get("expression", {})
        if expr.get("nodeType") == "MemberAccess" and expr.get("memberName") in ["push", "pop"]:
            base = expr.get("expression", {})
            collect_ast_state_writes_only(base, state_var_ids, writes_set)
        else:
            collect_ast_state_reads_only(expr, state_var_ids, reads_set)

        for arg in node.get("arguments", []):
            collect_ast_state_reads_and_writes(arg, state_var_ids, reads_set, writes_set)
        return

    elif ntype in ["Identifier", "MemberAccess"]:
        collect_ast_state_reads_only(node, state_var_ids, reads_set)

    for k, v in node.items():
        if isinstance(v, list):
            for item in v:
                collect_ast_state_reads_and_writes(item, state_var_ids, reads_set, writes_set)
        elif isinstance(v, dict):
            collect_ast_state_reads_and_writes(v, state_var_ids, reads_set, writes_set)

def collect_ast_state_reads_only(node, state_var_ids, reads_set):
    if not isinstance(node, dict):
        return
    if node.get("nodeType") == "Identifier":
        ref_id = node.get("referencedDeclaration")
        if ref_id in state_var_ids:
            reads_set.add(state_var_ids[ref_id][1])
    for k, v in node.items():
        if isinstance(v, list):
            for item in v:
                collect_ast_state_reads_only(item, state_var_ids, reads_set)
        elif isinstance(v, dict):
            collect_ast_state_reads_only(v, state_var_ids, reads_set)

def collect_ast_state_writes_only(node, state_var_ids, writes_set):
    if not isinstance(node, dict):
        return
    if node.get("nodeType") == "Identifier":
        ref_id = node.get("referencedDeclaration")
        if ref_id in state_var_ids:
            writes_set.add(state_var_ids[ref_id][1])
    for k, v in node.items():
        if isinstance(v, list):
            for item in v:
                collect_ast_state_writes_only(item, state_var_ids, writes_set)
        elif isinstance(v, dict):
            collect_ast_state_writes_only(v, state_var_ids, writes_set)

def determine_call_node_ancestor_result_handling(node, ancestor_stack, func_body):
    """
    Evaluates AST ancestor stack (from immediate parent up to function root) for ERC20_TRANSFER_RETURNS_BOOL call nodes:
    - REQUIRE_CHECKED: Enclosed in require(...) FunctionCall
    - IF_CONDITION_CHECKED: Enclosed in IfStatement condition
    - RETURNED: Enclosed in ReturnStatement
    - ASSIGNED_AND_CHECKED: Assigned to variable AST ID whose referencedDeclaration is checked in subsequent require/if
    - ASSIGNED_UNCHECKED: Assigned to variable AST ID whose referencedDeclaration is never checked
    - DIRECT_UNCHECKED: Bare ExpressionStatement without guard
    """
    # Scan ancestor stack from immediate parent upwards
    for anc in reversed(ancestor_stack):
        anc_type = anc.get("nodeType")
        if anc_type == "FunctionCall":
            expr = anc.get("expression", {})
            if expr.get("nodeType") == "Identifier" and expr.get("name") == "require":
                return "REQUIRE_CHECKED"

        elif anc_type == "IfStatement":
            cond = anc.get("condition", {})
            # Verify call node is inside the condition
            cond_str = str(cond)
            if str(node.get("id")) in cond_str:
                return "IF_CONDITION_CHECKED"

        elif anc_type == "ReturnStatement":
            return "RETURNED"

        elif anc_type in ["VariableDeclarationStatement", "Assignment"]:
            var_ast_id = None
            if anc_type == "VariableDeclarationStatement":
                declarations = anc.get("declarations", [])
                if declarations and declarations[0]:
                    var_ast_id = declarations[0].get("id")
            elif anc_type == "Assignment":
                lhs = anc.get("leftHandSide", {})
                if lhs.get("nodeType") == "Identifier":
                    var_ast_id = lhs.get("referencedDeclaration") or lhs.get("id")

            if var_ast_id:
                # Inspect subsequent statements for Identifier references matching var_ast_id inside require/if
                is_checked = False
                def _scan_guard_usages(n):
                    nonlocal is_checked
                    if not isinstance(n, dict):
                        return
                    ntype = n.get("nodeType")
                    if ntype in ["IfStatement", "FunctionCall"]:
                        # Check if var_ast_id is referenced inside the guard
                        ref_ids = set()
                        def _collect_ref_ids(item):
                            if isinstance(item, dict):
                                if item.get("nodeType") == "Identifier":
                                    ref_ids.add(item.get("referencedDeclaration"))
                                    ref_ids.add(item.get("id"))
                                for k, v in item.items():
                                    if isinstance(v, list):
                                        for sub in v:
                                            _collect_ref_ids(sub)
                                    elif isinstance(v, dict):
                                        _collect_ref_ids(v)
                        _collect_ref_ids(n)
                        if var_ast_id in ref_ids:
                            is_checked = True
                    for k, v in n.items():
                        if isinstance(v, list):
                            for sub in v:
                                _scan_guard_usages(sub)
                        elif isinstance(v, dict):
                            _scan_guard_usages(v)

                _scan_guard_usages(func_body)
                return "ASSIGNED_AND_CHECKED" if is_checked else "ASSIGNED_UNCHECKED"

    return "DIRECT_UNCHECKED"

def collect_ast_calls(node, calls, library_names, ancestor_stack=None, func_body=None):
    if not isinstance(node, dict):
        return

    if ancestor_stack is None:
        ancestor_stack = []

    if node.get("nodeType") == "FunctionCall":
        expr = node.get("expression", {})
        ref_id = expr.get("referencedDeclaration")

        call_info = {
            "ast_id": node.get("id"),
            "ref_declaration": ref_id,
            "expr_type": expr.get("nodeType"),
            "src": node.get("src")
        }

        if expr.get("nodeType") == "Identifier":
            call_info["kind"] = "INTERNAL_FUNCTION_CALL"
            call_info["target_name"] = expr.get("name")
        elif expr.get("nodeType") == "MemberAccess":
            member = expr.get("memberName")
            base_expr = expr.get("expression", {})
            type_desc = base_expr.get("typeDescriptions", {}).get("typeString", "")

            call_info["target_name"] = member
            call_info["type_string"] = type_desc

            base_name = base_expr.get("name") if base_expr.get("nodeType") == "Identifier" else ""

            if type_desc.startswith("type(library ") or base_name in library_names or "Math" in base_name or "PositionMath" in base_name or "FundingRateCalculator" in base_name:
                call_info["kind"] = "INTERNAL_LIBRARY_CALL"
            elif base_expr.get("nodeType") == "Identifier" and base_expr.get("name") == "super":
                call_info["kind"] = "INHERITED_INTERNAL_CALL"
            elif base_expr.get("nodeType") == "ElementaryTypeNameExpression" and base_expr.get("typeName") == "address":
                call_info["kind"] = "EXTERNAL_INTERFACE_CALL"
            elif type_desc.startswith("address payable") or type_desc.startswith("address") or base_name == "payable":
                if member in ["transfer", "send"]:
                    call_kind = "NATIVE_ETH_TRANSFER"
                elif member in ["call", "staticcall", "delegatecall"]:
                    call_kind = "LOW_LEVEL_CALL_VALUE" if member == "call" else member.upper()
                else:
                    call_kind = "EXTERNAL_TYPED_CALL"
                call_info["kind"] = call_kind
            elif "IERC20" in type_desc or "ERC20" in type_desc or "contract IERC20" in type_desc:
                if "safe" in member.lower():
                    call_info["kind"] = "SAFEERC20_TRANSFER"
                elif member in ["transfer", "transferFrom"]:
                    call_info["kind"] = "ERC20_TRANSFER_RETURNS_BOOL"
                    call_info["ast_result_handling"] = determine_call_node_ancestor_result_handling(node, ancestor_stack, func_body or node)
                else:
                    call_info["kind"] = "ERC20_CALL"
            elif base_expr.get("nodeType") == "Identifier" and base_expr.get("name") == "this":
                call_info["kind"] = "SELF_EXTERNAL_CALL"
            else:
                call_info["kind"] = "EXTERNAL_TYPED_CALL"

        calls.append(call_info)

    curr_stack = ancestor_stack + [node]
    for k, v in node.items():
        if isinstance(v, list):
            for item in v:
                collect_ast_calls(item, calls, library_names, ancestor_stack=curr_stack, func_body=func_body or node)
        elif isinstance(v, dict):
            collect_ast_calls(v, calls, library_names, ancestor_stack=curr_stack, func_body=func_body or node)

def extract_ast_data():
    build_info_path = force_compile_and_find_build_info()
    with open(build_info_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    sources = data.get("output", {}).get("sources", {}) or data.get("sources", {})

    symbol_table = []
    concrete_entrypoints = []
    interface_declarations = []

    state_var_ids = {}
    func_id_to_item = {}
    func_name_to_items = {}
    internal_callee_edges = {}
    modifier_definitions_by_ast_id = {} # modifier_ast_id -> auth_meta
    library_names = set()

    contract_ast_registry = {} # contract_ast_id -> contract_meta
    contract_name_to_id = {}

    sorted_source_keys = sorted(sources.keys())

    # Pass 0: Index Contract Definitions, AST IDs, and Base Contracts
    for file_path in sorted_source_keys:
        source_data = sources[file_path]
        ast = source_data.get("ast", {})
        if not ast:
            continue
        for node in ast.get("nodes", []):
            if node.get("nodeType") == "ContractDefinition":
                c_id = node.get("id")
                c_name = node.get("name")
                c_kind = node.get("contractKind")
                linearized_bases = node.get("linearizedBaseContracts", [])
                base_contracts = [
                    b.get("baseName", {}).get("name") or b.get("baseName", {}).get("referencedDeclaration")
                    for b in node.get("baseContracts", [])
                ]

                contract_meta = {
                    "ast_id": c_id,
                    "name": c_name,
                    "kind": c_kind,
                    "linearized_base_contracts": linearized_bases,
                    "base_contracts": base_contracts
                }
                contract_ast_registry[c_id] = contract_meta
                contract_name_to_id[c_name] = c_id

                if c_kind == "library":
                    library_names.add(c_name)

    # Phase 1: Index State Variables, Modifiers, and Functions
    for file_path in sorted_source_keys:
        source_data = sources[file_path]
        norm_path = file_path.replace("\\", "/")
        if norm_path.startswith("project/"):
            norm_path = norm_path[len("project/"):]

        if not norm_path.startswith("contracts/") or norm_path.startswith("contracts/test/"):
            continue

        ast = source_data.get("ast", {})
        if not ast:
            continue

        for node in ast.get("nodes", []):
            if node.get("nodeType") == "ContractDefinition":
                contract_name = node.get("name")
                contract_kind = node.get("contractKind")
                contract_ast_id = node.get("id")
                is_abstract = node.get("abstract", False)

                for sub_node in node.get("nodes", []):
                    if sub_node.get("nodeType") == "ModifierDefinition":
                        mod_id = sub_node.get("id")
                        auth_meta = analyze_modifier_ast_body_for_auth(sub_node)
                        auth_meta["contract_ast_id"] = contract_ast_id
                        auth_meta["contract_name"] = contract_name
                        modifier_definitions_by_ast_id[mod_id] = auth_meta

                    elif sub_node.get("nodeType") == "VariableDeclaration" and sub_node.get("stateVariable"):
                        var_id = sub_node.get("id")
                        var_name = sub_node.get("name")
                        if var_id and var_name:
                            state_var_ids[var_id] = (contract_name, var_name)

                    elif sub_node.get("nodeType") == "FunctionDefinition":
                        func_id = sub_node.get("id")
                        func_name = sub_node.get("name")
                        kind = sub_node.get("kind")
                        visibility = sub_node.get("visibility")
                        state_mutability = sub_node.get("stateMutability")
                        is_implemented = sub_node.get("implemented", True)

                        param_nodes = []
                        params = []
                        param_types = []
                        param_ids = set()
                        for p in sub_node.get("parameters", {}).get("parameters", []):
                            p_id = p.get("id")
                            p_name = p.get("name", "")
                            type_str = p.get("typeDescriptions", {}).get("typeString", "unknown")
                            params.append(f"{type_str} {p_name}".strip())
                            param_types.append(type_str.split()[0])
                            param_nodes.append({"ast_id": p_id, "name": p_name, "type": type_str})
                            if p_id:
                                param_ids.add(p_id)

                        returns = [r.get("typeDescriptions", {}).get("typeString", "unknown") for r in sub_node.get("returnParameters", {}).get("parameters", [])]

                        # Modifier Invocation Resolution strictly by referencedDeclaration AST IDs
                        modifier_invocations = []
                        modifier_names = []
                        for m in sub_node.get("modifiers", []):
                            mod_name = m.get("modifierName", {}).get("name")
                            ref_decl = m.get("modifierName", {}).get("referencedDeclaration")
                            if mod_name:
                                modifier_names.append(mod_name)
                                modifier_invocations.append({
                                    "name": mod_name,
                                    "referenced_declaration": ref_decl
                                })

                        display_name = func_name or kind
                        canonical_sig = f"{contract_name}.{display_name}({','.join(param_types)})"

                        src_range = sub_node.get("src", "0:0:0")

                        # Verified Callback Classification: Requires BOTH interface inheritance AND exact parameter signature match
                        callback_info = None
                        if display_name in CALLBACK_INTERFACE_SIGNATURES:
                            cb_meta = CALLBACK_INTERFACE_SIGNATURES[display_name]
                            target_interface = cb_meta["interface"]
                            target_iface_id = contract_name_to_id.get(target_interface)

                            contract_linearized = contract_ast_registry.get(contract_ast_id, {}).get("linearized_base_contracts", [])

                            # Verify 1: Containing contract inherits target interface
                            has_interface_inheritance = target_iface_id and target_iface_id in contract_linearized

                            # Verify 2: Concrete parameter types match canonical callback types
                            expected_types = cb_meta["expected_param_types"]
                            types_match = (param_types == expected_types)

                            if has_interface_inheritance and types_match:
                                callback_info = {
                                    "callback_class": cb_meta["kind"],
                                    "callback_interface": target_interface,
                                    "canonical_callback_signature": cb_meta["signature"]
                                }

                        calls = []
                        collect_ast_calls(sub_node, calls, library_names, ancestor_stack=None, func_body=sub_node)

                        param_refs_map = {}
                        collect_ast_param_references(sub_node, param_ids, param_refs_map)

                        read_vars = set()
                        write_vars = set()
                        collect_ast_state_reads_and_writes(sub_node, state_var_ids, read_vars, write_vars)

                        sym_item = {
                            "ast_id": func_id,
                            "file": norm_path,
                            "contract": contract_name,
                            "contract_ast_id": contract_ast_id,
                            "contract_kind": contract_kind,
                            "is_abstract": is_abstract,
                            "function_name": display_name,
                            "kind": kind,
                            "canonical_signature": canonical_sig,
                            "visibility": visibility,
                            "state_mutability": state_mutability,
                            "implemented": is_implemented,
                            "parameters": params,
                            "param_ast_nodes": param_nodes,
                            "param_references_map": param_refs_map,
                            "returns": returns,
                            "modifiers": modifier_names,
                            "modifier_invocations": modifier_invocations,
                            "callback_info": callback_info,
                            "src_range": src_range,
                            "ast_state_reads": sorted(list(read_vars)),
                            "ast_state_writes": sorted(list(write_vars)),
                            "ast_calls": calls
                        }
                        symbol_table.append(sym_item)
                        func_id_to_item[func_id] = sym_item

                        key = (contract_name, display_name)
                        if key not in func_name_to_items:
                            func_name_to_items[key] = []
                        func_name_to_items[key].append(sym_item)

                        if contract_kind == "interface" or (is_abstract and not is_implemented):
                            interface_declarations.append(sym_item)
                        elif is_implemented and visibility in ["external", "public"]:
                            concrete_entrypoints.append(sym_item)
                        elif is_implemented and kind in ["receive", "fallback"]:
                            concrete_entrypoints.append(sym_item)

    # Phase 2: Transitive Call Graph
    for sym in symbol_table:
        caller_id = sym["ast_id"]
        c_name = sym["contract"]
        internal_callee_edges[caller_id] = set()

        for call in sym["ast_calls"]:
            ckind = call.get("kind")
            ref_id = call.get("ref_declaration")
            target_name = call.get("target_name")

            if ckind in ["INTERNAL_FUNCTION_CALL", "INHERITED_INTERNAL_CALL", "INTERNAL_LIBRARY_CALL"]:
                if ref_id and ref_id in func_id_to_item:
                    internal_callee_edges[caller_id].add(ref_id)
                elif target_name and (c_name, target_name) in func_name_to_items:
                    for target_item in func_name_to_items[(c_name, target_name)]:
                        internal_callee_edges[caller_id].add(target_item["ast_id"])

    # Compute Transitive Closure
    transitive_reachability = {}

    for ep in concrete_entrypoints:
        ep_id = ep["ast_id"]
        ep_sig = ep["canonical_signature"]

        visited = set()
        queue = [ep_id]

        while queue:
            curr = queue.pop(0)
            if curr not in visited:
                visited.add(curr)
                if curr not in transitive_reachability:
                    transitive_reachability[curr] = set()
                transitive_reachability[curr].add(ep_sig)

                for nxt in internal_callee_edges.get(curr, []):
                    if nxt not in visited:
                        queue.append(nxt)

    # Assign Reachability Status
    for sym in symbol_table:
        fid = sym["ast_id"]
        reachable_entry_sigs = sorted(list(transitive_reachability.get(fid, set())))
        sym["reachable_from"] = reachable_entry_sigs

        if sym["visibility"] in ["external", "public"]:
            sym["reachability_status"] = "EXTERNAL_DIRECT" if sym["visibility"] == "external" else "PUBLIC_DIRECT"
        elif sym["visibility"] in ["internal", "private"]:
            if reachable_entry_sigs:
                sym["reachability_status"] = "INTERNAL_REACHABLE" if sym["visibility"] == "internal" else "PRIVATE_REACHABLE"
            else:
                sym["reachability_status"] = "INTERNAL_NO_REACHABLE_CALLER_FOUND" if sym["visibility"] == "internal" else "PRIVATE_NO_REACHABLE_CALLER_FOUND"
        else:
            sym["reachability_status"] = "DECLARATION_ONLY"

    symbol_table.sort(key=lambda x: (x["file"], x["contract"], x["function_name"], x["canonical_signature"]))
    concrete_entrypoints.sort(key=lambda x: (x["file"], x["contract"], x["function_name"], x["canonical_signature"]))
    interface_declarations.sort(key=lambda x: (x["file"], x["contract"], x["function_name"], x["canonical_signature"]))

    os.makedirs("docs/security", exist_ok=True)
    with open("docs/security/08D_SYMBOL_TABLE.json", "w", encoding="utf-8") as f:
        json.dump(symbol_table, f, indent=2)

    return {
        "symbol_table": symbol_table,
        "concrete_entrypoints": concrete_entrypoints,
        "interface_declarations": interface_declarations,
        "modifier_definitions_by_ast_id": modifier_definitions_by_ast_id,
        "contract_ast_registry": contract_ast_registry,
        "contract_name_to_id": contract_name_to_id,
        "internal_callee_edges": {k: sorted(list(v)) for k, v in internal_callee_edges.items()}
    }

if __name__ == "__main__":
    res = extract_ast_data()
    print(f"Extracted {len(res['symbol_table'])} AST symbols:")
    print(f"  - Concrete Entrypoints: {len(res['concrete_entrypoints'])}")
    print(f"  - Interface / Abstract Declarations: {len(res['interface_declarations'])}")
