# Local analysis tools

The verification service prefers local inference and uses external command line tools when they are installed. Missing optional binaries produce a limitation in the report and do not disable the built in metadata and forensic checks.

## Ollama

Install Ollama on the machine that runs the Next.js server, then pull the default text and vision models:

```sh
ollama pull llama3.2:3b
ollama pull qwen3-vl:8b
```

Set `OLLAMA_BASE_URL` to the Ollama API endpoint reachable from the server. Local inference is the default for analysis (`AI_PROVIDER_ORDER=ollama,gemini`) and vision (`VISION_PROVIDER_ORDER=ollama/qwen3-vl:8b,gemini`). Gemini is only used when its key is configured and local inference cannot run. To use a different local model, change `OLLAMA_MODEL` or `VISION_PROVIDER_ORDER`.

## Optional media binaries

- `ffmpeg` extracts up to three representative frames from video.
- `whisper` (OpenAI Whisper CLI) transcribes audio tracks and uploaded audio. `WHISPER_MODEL` defaults to `tiny`.
- `tesseract` performs a second OCR pass on uploaded images.
- `exiftool` adds a metadata inspection pass; the built in EXIF, XMP, and C2PA reference parsers remain active without it.

Install these tools in the same runtime/container as the Next.js Node process and ensure they are on `PATH`. For production deployments, include the required binaries and Python Whisper package in the application image. Hosted serverless platforms generally cannot reach `localhost` on a developer machine; use a secured, reachable Ollama endpoint or configure a Gemini key as fallback.

Audio, image, and video uploads are stored only as verification metadata and derived report data by the application. Raw uploads are processed in temporary files and removed after the local tool call completes.
