import { createFileRoute, Navigate } from "@tanstack/react-router"
import { SignInForm } from "@/components/auth/SignInForm"
import { useSession } from "@/lib/auth-client"

export const Route = createFileRoute("/sign-in")({
	component: SignInPage,
})

function SignInPage() {
	const { data: session, isPending } = useSession()

	if (!isPending && session) {
		return <Navigate to="/" />
	}

	return <SignInForm />
}
