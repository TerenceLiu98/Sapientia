import { useEffect, useState } from "react"

export type AuthProviders = {
	emailAndPassword: boolean
	google: boolean
	github: boolean
}

const DEFAULT_PROVIDERS: AuthProviders = {
	emailAndPassword: true,
	google: false,
	github: false,
}

export function useAuthProviders(): AuthProviders {
	const [providers, setProviders] = useState<AuthProviders>(DEFAULT_PROVIDERS)

	useEffect(() => {
		let cancelled = false
		fetch("/api/v1/auth-providers")
			.then((res) => (res.ok ? (res.json() as Promise<AuthProviders>) : DEFAULT_PROVIDERS))
			.then((data) => {
				if (!cancelled) setProviders(data)
			})
			.catch(() => {
				// Endpoint missing or backend offline — keep email-only fallback.
			})
		return () => {
			cancelled = true
		}
	}, [])

	return providers
}
