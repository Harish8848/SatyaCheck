/** Runtime configuration, validated once per cold start with safe fallbacks. */

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const config = {
  /** Models tried in order. First entry is the primary analyst. */
  // Cloud inference avoids loading large models on student laptops; local use is opt-in.
  analystModels: (process.env.AI_PROVIDER_ORDER?.split(',').map((v) => v.trim()).filter(Boolean) ?? ['gemini']),
  /** Vision / multimodal model for media inspection. */
  visionModels: (process.env.VISION_PROVIDER_ORDER?.split(',').map((v) => v.trim()).filter(Boolean) ?? ['gemini']),

  /** Per-request timeouts for third-party research providers. */
  providerTimeoutMs: intEnv('RESEARCH_PROVIDER_TIMEOUT_MS', 5000),
  /** Give local inference enough time for cold starts and multimodal inputs. */
  modelTimeoutMs: intEnv('AI_PROVIDER_TIMEOUT_MS', 30_000),
  /** Evidence classification is bounded separately so a slow local fallback
   * cannot hold the whole verification job for multiple retry windows. */
  evidenceJudgementTimeoutMs: intEnv('EVIDENCE_JUDGEMENT_TIMEOUT_MS', 10_000),
  claimExtractionTimeoutMs: intEnv('CLAIM_EXTRACTION_TIMEOUT_MS', 30_000),
  /** Cap on how much page text we hand to the model. */
  maxContextChars: intEnv('SATYACHECK_MAX_CONTEXT_CHARS', 120_000),
  /** Research sources retained after ranking. */
  maxEvidenceItems: intEnv('SATYACHECK_MAX_EVIDENCE', 12),
  /** Maximum claims analysed per submission; the rest are listed but not checked. */
  maxClaims: intEnv('SATYACHECK_MAX_CLAIMS', 4),
  /** Search queries issued per claim. */
  queriesPerClaim: intEnv('SATYACHECK_QUERIES_PER_CLAIM', 2),

  /** Upload ceilings, enforced before any parsing happens. */
  maxImageBytes: intEnv('SATYACHECK_MAX_IMAGE_BYTES', 12 * 1024 * 1024),
  maxVideoBytes: intEnv('SATYACHECK_MAX_VIDEO_BYTES', 25 * 1024 * 1024),

  /** Remote fetch guards. */
  fetchTimeoutMs: intEnv('SATYACHECK_FETCH_TIMEOUT_MS', 12_000),
  maxRedirects: 3,
  maxRemoteBytes: 4 * 1024 * 1024,

  /** Simple per-IP rate limit for job creation. */
  rateLimitRequests: intEnv('SATYACHECK_RATE_LIMIT', 20),
  rateLimitWindowMs: intEnv('SATYACHECK_RATE_LIMIT_WINDOW_MS', 60_000),
} as const

export const hasGeminiKey = () => Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY)
export const hasDatabase = () => Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL)
