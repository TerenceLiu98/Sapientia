import { z } from "zod"

export const ConfigSchema = z
	.object({
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

		BETTER_AUTH_SECRET: z.string().min(32),
		BETTER_AUTH_URL: z.string().url(),
		FRONTEND_ORIGIN: z.string().url().default("http://localhost:5173"),

		GOOGLE_CLIENT_ID: z.string().optional(),
		GOOGLE_CLIENT_SECRET: z.string().optional(),
		GITHUB_CLIENT_ID: z.string().optional(),
		GITHUB_CLIENT_SECRET: z.string().optional(),
	})
	.refine(
		(data) =>
			(!data.GOOGLE_CLIENT_ID && !data.GOOGLE_CLIENT_SECRET) ||
			(data.GOOGLE_CLIENT_ID && data.GOOGLE_CLIENT_SECRET),
		{ message: "Both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together" },
	)
	.refine(
		(data) =>
			(!data.GITHUB_CLIENT_ID && !data.GITHUB_CLIENT_SECRET) ||
			(data.GITHUB_CLIENT_ID && data.GITHUB_CLIENT_SECRET),
		{ message: "Both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set together" },
	)

export type Config = z.infer<typeof ConfigSchema>

export function parseConfig(env: NodeJS.ProcessEnv): Config {
	const result = ConfigSchema.safeParse(env)
	if (!result.success) {
		throw result.error
	}

	return result.data
}

let parsedConfig: Config

try {
	parsedConfig = parseConfig(process.env)
} catch (error) {
	console.error("Invalid environment configuration:")
	if (error instanceof z.ZodError) {
		console.error(error.flatten().fieldErrors)
	} else {
		console.error(error)
	}
	process.exit(1)
}

export const config: Config = parsedConfig!
