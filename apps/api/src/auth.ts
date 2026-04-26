import * as schema from "@sapientia/db"
import { createDbClient } from "@sapientia/db"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { config } from "./config"
import { logger } from "./logger"
import { ensurePersonalWorkspace } from "./services/workspace"

const { db } = createDbClient(config.DATABASE_URL)

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "pg",
		schema,
	}),
	secret: config.BETTER_AUTH_SECRET,
	baseURL: config.BETTER_AUTH_URL,
	trustedOrigins: [...new Set([config.BETTER_AUTH_URL, config.FRONTEND_ORIGIN])],

	emailAndPassword: {
		enabled: true,
		requireEmailVerification: false,
	},

	socialProviders: {
		...(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
			? {
					google: {
						clientId: config.GOOGLE_CLIENT_ID,
						clientSecret: config.GOOGLE_CLIENT_SECRET,
					},
				}
			: {}),
		...(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET
			? {
					github: {
						clientId: config.GITHUB_CLIENT_ID,
						clientSecret: config.GITHUB_CLIENT_SECRET,
					},
				}
			: {}),
	},

	databaseHooks: {
		user: {
			create: {
				after: async (user) => {
					try {
						await ensurePersonalWorkspace(user.id, db)
						logger.info({ userId: user.id }, "personal_workspace_created")
					} catch (error) {
						logger.error({ userId: user.id, err: error }, "personal_workspace_creation_failed")
					}
				},
			},
		},
	},

	session: {
		cookieCache: {
			enabled: true,
			maxAge: 5 * 60,
		},
	},
})

export type Session = typeof auth.$Infer.Session.session
export type User = typeof auth.$Infer.Session.user
