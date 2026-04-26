import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { UploadDropzone } from "./UploadDropzone"

function makeWrapper() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	})
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	)
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe("UploadDropzone", () => {
	it("renders the click-or-drop prompt by default", () => {
		const Wrapper = makeWrapper()
		render(
			<Wrapper>
				<UploadDropzone workspaceId="ws-1" />
			</Wrapper>,
		)

		expect(screen.getByText(/drop a pdf here/i)).toBeInTheDocument()
		expect(screen.getByText(/max 50 mb/i)).toBeInTheDocument()
	})

	it("rejects non-PDF files with a visible error", async () => {
		const Wrapper = makeWrapper()
		render(
			<Wrapper>
				<UploadDropzone workspaceId="ws-1" />
			</Wrapper>,
		)

		const input = document.querySelector('input[type="file"]') as HTMLInputElement
		const txtFile = new File(["not a pdf"], "notes.txt", { type: "text/plain" })
		// fireEvent.change bypasses both userEvent's accept filter and the
		// pseudo-async file system access path, which is what react-dropzone
		// relies on to validate against its `accept` config.
		Object.defineProperty(input, "files", { value: [txtFile], configurable: true })
		fireEvent.change(input)

		await waitFor(
			() => {
				const errorMatch = screen.queryByText(/file type|invalid|rejected/i)
				expect(errorMatch).not.toBeNull()
			},
			{ timeout: 3000 },
		)
	})

	it("rejects oversized PDFs (>50 MB) with a visible error", async () => {
		const user = userEvent.setup()
		const Wrapper = makeWrapper()
		render(
			<Wrapper>
				<UploadDropzone workspaceId="ws-1" />
			</Wrapper>,
		)

		const input = document.querySelector('input[type="file"]') as HTMLInputElement
		const largePdf = new File([new Uint8Array(51 * 1024 * 1024)], "huge.pdf", {
			type: "application/pdf",
		})
		await user.upload(input, largePdf)

		await waitFor(() => {
			expect(screen.getByText(/larger than/i)).toBeInTheDocument()
		})
	})
})
