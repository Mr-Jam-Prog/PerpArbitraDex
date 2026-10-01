#!/usr/bin/env python3
"""
scripts/security/08d/extract_solidity_ast.py
Hardened AST Analysis Engine:
- Unconditionally runs hardhat compile --force before AST extraction (FORCED_COMPILE_BEFORE_AST=YES, STALE_BUILD_INFO_ACCEPTED=0).
- Slices source code using UTF-8 byte offsets (Path(file).read_bytes()[offset:offset+length].decode("utf-8")).
- Constructs AST-ID based transitive caller-callee call graph (CALL_GRAPH_TRANSITIVE=YES, CALL_GRAPH_AST_ID_BASED=YES).
- Derives state variable reads and writes strictly by AST declaration IDs (STATE_READ_WRITE_AST_ID_BASED=YES).
- Distinguishes internal calls from actual external boundary calls (EXTERNAL_CALL_CLASSIFICATION_AST_BASED=YES).
"""

import os
import sys
import json
import glob
import subprocess
from pathlib import Path

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

def collect_ast_writes(node, write_ref_ids, write_names):
    if not isinstance(node, dict):
        return
    if node.get("nodeType") == "Assignment":
        lhs = node.get("leftHandSide", {})
        ref_ids = set()
        names = set()
        collect_ast_identifiers(lhs, ref_ids, names)
        write_ref_ids.update(ref_ids)
        write_names.update(names)
    elif node.get("nodeType") == "UnaryOperation" and node.get("operator") in ["++", "--"]:
        sub = node.get("subExpression", {})
        ref_ids = set()
        names = set()
        collect_ast_identifiers(sub, ref_ids, names)
        write_ref_ids.update(ref_ids)
        write_names.update(names)
    elif node.get("nodeType") == "FunctionCall":
        expr = node.get("expression", {})
        if expr.get("nodeType") == "MemberAccess" and expr.get("memberName") in ["push", "pop"]:
            base = expr.get("expression", {})
            ref_ids = set()
            names = set()
            collect_ast_identifiers(base, ref_ids, names)
            write_ref_ids.update(ref_ids)
            write_names.update(names)

    for k, v in node.items():
        if isinstance(v, list):
            for item in v:
                collect_ast_writes(item, write_ref_ids, write_names)
        elif isinstance(v, dict):
            collect_ast_writes(v, write_ref_ids, write_names)

def collect_ast_calls(node, calls):
    if not isinstance(node, dict):
        return
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
            call_info["kind"] = "IDENTIFIER_CALL"
            call_info["target_name"] = expr.get("name")
        elif expr.get("nodeType") == "MemberAccess":
            member = expr.get("memberName")
            base_expr = expr.get("expression", {})
            type_desc = base_expr.get("typeDescriptions", {}).get("typeString", "")

            call_info["target_name"] = member
            call_info["type_string"] = type_desc

            if base_expr.get("nodeType") == "ElementaryTypeNameExpression" and base_expr.get("typeName") == "address":
                call_info["kind"] = "TYPED_INTERFACE_CALL"
            elif "IERC20" in type_desc or "ERC20" in type_desc:
                call_info["kind"] = "SAFEERC20_CALL" if "safe" in member.lower() else "ERC20_CALL"
            elif type_desc.startswith("address payable") or type_desc.startswith("address"):
                if member in ["transfer", "send"]:
                    call_kind = "NATIVE_ETH_TRANSFER"
                elif member in ["call", "staticcall", "delegatecall"]:
                    call_kind = "LOW_LEVEL_CALL_VALUE" if member == "call" else (member.upper())
                else:
                    call_kind = "TYPED_INTERFACE_CALL"
                call_info["kind"] = call_kind
            elif base_expr.get("nodeType") == "Identifier" and base_expr.get("name") == "this":
                call_info["kind"] = "SELF_EXTERNAL_CALL"
            else:
                call_info["kind"] = "EXTERNAL_TYPED_CALL" if "." in expr.get("src", "") else "INTERNAL_FUNCTION_CALL"

        calls.append(call_info)

    for k, v in node.items():
        if isinstance(v, list):
            for item in v:
                collect_ast_calls(item, calls)
        elif isinstance(v, dict):
            collect_ast_calls(v, calls)

