import { createMiddleware } from "hono/factory"
import { auth, type Session, type User } from "../auth"

export type AuthContext = {
	Variables: {
		user: User
		session: Session
	}
}

export const requireAuth = createMiddleware<AuthContext>(async (c, next) => {
	const session = await auth.api.getSession({
		headers: c.req.raw.headers,
	})

	if (!session) {
		return c.json({ error: "unauthorized" }, 401)
	}

	c.set("user", session.user)
	c.set("session", session.session)
	await next()
})
