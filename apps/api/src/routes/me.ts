import { Hono } from "hono"
import { type AuthContext, requireAuth } from "../middleware/auth"

export const meRoutes = new Hono<AuthContext>()

meRoutes.get("/me", requireAuth, (c) => {
	const user = c.get("user")
	return c.json({
		id: user.id,
		email: user.email,
		name: user.name,
		createdAt: user.createdAt,
	})
})
