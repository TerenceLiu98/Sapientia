import { Redis } from "ioredis"
import { config } from "../config"

// BullMQ requires `maxRetriesPerRequest: null` on the connection it uses for
// blocking commands (XREAD, BLMOVE, etc). The HTTP-side Redis client in
// index.ts uses different settings because it serves user-facing requests.
export const queueConnection = new Redis(config.REDIS_URL, {
	maxRetriesPerRequest: null,
})
