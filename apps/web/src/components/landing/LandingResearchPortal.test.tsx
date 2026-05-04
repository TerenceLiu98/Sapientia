import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { LandingResearchPortal } from "./LandingResearchPortal"
import type { PaperStarItem } from "./PaperStarfieldCanvas"

const navigateMock = vi.fn()
const useCurrentWorkspaceMock = vi.fn()
const usePapersMock = vi.fn()
const useSessionMock = vi.fn()

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateMock,
}))

vi.mock("@/api/hooks/workspaces", () => ({
	useCurrentWorkspace: () => useCurrentWorkspaceMock(),
}))

vi.mock("@/api/hooks/papers", () => ({
	usePapers: (...args: Array<unknown>) => usePapersMock(...args),
}))

vi.mock("@/lib/theme", () => ({
	useTheme: () => ({ resolvedTheme: "dark", systemTheme: "light" }),
}))

vi.mock("@/lib/auth-client", () => ({
	useSession: () => useSessionMock(),
}))

vi.mock("./PaperStarfieldCanvas", () => ({
	PaperStarfieldCanvas: ({
		colorMode,
		items,
		isInputFocused,
		onPaperSelect,
	}: {
		colorMode: "light" | "dark"
		items: PaperStarItem[]
		isInputFocused: boolean
		onPaperSelect: (paperId: string) => void
	}) => (
		<div
			data-focused={String(isInputFocused)}
			data-items={items.length}
			data-mode={colorMode}
			data-testid="paper-starfield"
		>
			{items.map((item) => (
				<button key={item.id} onClick={() => onPaperSelect(item.id)} type="button">
					star {item.title}
				</button>
			))}
		</div>
	),
}))

describe("LandingResearchPortal", () => {
	beforeEach(() => {
		navigateMock.mockReset()
		useSessionMock.mockReturnValue({ data: { user: { id: "user-1" } }, isPending: false })
		useCurrentWorkspaceMock.mockReturnValue({ data: { id: "workspace-1" } })
		usePapersMock.mockReturnValue({ data: [] })
	})

	it("renders the centered ask input and anonymous starfield for an empty library", async () => {
		const user = userEvent.setup()
		render(<LandingResearchPortal />)

		expect(screen.getByText("Interroga Sapientiam...")).toBeInTheDocument()
		expect(screen.getByTestId("paper-starfield")).toHaveAttribute("data-items", "0")

		await user.click(screen.getByLabelText("Ask anything"))

		expect(screen.queryByText(/attention is all you need/i)).not.toBeInTheDocument()
	})

	it("shows recent papers on focus and opens paper suggestions", async () => {
		const user = userEvent.setup()
		usePapersMock.mockReturnValue({ data: papersFixture })

		render(<LandingResearchPortal />)
		await user.click(screen.getByLabelText("Ask anything"))

		expect(screen.getByTestId("paper-starfield")).toHaveAttribute("data-items", "2")
		expect(screen.getByText("Attention Is All You Need")).toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "Open paper Attention Is All You Need" }))

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/papers/$paperId",
				params: { paperId: "paper-1" },
				search: { blockId: undefined },
			})
		}, { timeout: 1600 })
	})

	it("filters paper suggestions by title, venue, and author", async () => {
		const user = userEvent.setup()
		usePapersMock.mockReturnValue({ data: papersFixture })

		render(<LandingResearchPortal />)
		await user.type(screen.getByLabelText("Ask anything"), "neurips")

		expect(screen.getByText("Attention Is All You Need")).toBeInTheDocument()
		expect(screen.queryByText("Mamba: Linear-Time Sequence Modeling")).not.toBeInTheDocument()

		await user.clear(screen.getByLabelText("Ask anything"))
		await user.type(screen.getByLabelText("Ask anything"), "gu")

		expect(screen.getByText("Mamba: Linear-Time Sequence Modeling")).toBeInTheDocument()
	})

	it("routes quick actions from the focused command panel", async () => {
		const user = userEvent.setup()
		const { unmount } = render(<LandingResearchPortal />)
		await user.type(screen.getByLabelText("Ask anything"), "map")

		await user.click(screen.getByRole("button", { name: "Open paper map" }))
		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({ to: "/graph" })
		}, { timeout: 1600 })

		unmount()
		navigateMock.mockClear()
		render(<LandingResearchPortal />)
		await user.type(screen.getByLabelText("Ask anything"), "settings")

		await user.click(screen.getByRole("button", { name: "Settings" }))
		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({ to: "/settings" })
		}, { timeout: 1600 })
	})

	it("keeps anonymous users on the landing portal and routes auth commands", async () => {
		const user = userEvent.setup()
		useSessionMock.mockReturnValue({ data: null, isPending: false })
		usePapersMock.mockReturnValue({ data: papersFixture })

		render(<LandingResearchPortal />)

		expect(screen.getByTestId("paper-starfield")).toHaveAttribute("data-items", "0")
		expect(screen.queryByRole("button", { name: "star Attention Is All You Need" })).not.toBeInTheDocument()

		await user.type(screen.getByLabelText("Ask anything"), "sign")
		await user.click(screen.getByRole("button", { name: "Sign in" }))

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({ to: "/sign-in" })
		})
	})

	it("submits anonymous free text to sign-in", async () => {
		const user = userEvent.setup()
		useSessionMock.mockReturnValue({ data: null, isPending: false })

		render(<LandingResearchPortal />)

		await user.type(screen.getByLabelText("Ask anything"), "summarize my papers{enter}")

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({ to: "/sign-in" })
		})
	})

	it("lets paper-bound stars open the reader", async () => {
		const user = userEvent.setup()
		usePapersMock.mockReturnValue({ data: papersFixture })
		render(<LandingResearchPortal />)

		await user.click(screen.getByRole("button", { name: "star Mamba: Linear-Time Sequence Modeling" }))

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/papers/$paperId",
				params: { paperId: "paper-2" },
				search: { blockId: undefined },
			})
		}, { timeout: 1600 })
	})
})

