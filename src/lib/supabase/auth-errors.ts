export function isUnauthenticatedError(error: unknown) {
  if (!(error instanceof Error)) return false;
  if (error.name === "AuthSessionMissingError") return true;

  return (
    "status" in error &&
    typeof error.status === "number" &&
    error.status === 401
  );
}
