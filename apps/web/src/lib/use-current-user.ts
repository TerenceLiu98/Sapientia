import { useSession } from "./auth-client"

export function useCurrentUser() {
	const { data: session, isPending } = useSession()

	if (isPending) {
		return { isPending: true } as const
	}

	if (!session) {
		throw new Error("useCurrentUser called outside ProtectedRoute")
	}

	return { isPending: false, user: session.user } as const
}
