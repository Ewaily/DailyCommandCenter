export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export class NotConnectedError extends HttpError {
  constructor(provider: string) {
    super(401, `${provider} not connected`, "not_connected");
  }
}
