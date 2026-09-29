/** Runtime configuration, validated once per cold start with safe fallbacks. */

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const config = {
  /** Models tried in order. First entry is the primary analyst. */
  analystModels: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-2.5-flash'],
  /** Cheaper model used for high-volume, low-judgement work (query planning). */
  plannerModel: 'gemini-3.5-flash-lite',
  /** Vision / multimodal model for media inspection. */
  visionModels: ['gemini-3.8-flash', 'gemini-2.5-flash'],

  /** Per-request timeouts for third-party research providers. */
  providerTimeoutMs: intEnv('RESEARCH_PROVIDER_TIMEOUT_MS', 8000),
  /** Cap on how much page text we hand to the model. */
  maxContextChars: intEnv('SATYACHECK_MAX_CONTEXT_CHARS', 120_000),
  /** Research sources retained after ranking. */
  maxEvidenceItems: intEnv('SATYACHECK_MAX_EVIDENCE', 12),
  /** Maximum claims analysed per submission; the rest are listed but not checked. */
  maxClaims: intEnv('SATYACHECK_MAX_CLAIMS', 5),
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

export const hasGeminiKey = () => Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY)
export const hasDatabase = () => Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL)
