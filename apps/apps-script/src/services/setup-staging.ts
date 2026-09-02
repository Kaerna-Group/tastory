export type StagingResource = Readonly<{ id: string; url: string }>;

export type StagingSetupPlatform = Readonly<{
  readProperties: () => Readonly<Record<string, string>>;
  saveProperty: (key: string, value: string) => void;
  createSpreadsheet: () => StagingResource;
  openSpreadsheet: (id: string) => StagingResource;
  createAssetFolder: () => StagingResource;
  openAssetFolder: (id: string) => StagingResource;
}>;

export type StagingSetupResult = Readonly<{
  environment: 'staging';
  spreadsheetUrl: string;
  assetFolderUrl: string;
  created: Readonly<{ spreadsheet: boolean; assetFolder: boolean }>;
  schemaVersion: 0;
}>;

export function setupStagingResources(platform: StagingSetupPlatform): StagingSetupResult {
  const properties = platform.readProperties();
  const environment = properties['APP_ENV'];
  if (environment && environment !== 'staging') {
    throw new Error('Setup разрешён только для staging. Существующее окружение не изменено.');
  }
  if (!environment && (properties['SPREADSHEET_ID'] || properties['DRIVE_FOLDER_ID'])) {
    throw new Error('Найдены ресурсы без метки окружения. Проверьте их перед настройкой staging.');
  }
  platform.saveProperty('APP_ENV', 'staging');

  const spreadsheetId = properties['SPREADSHEET_ID'];
  const spreadsheet = spreadsheetId
    ? platform.openSpreadsheet(spreadsheetId)
    : platform.createSpreadsheet();
  if (!spreadsheetId) platform.saveProperty('SPREADSHEET_ID', spreadsheet.id);

  const folderId = properties['DRIVE_FOLDER_ID'];
  const folder = folderId ? platform.openAssetFolder(folderId) : platform.createAssetFolder();
  if (!folderId) platform.saveProperty('DRIVE_FOLDER_ID', folder.id);

  if (!properties['DEPLOYMENT_VERSION']) {
    platform.saveProperty('DEPLOYMENT_VERSION', 'staging-foundation');
  }
  // Echo включается владельцем отдельно: повторная настройка не меняет его выбор.
  if (!properties['ENABLE_SPIKE_ECHO']) platform.saveProperty('ENABLE_SPIKE_ECHO', 'false');

  return {
    environment: 'staging',
    spreadsheetUrl: spreadsheet.url,
    assetFolderUrl: folder.url,
    created: { spreadsheet: !spreadsheetId, assetFolder: !folderId },
    schemaVersion: 0,
  };
}
