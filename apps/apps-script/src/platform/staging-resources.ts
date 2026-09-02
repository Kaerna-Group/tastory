import type { StagingSetupPlatform } from '../services/setup-staging';

export function createStagingSetupPlatform(): StagingSetupPlatform {
  const properties = PropertiesService.getScriptProperties();
  return {
    readProperties: () => properties.getProperties(),
    saveProperty: (key, value) => {
      properties.setProperty(key, value);
    },
    createSpreadsheet: () => {
      const spreadsheet = SpreadsheetApp.create('Tastory - Staging DB');
      return { id: spreadsheet.getId(), url: spreadsheet.getUrl() };
    },
    openSpreadsheet: (id) => {
      const spreadsheet = SpreadsheetApp.openById(id);
      return { id: spreadsheet.getId(), url: spreadsheet.getUrl() };
    },
    createAssetFolder: () => {
      const folder = DriveApp.createFolder('Tastory - Staging Assets');
      return { id: folder.getId(), url: folder.getUrl() };
    },
    openAssetFolder: (id) => {
      const folder = DriveApp.getFolderById(id);
      return { id: folder.getId(), url: folder.getUrl() };
    },
  };
}
