# SatyaCheck setup and evidence policy

SatyaCheck uses the existing Next.js App Router, React, AI SDK provider interface, and PostgreSQL/Drizzle storage. New assessments use `assessment.evidenceReport` (version 1). Historical reports remain readable; legacy confidence fields are retained for compatibility but are not displayed as truth percentages. No database migration is needed: the complete new report, including stable citation IDs and source excerpts, is stored in the existing assessment JSONB column.

## Configuration

- Set server-only `DATABASE_URL` (or `POSTGRES_URL`) and run `pnpm db:migrate` for a new database. Existing configured databases are preserved. Use the appropriate verified TLS connection settings for your host.
- Configure `GEMINI_API_KEY` (or `GOOGLE_GENERATIVE_AI_API_KEY`) and `GEMINI_MODEL` with a model available to your account. The existing configured model selection is preserved. Model availability, billing and quotas are account-dependent; this app does not enforce provider billing settings.
- `AI_PROVIDER_ORDER` selects analyst providers; `VISION_PROVIDER_ORDER` selects media readers. Existing provider adapters remain in `lib/core/model.ts`. Local text fallback can use `AI_PROVIDER_ORDER=gemini,ollama`, `OLLAMA_MODEL`, and `OLLAMA_BASE_URL`.
- Optional `GOOGLE_FACT_CHECK_API_KEY` enables Google's Fact Check Tools API. Enable that API for the key's project. Missing credentials are disclosed; no synthetic search results are substituted.
- Research also uses GDELT, Google News RSS, Wikipedia and Crossref through the existing provider interface. This is **not** Google general web search, exhaustive web coverage, or social-account authentication. Actual provider failures appear in report limitations.
- Install `ffmpeg` and `ffprobe` on the server for video/audio. Duration validation is mandatory and fails closed if unavailable. Install the `whisper` CLI and its selected local model (`WHISPER_MODEL`, default `tiny`) for timestamped speech transcription. Without Whisper, video can still inspect extracted frames, but explicitly reports that speech was not checked. Audio without a transcript has no factual findings.
- Tesseract and ExifTool are optional local OCR/metadata helpers. Images can use the configured vision provider without them. The pinned `sharp` dependency validates dimensions and prepares proportional image copies.
- Restart the app after changing environment variables. Keys must never use a `NEXT_PUBLIC_` prefix.

Missing analyst credentials produce a setup-required response. Missing database configuration produces a setup-required save error. Provider quota failures are distinct from an empty search. External provider success has not been established merely by passing the local fixture tests.

## Input and review flow

1. Choose text, URL, image, video or audio and select **Extract and review claims**.
2. Inspect the extracted text, timestamps, media uncertainty and claims. Edit or remove claims, correct their type, or add an omitted claim.
3. Select **Check reviewed claims**. The server searches, inspects available source text, compares evidence, and prepares individual assessments.

Progress is streamed as newline-delimited JSON using `Accept: application/x-ndjson`. Stages reflect server operations, not a client timer. Research failures retain other claims' results. The non-streaming JSON API remains supported. POST `action: preview` returns a review token; POST `{token, claims: [{text, claimType}]}` checks reviewed claims. Existing direct submissions without an action still work.

Review drafts expire after 10 minutes, are removed within the next minute, and are deleted after successful completion. They are limited to 50 per server process and contain extracted text, claims and media findings, **not upload bytes**. Draft tokens are random and checked against the request's client key. A restart, expiry or another server instance requires extraction again. Use sticky routing or a shared expiring store for a multi-instance deployment.

Text extraction inspects at most 12,000 characters for claims and produces at most 12 statements; truncation is disclosed. `SATYACHECK_MAX_CLAIMS` controls how many factual statements are researched. Unchecked statements remain visible with no score. Article retrieval extracts title, author, date and up to 20 relevant article/main links; research attempts at most two linked pages per claim alongside search results. PDFs, login-only posts, paywalls, CAPTCHAs and unsupported document formats are not bypassed. If a submitted page cannot be read, paste its text or upload a copy.

Images are limited to 12 MB and 40 megapixels, using still JPEG, PNG or WebP. Video/audio uploads are limited to 25 MB and 120 seconds. Byte signatures, decoded image dimensions, request-body limits and media duration are validated server-side. Video samples up to three frames at 0%, 50% and 90% of duration; displayed timestamps are seek positions, not exact forensic frame timestamps. Speech uses SRT timestamps when Whisper succeeds. Frames are not evidence of audio, and footage authenticity is never established by transcription or frame inspection. OCR, visible badges, logos, screenshots and model descriptions are unverified readings; the user reviews their interpretation before research.

## Verdicts and evidence strength

Each factual claim receives one of Supported, Mostly supported, Mixed, Unsupported, Contradicted, or Insufficient evidence. Opinions, satire, predictions and currently unverifiable statements receive Not fact-checkable. Unsupported requires an inspected source explicitly finding the exact claim unsubstantiated; an empty search never means false. No numerical strength is displayed for insufficient evidence, inaccessible-only evidence, or non-fact-checkable statements. There is no averaged multi-claim truth score.

The model returns schema-validated judgments over numbered retrieved sources. The application rejects out-of-range or repeated citation indexes, checks exact quotations against retrieved text, and validates quality excerpts. Models cannot supply source URLs or execute tools. The final findings and citations are assembled in application code from validated excerpts; no final model invents a score or uncited narrative.

The default provisional rubric totals 100 possible points:

