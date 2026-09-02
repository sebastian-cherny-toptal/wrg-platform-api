#!/usr/bin/env python3
"""Validate Zoho CRM environment variables with a read-only API request.

The script uses only Python's standard library, loads ``.env`` by default,
refreshes an OAuth access token, and reads one CRM record. It never prints
credentials or tokens.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


DEFAULT_ACCOUNTS_URL = "https://accounts.zoho.com"
DEFAULT_API_VERSION = "v8"

INVENTORY_FIELDS = {
    "Main_Projects": (
        "Name",
        "Main_Project_ID",
        "Project_Specific_Employer_Identifier",
        "Project_Abbreviation",
        "Created_Time",
        "Modified_Time", "Created_By", "Modified_By", "Owner"
    ),
    "Programs": (
        "Name",
        "Program_Year",
        "Project",
        "Program_Type",
        "EFS_Launch_Date",
        "EFS_end_Date",
        "Employer_Assessment_Deadline",
        "Employee_Survey_ID",
        "Employer_Survey_ID",
        "Previous_Year_Program",
        "Ranking_Analysis_Completed",
    ),
    "Deals": (
        "Deal_Name",
        "Deal_Organization_ID",
        "Account_Name",
        "Program",
        "Stage",
        "Current_Year_Winner",
        "Current_Year_Category",
        "Current_Year_Overall_Rank",
        "Current_Year_Category_Rank",
        "Surveys_Sent",
        "Survey_Type",
        "Total_Number_of_Program_EEs",
    ),
    "Accounts": (
        "Account_Name",
        "Account_Number",
        "Organization_Legal_Name_Organization_Legal_Name",
        "Alias_Company_Name",
        "Organization_Industry",
        "Industry",
        "Employees",
        "City",
        "Billing_City",
        "Billing_State",
        "Billing_Country",
    ),
    "Contacts": (
        "Full_Name",
        "First_Name",
        "Last_Name",
        "Account_Name",
        "Title",
        "Contact_Type",
    ),
    "Products": (
        "Product_Name",
        "Product_Code",
        "Product_Category",
        "Unit_Price",
        "Qty_in_Stock",
        "Description",
    ),
}

def load_env_file(path: Path) -> None:
    """Load simple KEY=VALUE entries without overriding exported variables."""
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if value and value[0] in {'"', "'"} and value[-1:] == value[0]:
            value = value[1:-1]
        os.environ.setdefault(key, value)


def json_request(request: Request, timeout: float = 15.0) -> tuple[int, dict]:
    try:
        with urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
            return response.status, json.loads(body) if body else {}
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            payload = {"message": body[:500]}
        message = payload.get("error_description") or payload.get("message")
        code = payload.get("code") or payload.get("error")
        detail = ": ".join(str(item) for item in (code, message) if item)
        raise RuntimeError(f"HTTP {error.code}{': ' + detail if detail else ''}") from None
    except URLError as error:
        raise RuntimeError(f"Network error: {error.reason}") from None


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ValueError(f"missing {name}")
    return value


def get_records(api_domain: str, api_version: str, module: str, fields: str, access_token: str) -> tuple[int, dict]:
    query = urlencode({"fields": fields, "per_page": "1"})
    status, records_payload = json_request(
        Request(
            f"{api_domain.rstrip('/')}/crm/{api_version}/{module}?{query}",
            headers={"Authorization": f"Zoho-oauthtoken {access_token}"},
            method="GET",
        ),
    )

    return status, records_payload


def crm_get(
    api_domain: str,
    api_version: str,
    path: str,
    access_token: str,
    parameters: dict[str, str] | None = None,
    timeout: float = 15.0,
) -> tuple[int, dict]:
    query = f"?{urlencode(parameters)}" if parameters else ""
    return json_request(
        Request(
            f"{api_domain.rstrip('/')}/crm/{api_version}/{path.lstrip('/')}{query}",
            headers={"Authorization": f"Zoho-oauthtoken {access_token}"},
            method="GET",
        ),
        timeout,
    )


def compact_value(value: object) -> object:
    if isinstance(value, dict):
        return {
            key: compact_value(nested)
            for key, nested in value.items()
            if key in {"id", "name", "api_name", "module"}
        }
    if isinstance(value, list):
        return [compact_value(item) for item in value[:3]]
    return value


def print_first_project_programs(
    api_domain: str,
    api_version: str,
    access_token: str,
    project: dict,
    timeout: float,
) -> None:
    project_id = str(project["id"])
    programs = []
    for page in range(1, 11):
        _, payload = crm_get(
            api_domain,
            api_version,
            "Programs/search",
            access_token,
            {
                "criteria": f"(Project:equals:{project_id})",
                "fields": "Name,Program_Year,Project,Program_Type",
                "per_page": "200",
                "page": str(page),
            },
            timeout,
        )
        programs.extend(payload.get("data", []))
        if not payload.get("info", {}).get("more_records"):
            break

    safe_programs = [
        {
            "id": program.get("id"),
            "name": program.get("Name"),
            "year": program.get("Program_Year"),
            "type": program.get("Program_Type"),
        }
        for program in programs
    ]
    print("first_project=" + json.dumps(
        {"id": project_id, "name": project.get("Name")}, sort_keys=True
    ))
    print(f"associated_program_count={len(programs)}")
    print("associated_programs=" + json.dumps(safe_programs, sort_keys=True, default=str))


def find_winner_program_example(
    api_domain: str,
    api_version: str,
    access_token: str,
    timeout: float,
) -> None:
    fields = (
        "Deal_Name,Deal_Organization_ID,Account_Name,Program,Stage,"
        "Current_Year_Winner,Current_Year_Category,Current_Year_Overall_Rank,"
        "Current_Year_Category_Rank,Surveys_Sent,Total_Number_of_Program_EEs"
    )
    _, winner_payload = crm_get(
        api_domain,
        api_version,
        "Deals/search",
        access_token,
        {
            "criteria": "(Current_Year_Winner:equals:Yes)",
            "fields": fields,
            "per_page": "20",
        },
        timeout,
    )
    winner_records = winner_payload.get("data", [])
    selected_program = next(
        (
            record.get("Program")
            for record in winner_records
            if isinstance(record.get("Program"), dict)
            and record["Program"].get("id")
        ),
        None,
    )
    if not selected_program:
        print("\n===== Program-scoped winner example =====")
        print("No Deal with Current_Year_Winner=Yes and a Program lookup was found.")
        return

    program_id = str(selected_program["id"])
    records = []
    for page in range(1, 11):
        _, payload = crm_get(
            api_domain,
            api_version,
            "Deals/search",
            access_token,
            {
                "criteria": f"(Program:equals:{program_id})",
                "fields": fields,
                "per_page": "200",
                "page": str(page),
            },
            timeout,
        )
        batch = payload.get("data", [])
        records.extend(batch)
        if not payload.get("info", {}).get("more_records"):
            break

    winner_counts: dict[str, int] = {}
    for record in records:
        status = str(record.get("Current_Year_Winner") or "blank")
        winner_counts[status] = winner_counts.get(status, 0) + 1
    safe_samples = [
        {
            "deal_id": record.get("id"),
            "organization": compact_value(record.get("Account_Name")),
            "program": compact_value(record.get("Program")),
            "winner": record.get("Current_Year_Winner"),
            "category": record.get("Current_Year_Category"),
            "overall_rank": record.get("Current_Year_Overall_Rank"),
            "category_rank": record.get("Current_Year_Category_Rank"),
            "surveys_sent": record.get("Surveys_Sent"),
            "stage": record.get("Stage"),
            "employees_count": record.get("Total_Number_of_Program_EEs"),
        }
        for record in records
        if record.get("Current_Year_Winner") in {"Yes", "No"}
    ][:8]
    print("\n===== Program-scoped winner example =====")
    print("program=" + json.dumps(compact_value(selected_program), sort_keys=True))
    print(f"related_deal_count={len(records)} winner_counts={json.dumps(winner_counts, sort_keys=True)}")
    print("winner_non_winner_samples=" + json.dumps(safe_samples, sort_keys=True, default=str))


def print_inventory(
    api_domain: str,
    api_version: str,
    access_token: str,
    timeout: float,
) -> None:
    _, modules_payload = crm_get(
        api_domain, api_version, "settings/modules", access_token, timeout=timeout
    )
    modules = modules_payload.get("modules", [])
    accessible = sorted(
        module.get("api_name", "")
        for module in modules
        if module.get("api_supported") and module.get("api_name")
    )
    print(f"INVENTORY: {len(accessible)} API-supported CRM modules are visible.")
    print("INVENTORY: target modules present:", ", ".join(
        module for module in INVENTORY_FIELDS if module in accessible
    ))

    for module, requested_fields in INVENTORY_FIELDS.items():
        _, fields_payload = crm_get(
            api_domain,
            api_version,
            "settings/fields",
            access_token,
            {"module": module},
            timeout,
        )
        metadata = fields_payload.get("fields", [])
        by_name = {field.get("api_name"): field for field in metadata}
        selected = [name for name in requested_fields if name in by_name]
        relationship_fields = []
        for name in selected:
            field = by_name[name]
            relationship = compact_value(field.get("lookup") or {})
            relationship_fields.append(
                {
                    "api_name": name,
                    "label": field.get("field_label"),
                    "data_type": field.get("data_type"),
                    **({"lookup": relationship} if relationship else {}),
                }
            )
        _, count_payload = crm_get(
            api_domain,
            api_version,
            f"{module}/actions/count",
            access_token,
            timeout=timeout,
        )
        _, records_payload = crm_get(
            api_domain,
            api_version,
            module,
            access_token,
            {"fields": ",".join(selected), "per_page": "15", "page": "1"},
            timeout,
        )
        samples = []
        for record in records_payload.get("data", [])[:5]:
            samples.append(
                {
                    "id": record.get("id"),
                    **{
                        name: compact_value(record.get(name))
                        for name in selected
                        if record.get(name) not in (None, "", [], {})
                    },
                }
            )
        print(f"\n===== {module} =====")
        print(f"record_count={count_payload.get('count', 'unknown')} field_count={len(metadata)}")
        print("selected_field_metadata=" + json.dumps(relationship_fields, sort_keys=True))
        print("sample_records=" + json.dumps(samples, sort_keys=True, default=str))
        if module == "Main_Projects" and records_payload.get("data"):
            print_first_project_programs(
                api_domain,
                api_version,
                access_token,
                records_payload["data"][0],
                timeout,
            )

    find_winner_program_example(
        api_domain, api_version, access_token, timeout
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=Path(__file__).with_name(".env"))
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument(
        "--inventory",
        action="store_true",
        help="Inspect target CRM module metadata and print safe, read-only samples.",
    )
    args = parser.parse_args()
    load_env_file(args.env_file)

    required_names = ("ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN")
    missing = [name for name in required_names if not os.environ.get(name, "").strip()]
    if missing:
        print(f"FAIL: missing required variable(s): {', '.join(missing)}", file=sys.stderr)
        print(
            "Zoho's direct CRM API needs a refresh token in addition to the client ID and secret.",
            file=sys.stderr,
        )
        return 2

    client_id = required_env("ZOHO_CLIENT_ID")
    client_secret = required_env("ZOHO_CLIENT_SECRET")
    refresh_token = required_env("ZOHO_REFRESH_TOKEN")
    if any(value == "local-mock" for value in (client_id, client_secret, refresh_token)):
        print("FAIL: the selected environment file contains local mock Zoho credentials.", file=sys.stderr)
        return 2

    accounts_url = os.environ.get("ZOHO_ACCOUNTS_URL", DEFAULT_ACCOUNTS_URL).rstrip("/")
    token_body = urlencode(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
    ).encode("ascii")

    try:

        _, token_payload = json_request(
            Request(
                f"{accounts_url}/oauth/v2/token",
                data=token_body,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                method="POST",
            ),
            args.timeout,
        )
        access_token = token_payload.get("access_token")
        api_domain = token_payload.get("api_domain")
        if not access_token or not api_domain:
            raise RuntimeError("token response did not contain access_token and api_domain")
        print(f"PASS: OAuth refresh succeeded (API domain: {api_domain}).")

        module = os.environ.get("ZOHO_TEST_MODULE", "Accounts").strip()
        fields = os.environ.get("ZOHO_TEST_FIELDS", "Account_Name").strip()
        api_version = os.environ.get("ZOHO_API_VERSION", DEFAULT_API_VERSION).strip()
        status, records_payload = get_records(api_domain, api_version, module, fields, access_token)
        record_count = len(records_payload.get("data", []))
        print(
            f"PASS: read-only CRM request succeeded for {module} "
            f"(HTTP {status}, {record_count} record(s) returned)."
        )
        if args.inventory:
            print_inventory(api_domain, api_version, access_token, args.timeout)

        configured_base = os.environ.get("ZOHO_BASE_URL", "").rstrip("/")
        expected_base = f"{api_domain.rstrip('/')}/crm/{api_version}"
        if configured_base and configured_base != expected_base:
            print(f"WARN: ZOHO_BASE_URL is {configured_base!r}; direct Zoho v8 would use {expected_base!r}.")
        return 0
    except (RuntimeError, ValueError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
