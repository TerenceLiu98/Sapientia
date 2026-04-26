import { createDbClient } from "@sapientia/db"
import { sql } from "drizzle-orm"
import { Hono } from "hono"
import { Redis } from "ioredis"
import { auth } from "./auth"
import { config } from "./config"
import { logger as appLogger } from "./logger"
import { meRoutes } from "./routes/me"
import { paperRoutes } from "./routes/papers"
import { workspaceRoutes } from "./routes/workspaces"
import { checkS3Health } from "./services/s3-client"

const { db, close: closeDb } = createDbClient(config.DATABASE_URL)
const redis = new Redis(config.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 1 })

redis.on("error", (err) => {
	appLogger.warn({ err: err.message }, "redis_connection_error")
})

export const app = new Hono()

// better-auth handles all auth routes (sign-up, sign-in, sign-out, OAuth callbacks, etc.)
app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw))

app.get("/health", async (c) => {
	const checks = await Promise.allSettled([
		db.execute(sql`SELECT 1`),
		redis.ping(),
		checkS3Health(),
	])

	const dbOk = checks[0].status === "fulfilled"
	const redisOk = checks[1].status === "fulfilled"
	const s3Ok = checks[2].status === "fulfilled" && checks[2].value === true

	const allOk = dbOk && redisOk && s3Ok

	return c.json(
		{
			status: allOk ? "ok" : "degraded",
			db: dbOk ? "connected" : "error",
			redis: redisOk ? "connected" : "error",
			s3: s3Ok ? "connected" : "error",
		},
		allOk ? 200 : 503,
	)
})

app.route("/api/v1", meRoutes)
app.route("/api/v1", paperRoutes)
app.route("/api/v1", workspaceRoutes)

appLogger.info({ port: config.PORT, env: config.NODE_ENV }, "api_starting")

const shutdown = async () => {
	appLogger.info("api_shutdown_initiated")
	await closeDb()
	await redis.quit()
	process.exit(0)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

export default {
	port: config.PORT,
	fetch: app.fetch,
}
