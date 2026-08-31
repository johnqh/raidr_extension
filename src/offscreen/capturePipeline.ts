import {
  createPseudonymizer,
  redactRequest,
  type CapturedRequest,
  type RedactionEntry,
} from '@sudobility/raidr_lib';
import type { AssembledRequest } from '@/background/requestAssembler';
import type { ContentStore } from './store';

const encoder = new TextEncoder();

export class CapturePipeline {
  private readonly pseudonymizer: ReturnType<typeof createPseudonymizer>;
  private readonly captured: CapturedRequest[] = [];

  constructor(
    readonly store: ContentStore,
    salt: string
  ) {
    this.pseudonymizer = createPseudonymizer(salt);
  }

  async ingest(
    assembled: AssembledRequest,
    responseBody: string | null
  ): Promise<CapturedRequest> {
    const redacted = redactRequest(
      {
        requestHeaders: assembled.requestHeaders,
        responseHeaders: assembled.responseHeaders,
        mimeType: assembled.mimeType,
        requestBody: assembled.requestBody,
        responseBody,
      },
      this.pseudonymizer.pseudonym
    );

    const requestBodyHash =
      redacted.requestBody === null
        ? null
        : await this.store.put(encoder.encode(redacted.requestBody));
    const responseBodyHash =
      redacted.responseBody === null
        ? null
        : await this.store.put(encoder.encode(redacted.responseBody));

    const row: CapturedRequest = {
      id: assembled.id,
      ts: assembled.ts,
      method: assembled.method,
      url: assembled.url,
      resourceType: assembled.resourceType,
      requestHeaders: redacted.requestHeaders,
      requestBodyHash,
      status: assembled.status,
      responseHeaders: redacted.responseHeaders,
      responseBodyHash,
      mimeType: assembled.mimeType,
      fromCache: assembled.fromCache,
      navigationId: assembled.navigationId,
    };

    this.captured.push(row);
    return row;
  }

  redactionEntries(): RedactionEntry[] {
    return this.pseudonymizer.entries();
  }

  rows(): CapturedRequest[] {
    return this.captured;
  }
}
