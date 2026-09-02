import { API_VERSION } from '@tastory/contracts';
import { handlePostBody, handleRequest } from '../controllers/handle-request';
import { createRequestContext } from '../platform/request-context';

function jsonOutput(value: unknown): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

export function doGet(): GoogleAppsScript.Content.TextOutput {
  const context = createRequestContext();
  return jsonOutput(
    handleRequest(
      {
        apiVersion: API_VERSION,
        requestId: context.createRequestId(),
        action: 'health',
        payload: {},
      },
      context,
    ),
  );
}

export function doPost(event: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  return jsonOutput(handlePostBody(event.postData?.contents ?? '', createRequestContext()));
}
