import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { AgentMessage } from "./AgentMessage"
import type { AgentUIMessage } from "./types"

function makeAssistantMessage(text: string): AgentUIMessage {
	return {
		id: "msg-1",
		role: "assistant",
		parts: [{ type: "text", text }],
	}
}

describe("AgentMessage", () => {
	it("renders block citations as clickable chips", async () => {
		const onOpenBlock = vi.fn()
		render(
			<AgentMessage
				message={makeAssistantMessage(
					'See [blk abc123], block:def456, and Block #ghi789: 标题 "Abstract"。它对应的是块 #xyz999。Further evidence: [blk cb953fee, blk a7b45a5d] and #7c2b51b0.',
				)}
				blockNumberByBlockId={
					new Map([
						["abc123", 1],
						["def456", 7],
						["ghi789", 12],
						["xyz999", 19],
						["cb953fee", 24],
						["a7b45a5d", 25],
						["7c2b51b0", 31],
					])
				}
				onOpenBlock={onOpenBlock}
			/>,
		)

		const firstCitation = screen.getByRole("button", { name: "block 1" })
		const secondCitation = screen.getByRole("button", { name: "block 7" })
		const thirdCitation = screen.getByRole("button", { name: "block 12" })
		const fourthCitation = screen.getByRole("button", { name: "block 19" })
		const fifthCitation = screen.getByRole("button", { name: "block 24" })
		const sixthCitation = screen.getByRole("button", { name: "block 25" })
		const seventhCitation = screen.getByRole("button", { name: "block 31" })
		const paragraph = screen.getByText((_, element) => {
			return element?.tagName === "P" && element.textContent?.includes('标题 "Abstract"') === true
		})

		expect(firstCitation).toBeInTheDocument()
		expect(secondCitation).toBeInTheDocument()
		expect(thirdCitation).toBeInTheDocument()
		expect(fourthCitation).toBeInTheDocument()
		expect(fifthCitation).toBeInTheDocument()
		expect(sixthCitation).toBeInTheDocument()
		expect(seventhCitation).toBeInTheDocument()
		expect(paragraph).toBeInTheDocument()

		await userEvent.click(firstCitation)
		await userEvent.click(secondCitation)
		await userEvent.click(thirdCitation)
		await userEvent.click(fourthCitation)
		await userEvent.click(fifthCitation)
		await userEvent.click(sixthCitation)
		await userEvent.click(seventhCitation)

		expect(onOpenBlock).toHaveBeenNthCalledWith(1, "abc123")
		expect(onOpenBlock).toHaveBeenNthCalledWith(2, "def456")
		expect(onOpenBlock).toHaveBeenNthCalledWith(3, "ghi789")
		expect(onOpenBlock).toHaveBeenNthCalledWith(4, "xyz999")
		expect(onOpenBlock).toHaveBeenNthCalledWith(5, "cb953fee")
		expect(onOpenBlock).toHaveBeenNthCalledWith(6, "a7b45a5d")
		expect(onOpenBlock).toHaveBeenNthCalledWith(7, "7c2b51b0")
	})
})
