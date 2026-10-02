import { z } from 'zod'

// tsx does not load Next.js env files automatically. Load .env.local first,
// then .env, without replacing variables already provided by the shell.
for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(file)
  } catch {
    /* optional env file */
  }
}

const schema = z.object({
  verdict: z.enum(['verified', 'likely_false']),
  confidence: z.number().int().min(0).max(100),
  reason: z.string(),
})

async function main() {
  // Import after environment loading because config.ts reads settings on import.
  const { generateStructured } = await import('../lib/core/model')
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
