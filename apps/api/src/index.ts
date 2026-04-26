import { createDbClient } from "@sapientia/db"
import { sql } from "drizzle-orm"
import { Hono } from "hono"
import { Redis } from "ioredis"
import { config } from "./config"
import { logger as appLogger } from "./logger"
import { checkS3Health } from "./services/s3-client"

const { db, close: closeDb } = createDbClient(config.DATABASE_URL)
const redis = new Redis(config.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 1 })

redis.on("error", (err) => {
	appLogger.warn({ err: err.message }, "redis_connection_error")
})

const app = new Hono()

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
