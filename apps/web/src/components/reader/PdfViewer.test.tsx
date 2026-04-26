import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const refetchMock = vi.fn()
const usePaperPdfUrlMock = vi.fn()

vi.mock("@/api/hooks/papers", () => ({
	usePaperPdfUrl: (...args: Array<unknown>) => usePaperPdfUrlMock(...args),
}))

vi.mock("react-pdf", () => ({
	Document: ({
		children,
		onLoadSuccess,
	}: {
		children?: ReactNode
		onLoadSuccess?: (info: { numPages: number }) => void
	}) => {
		// Trigger numPages discovery synchronously so the page list renders.
		queueMicrotask(() => onLoadSuccess?.({ numPages: 3 }))
		return <div data-testid="pdf-document">{children}</div>
	},
	Page: ({ pageNumber, scale }: { pageNumber: number; scale: number }) => (
		<div data-testid={`pdf-page-${pageNumber}`} data-scale={scale}>
			page {pageNumber}
		</div>
	),
}))

function makeWrapper() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	)
}

beforeEach(async () => {
	refetchMock.mockReset()
	usePaperPdfUrlMock.mockReset()
})

afterEach(() => {
	vi.clearAllMocks()
})

async function importPdfViewer() {
	const mod = await import("./PdfViewer")
	return mod.PdfViewer
}

describe("PdfViewer", () => {
	it("renders the loading state while the URL hook is pending", async () => {
		usePaperPdfUrlMock.mockReturnValue({
			data: undefined,
			isLoading: true,
			isError: false,
			refetch: refetchMock,
		})
		const PdfViewer = await importPdfViewer()
		const Wrapper = makeWrapper()

		render(
			<Wrapper>
				<PdfViewer paperId="paper-1" />
			</Wrapper>,
		)

		expect(screen.getByText(/loading pdf/i)).toBeInTheDocument()
	})

	it("renders an error with retry when the URL hook fails", async () => {
		usePaperPdfUrlMock.mockReturnValue({
			data: undefined,
			isLoading: false,
			isError: true,
			refetch: refetchMock,
		})
		const PdfViewer = await importPdfViewer()
		const Wrapper = makeWrapper()
		const user = userEvent.setup()

		render(
			<Wrapper>
				<PdfViewer paperId="paper-1" />
			</Wrapper>,
		)

		expect(screen.getByText(/failed to load pdf/i)).toBeInTheDocument()
		const retry = screen.getByRole("button", { name: /retry/i })
		await user.click(retry)
		expect(refetchMock).toHaveBeenCalledTimes(1)
	})

	it("renders document + zoom controls when URL is available", async () => {
		usePaperPdfUrlMock.mockReturnValue({
			data: { url: "http://test/pdf", expiresInSeconds: 3600 },
			isLoading: false,
			isError: false,
			refetch: refetchMock,
		})
		const PdfViewer = await importPdfViewer()
		const Wrapper = makeWrapper()
		const user = userEvent.setup()

		render(
			<Wrapper>
				<PdfViewer paperId="paper-1" />
			</Wrapper>,
		)

		expect(screen.getByTestId("pdf-document")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /zoom in/i })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /zoom out/i })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /fit width/i })).toBeInTheDocument()

		// 100% → 110% on click of "+"
		expect(screen.getByText("100%")).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: /zoom in/i }))
		expect(screen.getByText("110%")).toBeInTheDocument()

		// "Fit" jumps to 140%
		await user.click(screen.getByRole("button", { name: /fit width/i }))
		expect(screen.getByText("140%")).toBeInTheDocument()
	})
})
