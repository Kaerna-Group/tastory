import { z } from 'zod';
import { adminUsersDataSchema, adminHealthDataSchema } from './admin';
import { journalDataSchema } from './journal';
import { photoUploadSchema, photoDataSchema } from './photo';
import {
  concurrencyReadSchema,
  concurrencyWriteSchema,
  concurrencyDataSchema,
} from './concurrency';

export const API_VERSION = 1;
export const SCHEMA_VERSION = 0;

const requestFields = {
  apiVersion: z.literal(API_VERSION),
  requestId: z.uuid(),
};

export const apiRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({
    ...requestFields,
    action: z.literal('admin.operations.list'),
    credential: z.string().min(1).max(6144),
    payload: z.strictObject({}),
  }),
  z.strictObject({
    ...requestFields,
    action: z.literal('admin.operations.initialize'),
    credential: z.string().min(1).max(6144),
    payload: z.strictObject({}),
  }),
  z.strictObject({
    ...requestFields,
    action: z.literal('admin.operations.check'),
    credential: z.string().min(1).max(6144),
    payload: z.strictObject({}),
  }),
  z.strictObject({
    ...requestFields,
    action: z.literal('admin.users.list'),
    credential: z.string().min(1).max(6144),
    payload: z.strictObject({}),
  }),
  z.strictObject({
    ...requestFields,
    action: z.literal('admin.health'),
    credential: z.string().min(1).max(6144),
    payload: z.strictObject({}),
  }),
  z.strictObject({
    ...requestFields,
    action: z.literal('spike.concurrency.read'),
    credential: z.string().min(1).max(6144),
    payload: concurrencyReadSchema,
  }),
  z.strictObject({
    ...requestFields,
    action: z.literal('spike.concurrency.write'),
    credential: z.string().min(1).max(6144),
    payload: concurrencyWriteSchema,
  }),
  z.strictObject({ ...requestFields, action: z.literal('health'), payload: z.strictObject({}) }),
  z.strictObject({
    ...requestFields,
    action: z.literal('echo'),
    payload: z.strictObject({ message: z.string().max(1024) }),
  }),
  z.strictObject({
    ...requestFields,
    action: z.literal('auth.signIn'),
    credential: z.string().min(1).max(6144),
    payload: z.strictObject({}),
  }),
  z.strictObject({
    ...requestFields,
    action: z.literal('auth.me'),
    credential: z.string().min(1).max(6144),
    payload: z.strictObject({}),
  }),
  z.strictObject({
    ...requestFields,
    action: z.literal('spike.photo.upload'),
    credential: z.string().min(1).max(6144),
    payload: photoUploadSchema,
  }),
  z.strictObject({
    ...requestFields,
    action: z.literal('spike.photo.read'),
    credential: z.string().min(1).max(6144),
    payload: z.strictObject({}),
  }),
  z.strictObject({
    ...requestFields,
    action: z.literal('spike.photo.delete'),
    credential: z.string().min(1).max(6144),
    payload: z.strictObject({ id: z.uuid() }),
  }),
]);

export const apiErrorSchema = z.strictObject({
  ok: z.literal(false),
  requestId: z.uuid(),
  error: z.strictObject({
    code: z.enum([
      'INVALID_REQUEST',
      'ACTION_DISABLED',
      'INTERNAL_ERROR',
      'AUTH_NOT_CONFIGURED',
      'UNAUTHENTICATED',
      'ACCESS_DENIED',
      'AUTH_UNAVAILABLE',
      'PHOTO_INVALID',
      'PHOTO_EXISTS',
      'PHOTO_UNAVAILABLE',
      'PHOTO_NOT_PRIVATE',
      'PROBE_UNAVAILABLE',
      'PROBE_LIMIT',
      'OPERATION_MISMATCH',
      'ADMIN_UNAVAILABLE',
      'JOURNAL_NOT_READY',
      'JOURNAL_UNAVAILABLE',
      'JOURNAL_LIMIT',
    ]),
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
  auth: z.enum(['not-configured', 'staging']),
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

export const authDataSchema = z.strictObject({
  user: z.strictObject({
    id: z.string().min(1).max(255),
    email: z.email().max(254),
    name: z.string().min(1).max(254),
    role: z.enum(['owner', 'member', 'viewer']),
  }),
  expiresAt: z.iso.datetime(),
});
export const authResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    requestId: z.uuid(),
    data: authDataSchema,
    meta: responseMetaSchema,
  }),
  apiErrorSchema,
]);
export type AuthData = z.infer<typeof authDataSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
export const photoResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    requestId: z.uuid(),
    data: photoDataSchema,
    meta: responseMetaSchema,
  }),
  apiErrorSchema,
]);
export type PhotoResponse = z.infer<typeof photoResponseSchema>;
export const concurrencyResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    requestId: z.uuid(),
    data: concurrencyDataSchema,
    meta: responseMetaSchema,
  }),
  apiErrorSchema,
]);
export type ConcurrencyResponse = z.infer<typeof concurrencyResponseSchema>;

export const adminUsersResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    requestId: z.uuid(),
    data: adminUsersDataSchema,
    meta: responseMetaSchema,
  }),
  apiErrorSchema,
]);
export const adminHealthResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    requestId: z.uuid(),
    data: adminHealthDataSchema,
    meta: responseMetaSchema,
  }),
  apiErrorSchema,
]);
export type AdminResponse =
  z.infer<typeof adminUsersResponseSchema> | z.infer<typeof adminHealthResponseSchema>;

export const journalResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    requestId: z.uuid(),
    data: journalDataSchema,
    meta: responseMetaSchema,
  }),
  apiErrorSchema,
]);
export type JournalResponse = z.infer<typeof journalResponseSchema>;
