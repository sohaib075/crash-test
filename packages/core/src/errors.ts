/** An error the API should pass to the client as-is: HTTP status + stable code. */
export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public hint?: string) {
    super(message);
  }
}
