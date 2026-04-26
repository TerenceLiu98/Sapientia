import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

export function createDbClient(url: string) {
	const queryClient = postgres(url, { max: 10 })
	return {
		db: drizzle(queryClient),
		close: () => queryClient.end(),
	}
}

export type Database = ReturnType<typeof createDbClient>["db"]
