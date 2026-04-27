import { Hono } from "hono"
import { z } from "zod"
import { type AuthContext, requireAuth } from "../middleware/auth"
import { getCredentialsStatus, updateCredentials } from "../services/credentials"

const UpdateCredentialsSchema = z.object({
	mineruToken: z.string().nullable().optional(),
	llmProvider: z.enum(["anthropic", "openai"]).nullable().optional(),
	llmApiKey: z.string().nullable().optional(),
})

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

meRoutes.get("/me/credentials/status", requireAuth, async (c) => {
	const user = c.get("user")
	return c.json(await getCredentialsStatus(user.id))
})

meRoutes.patch("/me/credentials", requireAuth, async (c) => {
	const user = c.get("user")
	const body = UpdateCredentialsSchema.safeParse(await c.req.json())
	if (!body.success) {
		return c.json({ error: "invalid body", issues: body.error.flatten().fieldErrors }, 400)
	}
	await updateCredentials(user.id, body.data)
	return c.json({ ok: true })
})
