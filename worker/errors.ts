export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class StaleIncidentError extends Error {
  constructor(readonly currentVersion?: number) {
    super("Incident version advanced before enrichment completed");
    this.name = "StaleIncidentError";
  }
}

export class IncidentServiceError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super("Incident service request failed");
    this.name = "IncidentServiceError";
  }
}
