/** An error whose message is safe and useful to show to the end user verbatim. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserFacingError'
  }
}
