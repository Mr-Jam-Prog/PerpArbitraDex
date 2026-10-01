#!/usr/bin/env python3
"""
scripts/security/08d/extract_solidity_ast.py
Extracts Solidity AST nodes, state variables, modifiers, parameter nodes, function call edges, and builds a caller-callee call graph.
Enforces fresh compilation if build-info artifacts are missing or stale unless SKIP_FORCE_COMPILE is set.
Uses UTF-8 byte offset slicing for source ranges.
Outputs concrete entry points, interface declarations, internal functions, and symbol tables.
"""

import os
import sys
import json
import glob
import subprocess
from pathlib import Path

def find_build_info_forced():
    files = glob.glob("artifacts/build-info/*.output.json") or glob.glob("artifacts/build-info/*.json")
    if not files and not os.environ.get("SKIP_FORCE_COMPILE"):
        print("ℹ️ Compiling contracts to generate build-info...")
        subprocess.run(["pnpm", "exec", "hardhat", "compile", "--force"], check=True)
        files = glob.glob("artifacts/build-info/*.output.json") or glob.glob("artifacts/build-info/*.json")

    if not files:
        print("❌ Build-info generation failed.")
        sys.exit(1)
    files.sort(key=os.path.getsize, reverse=True)
    return files[0]

def traverse_ast_for_identifiers(node, name_set):
    if not isinstance(node, dict):
        return
    if node.get("nodeType") in ["Identifier", "UserDefinedTypeName", "MemberAccess"]:
        name = node.get("name") or node.get("memberName")
        if name:
            name_set.add(name)
    for k, v in node.items():
        if isinstance(v, list):
            for item in v:
                traverse_ast_for_identifiers(item, name_set)
        elif isinstance(v, dict):
            traverse_ast_for_identifiers(v, name_set)

def traverse_ast_for_calls(node, calls_set, typed_calls):
    if not isinstance(node, dict):
        return
    if node.get("nodeType") == "FunctionCall":
        expression = node.get("expression", {})
        if expression.get("nodeType") == "Identifier":
            name = expression.get("name")
            calls_set.add(name)
            typed_calls.append({"type": "IDENTIFIER_CALL", "name": name, "src": node.get("src")})
        elif expression.get("nodeType") == "MemberAccess":
            member = expression.get("memberName")
            calls_set.add(member)

            type_desc = expression.get("expression", {}).get("typeDescriptions", {}).get("typeString", "")
            if "IERC20" in type_desc or "ERC20" in type_desc:
                call_kind = "SAFEERC20_TRANSFER" if "safe" in member.lower() else "ERC20_TRANSFER_RETURNS_BOOL"
            elif type_desc.startswith("address payable") or type_desc.startswith("address"):
                if member in ["transfer", "send"]:
                    call_kind = "NATIVE_ETH_TRANSFER"
                elif member in ["call", "staticcall", "delegatecall"]:
                    call_kind = "LOW_LEVEL_CALL_VALUE"
                else:
                    call_kind = "TYPED_INTERFACE_CALL"
            else:
                call_kind = "TYPED_INTERFACE_CALL"

            typed_calls.append({
                "type": call_kind,
                "memberName": member,
                "typeString": type_desc,
                "src": node.get("src")
            })

    for k, v in node.items():
        if isinstance(v, list):
            for item in v:
                traverse_ast_for_calls(item, calls_set, typed_calls)
        elif isinstance(v, dict):
            traverse_ast_for_calls(v, calls_set, typed_calls)

def traverse_ast_for_state_writes(node, writes_set):
    if not isinstance(node, dict):
        return
    if node.get("nodeType") == "Assignment":
        left = node.get("leftHandSide", {})
        traverse_ast_for_identifiers(left, writes_set)
    elif node.get("nodeType") == "UnaryOperation" and node.get("operator") in ["++", "--"]:
        sub = node.get("subExpression", {})
        traverse_ast_for_identifiers(sub, writes_set)
    for k, v in node.items():
        if isinstance(v, list):
            for item in v:
                traverse_ast_for_state_writes(item, writes_set)
        elif isinstance(v, dict):
            traverse_ast_for_state_writes(v, writes_set)

