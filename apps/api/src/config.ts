import { z } from "zod"

const ConfigSchema = z.object({
	NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
	PORT: z.coerce.number().default(3000),
	LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

	DATABASE_URL: z.string().url(),
	REDIS_URL: z.string().url().default("redis://localhost:6379"),

	S3_ENDPOINT: z.string().url(),
	S3_ACCESS_KEY_ID: z.string(),
	S3_SECRET_ACCESS_KEY: z.string(),
	S3_BUCKET: z.string().default("sapientia"),
	S3_REGION: z.string().default("us-east-1"),
	S3_FORCE_PATH_STYLE: z
		.string()
		.default("true")
		.transform((v) => v === "true"),
})

export type Config = z.infer<typeof ConfigSchema>

const result = ConfigSchema.safeParse(process.env)

if (!result.success) {
	console.error("❌ Invalid environment configuration:")
	console.error(result.error.flatten().fieldErrors)
	process.exit(1)
}

export const config: Config = result.data
