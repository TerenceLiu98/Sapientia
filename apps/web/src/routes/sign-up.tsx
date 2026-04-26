import { createFileRoute, Navigate } from "@tanstack/react-router"
import { SignUpForm } from "@/components/auth/SignUpForm"
import { useSession } from "@/lib/auth-client"

export const Route = createFileRoute("/sign-up")({
	component: SignUpPage,
})

function SignUpPage() {
	const { data: session, isPending } = useSession()

	if (!isPending && session) {
		return <Navigate to="/" />
	}

	return <SignUpForm />
}
