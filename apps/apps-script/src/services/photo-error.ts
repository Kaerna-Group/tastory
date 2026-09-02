export class PhotoError extends Error {
  constructor(
    public readonly code:
      'PHOTO_INVALID' | 'PHOTO_EXISTS' | 'PHOTO_UNAVAILABLE' | 'PHOTO_NOT_PRIVATE',
  ) {
    super(code);
  }
}
