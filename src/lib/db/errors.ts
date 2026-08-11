/** Postgres foreign_key_violation. pg surfaces it as `code` on the error. */
export function isForeignKeyViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23503"
  );
}
