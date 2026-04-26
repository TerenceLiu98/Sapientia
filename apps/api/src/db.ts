import { createDbClient, type Database } from "@sapientia/db"
import { config } from "./config"

const client = createDbClient(config.DATABASE_URL)

export const db: Database = client.db
export const closeDb = client.close
