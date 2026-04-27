import { BlockNoteSchema, defaultInlineContentSpecs } from "@blocknote/core"
import { createReactInlineContentSpec } from "@blocknote/react"

// Custom BlockNote inline content for "this note cites paper X block Y".
// `snapshot` is captured at insert time so the chip stays meaningful even
// if the underlying block is re-parsed away.
//
// We use `createReactInlineContentSpec` from `@blocknote/react` (vs the
// DOM-level helper in `@blocknote/core`) so we can render the chip with
// JSX and Tailwind classes.
export const blockCitationSpec = createReactInlineContentSpec(
	{
		type: "blockCitation",
		propSchema: {
			paperId: { default: "" },
			blockId: { default: "" },
			snapshot: { default: "" },
		},
		content: "none",
	},
	{
		render: ({ inlineContent }) => {
			const { paperId, blockId, snapshot } = inlineContent.props
			const label = snapshot && snapshot.length > 0 ? snapshot : `${blockId.slice(0, 6)}…`
			return (
				<span
					className="mx-0.5 inline-flex max-w-[280px] cursor-default items-center gap-1 rounded-md bg-accent-100 px-1.5 py-0.5 align-baseline text-sm text-accent-700"
					contentEditable={false}
					title={`${paperId}#${blockId}`}
				>
					<span className="text-accent-500">¶</span>
					<span className="truncate">{label}</span>
				</span>
			)
		},
	},
)

export const noteSchema = BlockNoteSchema.create({
	inlineContentSpecs: {
		...defaultInlineContentSpecs,
		blockCitation: blockCitationSpec,
	},
})
