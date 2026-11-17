import { z } from 'zod'

export const assistantId = z.uuid()
export const modelId = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[^\s\u0000-\u001f\u007f]+$/u)
export const limitsSchema = z.strictObject({
  steps: z.int().min(1).max(1000),
  modelTimeoutSeconds: z.int().min(5).max(300),
})
export const assistantPromptSchema = z
  .string()
  .min(1)
  .max(32000)
  .refine((value) => value.trim().length > 0)
  .nullable()
export const providerConnectionSchema = z.strictObject({
  id: assistantId.optional(),
  baseUrl: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .url()
    .refine((value) => {
      try {
        const url = new URL(value)
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
      } catch {
        return false
      }
    }),
  apiKey: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .regex(/^[!-~]+$/)
    .nullable()
    .optional(),
})
export const providerInputSchema = providerConnectionSchema
  .extend({
    name: z.string().trim().min(1).max(100),
    models: z.array(modelId).min(1).max(500),
    defaultModel: modelId,
  })
  .refine((value) => value.models.includes(value.defaultModel))
