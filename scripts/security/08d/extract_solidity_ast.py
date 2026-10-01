#!/usr/bin/env python3
"""
scripts/security/08d/extract_solidity_ast.py
Extracts Solidity AST nodes and symbol tables from Hardhat build-info output artifacts.
Automatically triggers contract compilation if build-info artifacts are missing.
"""

import os
import sys
import json
import glob
import subprocess

def find_build_info():
    files = glob.glob("artifacts/build-info/*.output.json")
    if not files:
        files = glob.glob("artifacts/build-info/*.json")
    if not files:
        print("ℹ️ No build-info artifacts found. Compiling contracts via Hardhat...")
        subprocess.run(["pnpm", "exec", "hardhat", "compile"], check=True)
        files = glob.glob("artifacts/build-info/*.output.json") or glob.glob("artifacts/build-info/*.json")
    if not files:
        print("❌ Build-info generation failed.")
        sys.exit(1)
    files.sort(key=os.path.getsize, reverse=True)
    return files[0]

def extract_ast_data():
    build_info_path = find_build_info()
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
                contract_kind = node.get("contractKind") # contract, interface, library
                is_abstract = node.get("abstract", False)

                for sub_node in node.get("nodes", []):
                    if sub_node.get("nodeType") == "FunctionDefinition":
                        func_name = sub_node.get("name")
                        kind = sub_node.get("kind") # function, constructor, receive, fallback
                        visibility = sub_node.get("visibility") # external, public, internal, private
                        state_mutability = sub_node.get("stateMutability") # pure, view, nonpayable, payable
                        is_implemented = sub_node.get("implemented", True)

                        params = []
                        param_nodes = sub_node.get("parameters", {}).get("parameters", [])
                        for p in param_nodes:
                            type_str = p.get("typeDescriptions", {}).get("typeString", "unknown")
                            p_name = p.get("name", "")
                            params.append(f"{type_str} {p_name}".strip())

                        returns = []
                        ret_nodes = sub_node.get("returnParameters", {}).get("parameters", [])
                        for r in ret_nodes:
                            type_str = r.get("typeDescriptions", {}).get("typeString", "unknown")
                            returns.append(type_str)

                        param_types = [p.split()[0] for p in params if p]
                        display_name = func_name or kind
                        canonical_sig = f"{contract_name}.{display_name}({','.join(param_types)})"

                        src_range = sub_node.get("src", "0:0:0")

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
                            "returns": returns,
                            "src_range": src_range
                        }
                        symbol_table.append(sym_item)

                        if contract_kind == "interface" or (is_abstract and not is_implemented):
                            interface_declarations.append(sym_item)
                        elif is_implemented and visibility in ["external", "public"]:
                            concrete_entrypoints.append(sym_item)
                        elif is_implemented and kind in ["receive", "fallback"]:
                            concrete_entrypoints.append(sym_item)

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
