"""
Defense-in-depth SQL guardrails.

build_sql() in nl_query.py already only assembles SQL from whitelisted column/metric
expressions, but every generated statement is re-validated here before execution. This is
the layer that would catch a bug in the generator or a future code path that isn't as
disciplined. Enforces, in order:

  1. Exactly one statement (no stacked queries via ';').
  2. Statement type is SELECT only (default-deny INSERT/UPDATE/DELETE/DROP/ALTER/etc.).
  3. FROM target is the single approved semantic-layer view.
  4. No blacklisted keywords anywhere in the statement.
  5. A hard row LIMIT is present (defense against unbounded result sets).

In production, pair this with a database-level read-only role/user (e.g. a Postgres role
granted SELECT only on the semantic views, not the underlying tables) so even a guard bypass
can't mutate data.
"""
import re

import sqlparse
from sqlparse.sql import Statement
from sqlparse.tokens import DDL, DML

from .semantic_layer import BASE_TABLE

BLOCKED_KEYWORDS = [
    "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE",
    "GRANT", "REVOKE", "ATTACH", "PRAGMA", "EXEC", "EXECUTE", "--", "/*",
]


class UnsafeSQLError(ValueError):
    pass


def validate(sql: str) -> None:
    statements = [s for s in sqlparse.parse(sql) if s.token_first(skip_cm=True)]
    if len(statements) != 1:
        raise UnsafeSQLError("Only a single SELECT statement is permitted.")

    stmt: Statement = statements[0]
    first_token = stmt.token_first(skip_cm=True)
    if first_token is None or first_token.ttype is not DML or first_token.value.upper() != "SELECT":
        raise UnsafeSQLError("Only SELECT statements are permitted.")

    upper_sql = sql.upper()
    for kw in BLOCKED_KEYWORDS:
        if kw in upper_sql:
            raise UnsafeSQLError(f"Blocked keyword detected: {kw}")

    for token in stmt.flatten():
        if token.ttype is DDL:
            raise UnsafeSQLError("DDL statements are not permitted.")

    if BASE_TABLE.upper() not in upper_sql:
        raise UnsafeSQLError(f"Query must read from the approved view '{BASE_TABLE}'.")

    if not re.search(r"LIMIT\s+\?", sql, re.IGNORECASE):
        raise UnsafeSQLError("Query must include a bound LIMIT clause.")
