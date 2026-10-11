# Satyacheck setup

The default analyst and media reader now use Gemini on the server, so Ollama is not required. Existing database configuration is preserved. Restart the development server after changing `.env.local`.

1. Set `GEMINI_API_KEY` from Google AI Studio. Use a project without paid billing for a strictly free-tier prototype. Account quotas and model availability vary; this app cannot enforce Google's billing settings.
2. Enable **Fact Check Tools API** in a Google Cloud project and create a restricted server API key. Set `GOOGLE_FACT_CHECK_API_KEY` in `.env.local`. Check the API's current quota and billing information in the console; no unlimited-free guarantee is assumed.
3. Keep the existing `DATABASE_URL`. See `.env.example` for other settings. Never expose keys with `NEXT_PUBLIC_`.
4. Restart with `pnpm dev`.

Text and links use claim extraction, external research, evidence judgement, and a conservative assessment. Images and videos are sent to the configured media model. Local OCR/transcription is optional; extracted text survives a cloud failure. Published fact-check snippets show the reviewed claim and original publisher rating; they remain search evidence, not verified article quotes. Missing reviews do not establish truth or falsehood.

Fact-check searches are cached in memory for 15 minutes (100 entries); errors are not cached. Claims run sequentially to reduce burst requests. Rate limits and caches are per process, not global across deployments. A verification requires several model calls and can exhaust small free quotas. Upload ceilings remain 12 MB for images and 25 MB for video/audio. Gemini free-tier submissions may be used to improve Google's products; use public material.

To opt into local text fallback set `AI_PROVIDER_ORDER=gemini,ollama` and `OLLAMA_MODEL=qwen3:1.7b`. Keep `VISION_PROVIDER_ORDER=gemini`; the small text model cannot read images. No model download is needed for the default configuration.

Checks: `pnpm typecheck` and `pnpm test`. The tests mock network calls and do not consume API quota.

The default model is `gemini-3.8-flash`, matching Google’s replacement for accounts that cannot access 2.5 Flash. Its standard API has a free tier subject to account quotas. Google Search grounding is not included in that free tier; this app continues to use separate research providers. Use `sslmode=verify-full` on your database URL to retain certificate and hostname verification explicitly.

## Broader evidence search

No paid search subscription is required. Search uses the existing Google News RSS, GDELT, Wikipedia, Crossref, and configured Google Fact Check lookup. Availability and coverage vary; these do not provide a complete web or social-media search. Social accounts are not authenticated. The app reports this limitation instead of asking for a paid search key. Gemini still depends on your account’s free-tier quota. No billing settings have been changed.

Each claim now uses two search variants retaining numbers such as winning margins. Up to three direct result pages are fetched with the existing public-URL, timeout and size guards. Blocked pages remain snippet-only evidence. Source reputation is a prior; evidence must still address the exact event and result. Reports with no directional evidence hide the fallback percentage.
