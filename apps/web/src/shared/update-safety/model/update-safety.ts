const blockers = new Set<string>();

export function setReloadBlocked(reason: string, blocked: boolean): void {
  if (blocked) blockers.add(reason);
  else blockers.delete(reason);
}

export function getReloadBlockers(): string[] {
  return [...blockers];
}
