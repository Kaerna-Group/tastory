import { z } from 'zod';

export const API_VERSION = 1;
export const SCHEMA_VERSION = 0;

const requestFields = {
  apiVersion: z.literal(API_VERSION),
  requestId: z.uuid(),
};

export const apiRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...requestFields, action: z.literal('health'), payload: z.strictObject({}) }),
  z.strictObject({
    ...requestFields,
    action: z.literal('echo'),
    payload: z.strictObject({ message: z.string().max(1024) }),
  }),
]);

export const apiErrorSchema = z.strictObject({
  ok: z.literal(false),
  requestId: z.uuid(),
  error: z.strictObject({
    code: z.enum(['INVALID_REQUEST', 'ACTION_DISABLED', 'INTERNAL_ERROR']),
    message: z.string(),
  }),
});

export const responseMetaSchema = z.strictObject({
  apiVersion: z.literal(API_VERSION),
  schemaVersion: z.literal(SCHEMA_VERSION),
});

export const healthDataSchema = z.strictObject({
  status: z.literal('ok'),
  service: z.literal('tastory-api'),
  deploymentVersion: z.string().min(1),
  timestamp: z.iso.datetime(),
  storage: z.literal('not-configured'),
  auth: z.literal('not-configured'),
});

export const healthResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    requestId: z.uuid(),
    data: healthDataSchema,
    meta: responseMetaSchema,
  }),
  apiErrorSchema,
]);

export const echoResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    requestId: z.uuid(),
    data: z.strictObject({ message: z.string().max(1024) }),
    meta: responseMetaSchema,
  }),
  apiErrorSchema,
]);

export type ApiRequest = z.infer<typeof apiRequestSchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorSchema>;
export type HealthData = z.infer<typeof healthDataSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type EchoResponse = z.infer<typeof echoResponseSchema>;
