export function assertPrivateResource(
  item: GoogleAppsScript.Drive.File | GoogleAppsScript.Drive.Folder,
) {
  if (
    item.isTrashed() ||
    item.getSharingAccess() !== DriveApp.Access.PRIVATE ||
    item.getEditors().length ||
    item.getViewers().length ||
    item.getOwner()?.getEmail() !== Session.getEffectiveUser().getEmail()
  )
    throw new Error('RESOURCE_NOT_PRIVATE');
}
export function privateResourceFolder(id: string) {
  const folder = DriveApp.getFolderById(id);
  let current = folder;
  for (let depth = 0; depth < 20; depth++) {
    assertPrivateResource(current);
    const parents = current.getParents();
    if (!parents.hasNext()) return folder;
    current = parents.next();
    if (parents.hasNext()) throw new Error('RESOURCE_NOT_PRIVATE');
  }
  throw new Error('RESOURCE_NOT_PRIVATE');
}
export function fileInFolder(file: GoogleAppsScript.Drive.File, folderId: string) {
  assertPrivateResource(file);
  const parents = file.getParents();
  if (!parents.hasNext() || parents.next().getId() !== folderId || parents.hasNext())
    throw new Error('RESOURCE_NOT_PRIVATE');
  return file;
}
export function bytesDigest(bytes: number[]) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
    .map((byte) => (byte & 255).toString(16).padStart(2, '0'))
    .join('');
}
