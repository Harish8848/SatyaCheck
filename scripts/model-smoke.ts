import { z } from 'zod'
import { generateStructured } from '../lib/core/model'

// tsx does not load .env on its own; the Next.js runtime does this for app code.
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  try {
    process.loadEnvFile('.env')
  } catch {
    /* env comes from the shell or the hosting platform */
  }
}

const schema = z.object({
  verdict: z.enum(['verified', 'likely_false']),
  confidence: z.number().int().min(0).max(100),
  reason: z.string(),
})

async function main() {
  const started = Date.now()
  const r = await generateStructured({
    label: 'smoke',
    schema,
    system: 'You are a careful analyst.',
    prompt: 'Classify: "The Earth orbits the Sun." Return verdict verified if supported by overwhelming evidence.',
  })
  console.log('TEXT OK', JSON.stringify(r.output), 'model=', r.model, `elapsed=${Date.now() - started}ms`)
}

main().catch((error) => {
  console.error('SMOKE FAILED', error)
  process.exit(1)
})
