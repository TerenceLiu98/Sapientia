import { Hono } from "hono"
import { config } from "../config"

export const authProvidersRoutes = new Hono()

// Public — frontend uses this to decide whether to render OAuth buttons.
authProvidersRoutes.get("/auth-providers", (c) => {
	return c.json({
		emailAndPassword: true,
		google: Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
		github: Boolean(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET),
	})
})
