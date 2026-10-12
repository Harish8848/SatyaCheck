/** Fixed, safe provider diagnostics; never expose response bodies or submitted queries. */
export class ResearchProviderError extends Error {
  constructor(readonly publicMessage: string, readonly statusCode?: number) {
    super(publicMessage)
    this.name = 'ResearchProviderError'
  }
}