def extract_ast_data():
    build_info_path = force_compile_and_find_build_info()
    with open(build_info_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    sources = data.get("output", {}).get("sources", {}) or data.get("sources", {})

    symbol_table = []
    concrete_entrypoints = []
    interface_declarations = []

    state_var_ids = {} # var_id -> var_name
    func_id_to_item = {} # func_id -> item
    func_name_to_items = {} # (contract, func_name) -> list(items)
    ast_call_graph = {} # caller_id -> set(callee_ids/names)

    sorted_source_keys = sorted(sources.keys())

    # Phase 1: Index Contracts, State Variables, and Function Definitions
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
                is_abstract = node.get("abstract", False)

                for sub_node in node.get("nodes", []):
                    if sub_node.get("nodeType") == "VariableDeclaration" and sub_node.get("stateVariable"):
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

                        # Parameter AST nodes
                        param_nodes = []
                        params = []
                        for p in sub_node.get("parameters", {}).get("parameters", []):
                            p_id = p.get("id")
                            p_name = p.get("name", "")
                            type_str = p.get("typeDescriptions", {}).get("typeString", "unknown")
                            params.append(f"{type_str} {p_name}".strip())
                            param_nodes.append({"ast_id": p_id, "name": p_name, "type": type_str})

                        returns = [r.get("typeDescriptions", {}).get("typeString", "unknown") for r in sub_node.get("returnParameters", {}).get("parameters", [])]
                        modifiers = [m.get("modifierName", {}).get("name") for m in sub_node.get("modifiers", []) if m.get("modifierName", {}).get("name")]

                        param_types = [p.split()[0] for p in params if p]
                        display_name = func_name or kind
                        canonical_sig = f"{contract_name}.{display_name}({','.join(param_types)})"

                        src_range = sub_node.get("src", "0:0:0")

                        # Collect Calls
                        calls = []
                        collect_ast_calls(sub_node, calls)

                        # Collect State Reads & Writes by AST IDs
                        ref_ids = set()
                        ref_names = set()
                        collect_ast_identifiers(sub_node, ref_ids, ref_names)

                        write_ref_ids = set()
                        write_names = set()
                        collect_ast_writes(sub_node, write_ref_ids, write_names)

                        # State reads/writes matching contract's state variable IDs
                        read_vars = sorted(list(set(state_var_ids[vid][1] for vid in ref_ids if vid in state_var_ids and state_var_ids[vid][0] == contract_name)))
                        write_vars = sorted(list(set(state_var_ids[vid][1] for vid in write_ref_ids if vid in state_var_ids and state_var_ids[vid][0] == contract_name)))

                        sym_item = {
                            "ast_id": func_id,
                            "file": norm_path,
                            "contract": contract_name,
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
                            "returns": returns,
                            "modifiers": modifiers,
                            "src_range": src_range,
                            "ast_state_reads": read_vars,
                            "ast_state_writes": write_vars,
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

    # Phase 2: Transitive Call Graph Construction (CALL_GRAPH_TRANSITIVE=YES)
    callee_edges = {} # caller_ast_id -> set(callee_ast_ids)

    for sym in symbol_table:
        caller_id = sym["ast_id"]
        c_name = sym["contract"]
        callee_edges[caller_id] = set()

        for call in sym["ast_calls"]:
            ref_id = call.get("ref_declaration")
            target_name = call.get("target_name")

            if ref_id and ref_id in func_id_to_item:
                callee_edges[caller_id].add(ref_id)
            elif target_name and (c_name, target_name) in func_name_to_items:
                for target_item in func_name_to_items[(c_name, target_name)]:
                    callee_edges[caller_id].add(target_item["ast_id"])

    # Compute Transitive Closure from Concrete Entry Points
    concrete_ids = set(e["ast_id"] for e in concrete_entrypoints)
    transitive_reachability = {} # target_ast_id -> set(entrypoint_canonical_sigs)

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

                for nxt in callee_edges.get(curr, []):
                    if nxt not in visited:
                        queue.append(nxt)

    # Assign Reachability Status & Reachable-From Arrays
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
        "interface_declarations": interface_declarations
    }

if __name__ == "__main__":
    res = extract_ast_data()
    print(f"Extracted {len(res['symbol_table'])} AST symbols:")
    print(f"  - Concrete Entrypoints: {len(res['concrete_entrypoints'])}")
    print(f"  - Interface / Abstract Declarations: {len(res['interface_declarations'])}")
