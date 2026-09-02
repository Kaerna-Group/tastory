import { invitationsSchema } from '../auth/invitations';

// Editor-only setup, never routed by doPost. Existing bindings/invites are preserved.
export function setupStagingAuth() {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty('APP_ENV') !== 'staging') throw new Error('Требуется staging-проект.');
  const ids = (properties.getProperty('GOOGLE_CLIENT_IDS') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (!ids.length || ids.some((id) => !/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)))
    throw new Error('Сначала задайте GOOGLE_CLIENT_IDS в свойствах скрипта.');
  const ownerEmail = Session.getEffectiveUser().getEmail().toLowerCase();
  if (!ownerEmail) throw new Error('Запустите настройку от имени владельца скрипта.');
  // Forces the owner to authorize external_request and proves the fixed key endpoint is reachable.
  const response = UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v3/certs', {
    muteHttpExceptions: true,
    followRedirects: false,
  });
  if (response.getResponseCode() !== 200) throw new Error('Ключи Google временно недоступны.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('Настройка занята. Повторите позже.');
  try {
    const previous = properties.getProperty('STAGING_INVITES');
    const invites = invitationsSchema.parse(
      previous
        ? JSON.parse(previous)
        : [
            {
              email: ownerEmail,
              role: 'owner',
              expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
            },
          ],
    );
    if (!previous) properties.setProperty('STAGING_INVITES', JSON.stringify(invites));
    console.info(
      'Staging auth настроен. Приглашений: ' +
        invites.length +
        '. Откройте Tastory → Настройки → Ваш аккаунт.',
    );
    return { configured: true, invitations: invites.length };
  } finally {
    lock.releaseLock();
  }
}
