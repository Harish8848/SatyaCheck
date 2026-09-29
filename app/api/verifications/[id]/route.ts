import { NextResponse } from 'next/server'
import { getVerification } from '@/lib/verification'

export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Invalid verification id.' }, { status: 400 })
  try {
    const verification = await getVerification(id)
    if (!verification) return NextResponse.json({ error: 'Verification not found.' }, { status: 404 })
    return NextResponse.json({ data: verification })
  } catch (error) {
    console.error('Failed to load verification:', error)
    return NextResponse.json({ error: 'Unable to load verification.' }, { status: 500 })
  }
}