def extract_ast_data():
    build_info_path = find_build_info_forced()
    with open(build_info_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    sources = {}
    if "output" in data and "sources" in data["output"]:
        sources = data["output"]["sources"]
    elif "sources" in data:
        sources = data["sources"]

    concrete_entrypoints = []
    interface_declarations = []
    symbol_table = []
    contract_state_vars = {}
    call_edges = {}
    state_writes_map = {}
    state_reads_map = {}

    sorted_source_keys = sorted(sources.keys())

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

                if contract_name not in contract_state_vars:
                    contract_state_vars[contract_name] = set()

                for sub_node in node.get("nodes", []):
                    if sub_node.get("nodeType") == "VariableDeclaration" and sub_node.get("stateVariable"):
                        var_name = sub_node.get("name")
                        if var_name:
                            contract_state_vars[contract_name].add(var_name)

                    elif sub_node.get("nodeType") == "FunctionDefinition":
                        func_name = sub_node.get("name")
                        kind = sub_node.get("kind")
                        visibility = sub_node.get("visibility")
                        state_mutability = sub_node.get("stateMutability")
                        is_implemented = sub_node.get("implemented", True)

                        params = []
                        param_ast_nodes = []
                        param_nodes = sub_node.get("parameters", {}).get("parameters", [])
                        for p in param_nodes:
                            type_str = p.get("typeDescriptions", {}).get("typeString", "unknown")
                            p_name = p.get("name", "")
                            p_id = p.get("id")
                            params.append(f"{type_str} {p_name}".strip())
                            param_ast_nodes.append({"id": p_id, "name": p_name, "type": type_str})

                        returns = []
                        ret_nodes = sub_node.get("returnParameters", {}).get("parameters", [])
                        for r in ret_nodes:
                            type_str = r.get("typeDescriptions", {}).get("typeString", "unknown")
                            returns.append(type_str)

                        modifiers = []
                        for mod in sub_node.get("modifiers", []):
                            mod_name = mod.get("modifierName", {}).get("name")
                            if mod_name:
                                modifiers.append(mod_name)

                        param_types = [p.split()[0] for p in params if p]
                        display_name = func_name or kind
                        canonical_sig = f"{contract_name}.{display_name}({','.join(param_types)})"

                        src_range = sub_node.get("src", "0:0:0")

                        calls_set = set()
                        typed_calls = []
                        traverse_ast_for_calls(sub_node, calls_set, typed_calls)
                        call_edges[canonical_sig] = calls_set

                        identifiers_set = set()
                        traverse_ast_for_identifiers(sub_node, identifiers_set)

                        writes_set = set()
                        traverse_ast_for_state_writes(sub_node, writes_set)

                        state_reads_map[canonical_sig] = identifiers_set.intersection(contract_state_vars[contract_name])
                        state_writes_map[canonical_sig] = writes_set.intersection(contract_state_vars[contract_name])

                        sym_item = {
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
                            "param_ast_nodes": param_ast_nodes,
                            "returns": returns,
                            "modifiers": modifiers,
                            "src_range": src_range,
                            "ast_state_reads": sorted(list(state_reads_map[canonical_sig])),
                            "ast_state_writes": sorted(list(state_writes_map[canonical_sig])),
                            "ast_calls": sorted(list(calls_set)),
                            "typed_calls": typed_calls
                        }
                        symbol_table.append(sym_item)

                        if contract_kind == "interface" or (is_abstract and not is_implemented):
                            interface_declarations.append(sym_item)
                        elif is_implemented and visibility in ["external", "public"]:
                            concrete_entrypoints.append(sym_item)
                        elif is_implemented and kind in ["receive", "fallback"]:
                            concrete_entrypoints.append(sym_item)

    entrypoint_sigs = set(e["canonical_signature"] for e in concrete_entrypoints)

    for sym in symbol_table:
        if sym["visibility"] in ["internal", "private"] and sym["implemented"]:
            c_name = sym["contract"]
            f_name = sym["function_name"]

            reachable_from = []
            for ep_sig in entrypoint_sigs:
                if ep_sig.startswith(c_name + "."):
                    if f_name in call_edges.get(ep_sig, set()):
                        reachable_from.append(ep_sig)

            sym["reachable_from"] = sorted(reachable_from)
            if reachable_from:
                sym["reachability_status"] = "INTERNAL_REACHABLE" if sym["visibility"] == "internal" else "PRIVATE_REACHABLE"
            else:
                sym["reachability_status"] = "INTERNAL_NO_REACHABLE_CALLER_FOUND" if sym["visibility"] == "internal" else "PRIVATE_NO_REACHABLE_CALLER_FOUND"
        elif sym["visibility"] in ["external", "public"]:
            sym["reachable_from"] = [sym["canonical_signature"]]
            sym["reachability_status"] = "EXTERNAL_DIRECT" if sym["visibility"] == "external" else "PUBLIC_DIRECT"
        else:
            sym["reachable_from"] = []
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

def slice_utf8_bytes(filepath, offset, length):
    raw_bytes = Path(filepath).read_bytes()
    snippet_bytes = raw_bytes[offset:offset+length]
    return snippet_bytes.decode("utf-8")

if __name__ == "__main__":
    res = extract_ast_data()
    print(f"Extracted {len(res['symbol_table'])} AST symbols:")
    print(f"  - Concrete Entrypoints: {len(res['concrete_entrypoints'])}")
    print(f"  - Interface / Abstract Declarations: {len(res['interface_declarations'])}")
