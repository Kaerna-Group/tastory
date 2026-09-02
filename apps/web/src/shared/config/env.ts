type AppEnvironment = 'local' | 'staging' | 'production';
type ApiMode = 'mock' | 'apps-script';
const environment: unknown = import.meta.env['VITE_APP_ENV'] || 'local';
const apiMode: unknown = import.meta.env['VITE_API_MODE'] || 'mock';
if (environment !== 'local' && environment !== 'staging' && environment !== 'production')
  throw new Error('Неизвестное окружение приложения.');
if (apiMode !== 'mock' && apiMode !== 'apps-script') throw new Error('Неизвестный режим API.');
const apiUrl: string = import.meta.env['VITE_API_URL'] || '';
if (
  apiMode === 'apps-script' &&
  !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(apiUrl)
)
  throw new Error('Укажите корректный VITE_API_URL.');
if (environment !== 'local' && apiMode === 'mock')
  throw new Error('Mock API разрешен только локально.');
const googleClientId: string = import.meta.env['VITE_GOOGLE_CLIENT_ID'] || '';
if (googleClientId && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(googleClientId))
  throw new Error('Укажите корректный VITE_GOOGLE_CLIENT_ID.');
export const env: Readonly<{
  environment: AppEnvironment;
  apiMode: ApiMode;
  apiUrl: string;
  googleClientId: string;
}> = {
  environment,
  apiMode,
  apiUrl,
  googleClientId,
};
