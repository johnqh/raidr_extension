/**
 * The redaction boundary. Every captured request passes through here before
 * its bodies are written to the content store, so nothing unredacted is ever
 * persisted. The rules themselves live in `@sudobility/raidr_processor`, shared
 * with the CLI.
 */
import {
  createPseudonymizer,
  redactRequest,
  type CapturedRequest,
  type RedactionEntry,
} from '@sudobility/raidr_processor';
import type { AssembledRequest } from '@/background/requestAssembler';
import type { ContentStore } from './store';

const encoder = new TextEncoder();

/**
 * Redacts, hashes and records requests for one session. The pseudonymizer is
 * per pipeline, so pseudonyms are stable within a session and `SessionState`
 * gets a fresh one on every `begin`.
 */
export class CapturePipeline {
  private readonly pseudonymizer: ReturnType<typeof createPseudonymizer>;
  private readonly captured: CapturedRequest[] = [];

  constructor(
    readonly store: ContentStore,
    salt: string
  ) {
    this.pseudonymizer = createPseudonymizer(salt);
  }

  /** Redacts one request, stores its bodies by content hash, and returns the stored row. */
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

  /** Placeholders issued so far — shown in the side panel and written to the bundle. */
  redactionEntries(): RedactionEntry[] {
    return this.pseudonymizer.entries();
  }

  /** Every row ingested this session, unfiltered. */
  rows(): CapturedRequest[] {
    return this.captured;
  }
}
