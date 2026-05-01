import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { MarkdownProse } from "./MarkdownProse"

describe("MarkdownProse", () => {
	it("renders citations as clickable chips and leaves normal links intact", async () => {
		const onOpenBlock = vi.fn()

		render(
			<MarkdownProse
				blockNumberByBlockId={new Map([["abc123", 5]])}
				markdown={"See [blk abc123] and [OpenAI](https://openai.com)."}
				onOpenBlock={onOpenBlock}
			/>,
		)

		const citation = screen.getByRole("button", { name: "block 5" })
		const link = screen.getByRole("link", { name: "OpenAI" })

		expect(citation).toBeInTheDocument()
		expect(link).toHaveAttribute("href", "https://openai.com")

		await userEvent.click(citation)
		expect(onOpenBlock).toHaveBeenCalledWith("abc123")
	})

	it("applies shared prose classes for headings and inline code", () => {
		const { container } = render(<MarkdownProse markdown={"## Heading\n\nUse `code` here."} />)

		expect(container.querySelector(".markdown-prose__h2")).toBeTruthy()
		expect(container.querySelector(".markdown-prose__code-inline")).toBeTruthy()
	})

	it("renders inline and display math with KaTeX", () => {
		const { container } = render(
			<MarkdownProse markdown={"Inline $x^2$.\n\n$$\n\\int_0^1 x^2 dx\n$$"} />,
		)

		expect(container.querySelector(".katex")).toBeTruthy()
		expect(container.querySelector(".markdown-prose__math-display .katex-display")).toBeTruthy()
	})
})