const papersFixture = [
	{
		id: "paper-1",
		title: "Attention Is All You Need",
		authors: ["Ashish Vaswani"],
		year: 2017,
		doi: null,
		arxivId: "1706.03762",
		venue: "NeurIPS",
		abstract: null,
		citationCount: null,
		pages: null,
		volume: null,
		issue: null,
		publisher: null,
		publicationType: "conference",
		url: null,
		displayFilename: "attention.pdf",
		fileSizeBytes: 100,
		parseStatus: "done",
		parseError: null,
		parseProgressExtracted: null,
		parseProgressTotal: null,
		summary: null,
		summaryStatus: "done",
		summaryError: null,
		enrichmentStatus: "enriched",
		enrichmentSource: "semantic-scholar",
		metadataCandidates: [],
		metadataProvenance: {},
		metadataEditedByUser: {},
		createdAt: "2026-05-01T00:00:00.000Z",
		updatedAt: "2026-05-02T00:00:00.000Z",
	},
	{
		id: "paper-2",
		title: "Mamba: Linear-Time Sequence Modeling",
		authors: ["Albert Gu"],
		year: 2023,
		doi: null,
		arxivId: null,
		venue: "arXiv",
		abstract: null,
		citationCount: null,
		pages: null,
		volume: null,
		issue: null,
		publisher: null,
		publicationType: "preprint",
		url: null,
		displayFilename: "mamba.pdf",
		fileSizeBytes: 100,
		parseStatus: "done",
		parseError: null,
		parseProgressExtracted: null,
		parseProgressTotal: null,
		summary: null,
		summaryStatus: "done",
		summaryError: null,
		enrichmentStatus: "partial",
		enrichmentSource: "arxiv",
		metadataCandidates: [],
		metadataProvenance: {},
		metadataEditedByUser: {},
		createdAt: "2026-05-01T00:00:00.000Z",
		updatedAt: "2026-05-03T00:00:00.000Z",
	},
]
