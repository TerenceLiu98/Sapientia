import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ProtectedRoute } from "./ProtectedRoute"

const useSessionMock = vi.fn()

vi.mock("@/lib/auth-client", () => ({
	useSession: () => useSessionMock(),
}))

vi.mock("@tanstack/react-router", () => ({
	Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
}))

describe("ProtectedRoute", () => {
	beforeEach(() => {
		useSessionMock.mockReset()
	})

	it("redirects unauthenticated users to sign-in", () => {
		useSessionMock.mockReturnValue({
			data: null,
			isPending: false,
		})

		render(
			<ProtectedRoute>
				<div>Protected content</div>
			</ProtectedRoute>,
		)

		expect(screen.getByTestId("navigate")).toHaveTextContent("/sign-in")
	})

	it("renders children for authenticated users", () => {
		useSessionMock.mockReturnValue({
			data: {
				user: {
					email: "reader@example.com",
				},
			},
			isPending: false,
		})

		render(
			<ProtectedRoute>
				<div>Protected content</div>
			</ProtectedRoute>,
		)

		expect(screen.getByText("Protected content")).toBeInTheDocument()
	})
})
