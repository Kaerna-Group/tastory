export class JournalError extends Error {
  constructor(
    public readonly code:
      | 'JOURNAL_NOT_READY'
      | 'JOURNAL_UNAVAILABLE'
      | 'JOURNAL_LIMIT'
      | 'OPERATION_MISMATCH' = 'JOURNAL_UNAVAILABLE',
  ) {
    super(code);
  }
}
