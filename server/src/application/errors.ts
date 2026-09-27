/** API-level errors carrying the shared contract error codes. */
export class ApiError extends Error {
  constructor(
    readonly code:
      | "validation_failed"
      | "not_found"
      | "version_conflict"
      | "command_rejected"
      | "content_version_missing"
      | "forbidden",
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get httpStatus(): number {
    switch (this.code) {
      case "validation_failed":
        return 422;
      case "not_found":
        return 404;
      case "version_conflict":
        return 409;
      case "command_rejected":
        return 422;
      case "content_version_missing":
        return 422;
      case "forbidden":
        return 403;
    }
  }
}

export const notFound = (what: string) =>
  new ApiError("not_found", `${what} not found`);
