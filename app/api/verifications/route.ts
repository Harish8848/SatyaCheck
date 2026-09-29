import { NextResponse } from 'next/server'
import { createVerification, inputTypes, listVerifications, type InputType } from '@/lib/verification'

export const runtime = 'nodejs'

function isInputType(value: unknown): value is InputType {
  return typeof value === 'string' && inputTypes.includes(value as InputType)
}

export async function GET() {
  try {
    return NextResponse.json({ data: await listVerifications() })
  } catch (error) {
    console.error('Failed to list verifications:', error)
    return NextResponse.json({ error: 'Unable to load verification history.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Request body must be an object.' }, { status: 400 })
  }

  const payload = body as Record<string, unknown>
  const inputType = payload.inputType
  const inputText = payload.inputText
  const sourceName = payload.sourceName

  if (!isInputType(inputType)) {
    return NextResponse.json({ error: 'inputType must be text, image, video, or url.' }, { status: 400 })
  }
  if (inputText !== undefined && typeof inputText !== 'string') {
    return NextResponse.json({ error: 'inputText must be a string.' }, { status: 400 })
  }
  if (sourceName !== undefined && typeof sourceName !== 'string') {
    return NextResponse.json({ error: 'sourceName must be a string.' }, { status: 400 })
  }
  if (!inputText?.trim() && !sourceName?.trim()) {
    return NextResponse.json({ error: 'Provide inputText or sourceName.' }, { status: 400 })
  }

  try {
    const verification = await createVerification({
      inputType,
      inputText: inputText?.trim(),
      sourceName: sourceName?.trim(),
    })
    return NextResponse.json({ data: verification }, { status: 201 })
  } catch (error) {
    console.error(' Failed to create verification:', error)
    return NextResponse.json({ error: 'Unable to save verification.' }, { status: 500 })
  }
}