| Component | Maximum | Current rule |
| --- | ---: | --- |
| Direct evidence relevant to verdict | 35 | Full credit requires an inspected article excerpt, exact quotation validation, and a judged match to the claim. Snippets alone earn zero. A verified exact-claim lack-of-substantiation finding can support Unsupported. |
| Independent corroboration | 25 | Two identified original-reporting groups earn half credit (rounded); three earn full credit. One group or unknown independence earns zero. |
| Quality and relevant expertise | 20 | A validated reporting-method/expertise excerpt earns 75% of this component (15 points); automated judgment alone cannot receive full credit. Domain reputation or official status alone earns zero. |
| Date, location and context match | 15 | Full credit requires direct inspected evidence judged to match the same event, people, location and time. Unknown/mismatched context earns zero and cannot support a directional verdict. |
| Source/document authenticity | 5 | Currently zero: no signature or account-ownership verification adapter is configured. A visible badge earns nothing. |

Points are computed in code; cited component explanations and applied caps appear in each report. A contradicted claim can have high strength. Strength is **not a probability of truth**, and these thresholds are provisional product rules, not scientific calibration.

`SATYACHECK_RUBRIC` optionally overrides weights as JSON, for example `{"direct":35,"independence":25,"quality":20,"context":15,"authenticity":5}`. All five weights must be nonnegative integers totalling 100. Changing weights does not enable unavailable checks, remove score caps, or recalculate saved reports.

- Unresolved direct supporting and contradicting evidence yields Mixed and caps strength at 60.
- Any retained snippet-only evidence caps strength at 70. Snippet-only directional reports abstain with Insufficient evidence and no score.
- Incomplete/truncated input or media interpretation caps strength at 60. All media readings are provisionally treated as incomplete.
- Different dates/events, uncertain context, or unavailable source judgment cannot establish a directional verdict.
- Sources share an origin group when their host, URL, headline, copied text, explicit wire origin, or source-URL attribution overlap. Independence credit additionally requires an inspected reporting-method excerpt. This conservative heuristic is imperfect and does not prove independence; the limitation is displayed.
- Social assertions are contextual evidence. No social account APIs are configured, and no account badge is authenticated. Allegations, investigations and charges must not be treated as established findings.

## Security, retention and operating limits

User submissions, retrieved pages, transcripts and media instructions are untrusted data. Models have no tool-execution capability in this pipeline. Public-page fetches validate every resolved address, pin the connection to those addresses, preserve TLS verification, and revalidate redirects. Private/reserved IPs, transition IPv6 destinations, URL credentials and nonstandard ports are rejected. Downloads have time, redirect and byte limits. Access controls are not circumvented.

Raw media is held in request memory and optional local-tool temporary files. Temporary directories are removed in `finally`, including tool failures. No raw upload bytes are stored in PostgreSQL. Local subprocesses have timeouts, bounded output, fixed arguments and no shell invocation. Provider error logging records structural error names/status codes rather than prompts, keys or uploaded content.

The existing history stores submitted text (for direct submissions), extracted text, reviewed claims, evidence excerpts, source URLs and results in PostgreSQL until the operator deletes them. This preserves existing history behavior; it is not an anonymous or automatically expiring report store. The app currently has shared history without per-user authentication, so submit public content only. The review draft store is separate and temporary. Cloud providers have their own retention policies; configure those according to deployment needs.

Successful research queries are cached in memory for five minutes (100 entries); Google Fact Check lookups for 15 minutes (100 entries). Expired entries are cleaned within one minute. Failures are not cached. Retrieval times survive cache reuse; saved reports are snapshots, not continuously refreshed assessments. Re-run a check for fresh evidence.

GDELT has a separate per-process queue and five-minute cache (100 entries, expired entries removed on the next GDELT lookup). Identical concurrent queries share one request. Requests run sequentially with a 5.5-second gap after completion, including slow responses; GDELT does not use the generic rapid retry loop. HTTP 429 pauses uncached requests for at least 60 seconds, or longer when `Retry-After` requests it. Timeouts and other failures pause requests for 15 seconds. During a pause, cached results remain usable and uncached lookups are explicitly reported as unavailable. Only one active request and one waiting request are permitted; excess lookups are disclosed as skipped so the queue cannot grow without bound. Other research providers continue independently. Plain-text GDELT query rejections are failures, not empty successful searches. These controls cannot guarantee availability or coordinate multiple server processes sharing a public IP; those deployments need a shared provider queue.

Rate limits and caches are per process. Only trust forwarded client-IP headers supplied by your deployment's trusted proxy. Set `SATYACHECK_RATE_LIMIT` and `SATYACHECK_RATE_LIMIT_WINDOW_MS` as needed; production multi-instance deployments need shared enforcement. API route duration is 300 seconds where the host honors it; shorter hosting limits can interrupt work and are surfaced by the client.

## Validation

- `pnpm typecheck`
- `pnpm test` (offline fixture and mocked-network tests, including UI report rendering)
- `pnpm test:media` (13 local media-integrity fixtures)
- `pnpm exec next build --webpack`

Tests cover supported/contradicted/unsupported claims, abstention, duplicated reporting, unverifiable badge assertions, inaccessible links, old-news context mismatch, review uncertainty, partial video coverage, fabricated citations, prompt-injection boundaries, unsafe URLs and redirects, DNS pinning, payload limits, stream interruption, and the four main reviewed pipeline flows. Fixtures are confined to tests and the explicitly labeled landing-page demo. Live provider searches, cloud transcription and production database writes require separate deployment validation; the offline tests do not claim these are working.
