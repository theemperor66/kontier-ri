/**
 * Read-only SQL guard.
 *
 * Strategy: strip comments and string literals, then
 *  1. reject multi-statement input (any `;` that is not trailing),
 *  2. require the first keyword to be SELECT / WITH / DESCRIBE / SUMMARIZE / SHOW / FROM,
 *  3. reject mutating / side-effecting keywords anywhere outside string literals.
 * DuckDB itself is the last line of defense (in-memory, per-tab), but the guard
 * keeps agents honest and the tool contract predictable.
 */

export class ReadOnlySQLError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadOnlySQLError";
  }
}

const ALLOWED_LEADING = new Set([
  "select",
  "with",
  "describe",
  "summarize",
  "show",
  "from", // DuckDB allows `FROM t SELECT ...` / bare `FROM t`
]);

const FORBIDDEN = [
  "insert",
  "update",
  "delete",
  "drop",
  "create",
  "alter",
  "attach",
  "detach",
  "copy",
  "export",
  "import",
  "install",
  "load",
  "pragma",
  "set",
  "reset",
  "call",
  "vacuum",
  "checkpoint",
  "begin",
  "commit",
  "rollback",
  "grant",
  "revoke",
  "truncate",
  "merge",
  "use",
];

/** Remove SQL comments and replace string literals with placeholders. */
export function stripLiteralsAndComments(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i]!;
    const next = i + 1 < n ? sql[i + 1]! : "";
    if (c === "-" && next === "-") {
      // line comment
      while (i < n && sql[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      // block comment (no nesting)
      i += 2;
      while (i + 1 < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
    } else if (c === "'") {
      // single-quoted string, '' escapes a quote
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") break;
        else i++;
      }
      i++;
      out += "'?'";
    } else if (c === '"') {
      // double-quoted identifier, "" escapes
      i++;
      let ident = "";
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') {
          ident += '"';
          i += 2;
        } else if (sql[i] === '"') break;
        else ident += sql[i++]!;
      }
      i++;
      out += ' "id" ';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * Throws ReadOnlySQLError unless `sql` is a single read-only statement.
 * Returns the trimmed statement (trailing semicolon removed) on success.
 */
export function assertReadOnly(sql: string): string {
  if (typeof sql !== "string" || sql.trim().length === 0) {
    throw new ReadOnlySQLError("Empty SQL statement.");
  }
  const stripped = stripLiteralsAndComments(sql).trim();
  if (stripped.length === 0) {
    throw new ReadOnlySQLError("Empty SQL statement.");
  }
  // Multi-statement check: allow trailing semicolons only.
  const withoutTrailing = stripped.replace(/;+\s*$/, "");
  if (withoutTrailing.includes(";")) {
    throw new ReadOnlySQLError("Multiple SQL statements are not allowed.");
  }
  const firstWord = /[a-zA-Z_]+/.exec(withoutTrailing)?.[0]?.toLowerCase();
  if (!firstWord || !ALLOWED_LEADING.has(firstWord)) {
    throw new ReadOnlySQLError(
      `Only read-only queries are allowed (must start with SELECT/WITH/DESCRIBE/SUMMARIZE/SHOW/FROM, got ${JSON.stringify(firstWord ?? "")}).`,
    );
  }
  const words = withoutTrailing.toLowerCase().match(/[a-zA-Z_]+/g) ?? [];
  for (const w of words) {
    if (FORBIDDEN.includes(w)) {
      throw new ReadOnlySQLError(`Forbidden keyword in query: ${w.toUpperCase()}`);
    }
  }
  // Strip trailing semicolon from the ORIGINAL sql for safe wrapping.
  return sql.trim().replace(/;+\s*$/, "");
}

/** Wrap a (validated) query so the engine enforces the row cap. */
export function applyRowCap(validatedSql: string, maxRows: number): string {
  // +1 row so we can detect truncation.
  return `SELECT * FROM (\n${validatedSql}\n) AS _kri_q LIMIT ${maxRows + 1}`;
}

/** Quote an identifier for DuckDB. */
export function quoteIdent(name: string): string {
  return '"' + name.replaceAll('"', '""') + '"';
}
