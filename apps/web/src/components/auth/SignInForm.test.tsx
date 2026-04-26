import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SignInForm } from "./SignInForm"

const navigateMock = vi.fn()
const signInEmailMock = vi.fn()
const signInSocialMock = vi.fn()

vi.mock("@/lib/auth-client", () => ({
	signIn: {
		email: (...args: Array<unknown>) => signInEmailMock(...args),
		social: (...args: Array<unknown>) => signInSocialMock(...args),
	},
	useSession: () => ({
		data: null,
		isPending: false,
	}),
}))

vi.mock("@tanstack/react-router", async () => {
	const actual =
		await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router")

	return {
		...actual,
		Link: ({
			children,
			to,
			className,
		}: {
			children: ReactNode
			to: string
			className?: string
		}) => (
			<a className={className} href={to}>
				{children}
			</a>
		),
		useNavigate: () => navigateMock,
	}
})

describe("SignInForm", () => {
	beforeEach(() => {
		navigateMock.mockReset()
		signInEmailMock.mockReset()
		signInSocialMock.mockReset()
		signInEmailMock.mockResolvedValue({ error: null })
	})

	it("renders and submits credentials through better-auth", async () => {
		const user = userEvent.setup()
		render(<SignInForm />)

		await user.type(screen.getByLabelText("Email"), "reader@example.com")
		await user.type(screen.getByLabelText("Password"), "secret-password")
		await user.click(screen.getByRole("button", { name: "Sign in" }))

		expect(signInEmailMock).toHaveBeenCalledWith({
			email: "reader@example.com",
			password: "secret-password",
		})
		expect(navigateMock).toHaveBeenCalledWith({ to: "/" })
	})
})
