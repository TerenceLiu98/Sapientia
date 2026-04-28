import Placeholder from "@tiptap/extension-placeholder"
import type { Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import {
	Color,
	Command as NovelCommand,
	EditorBubble,
	EditorBubbleItem,
	EditorCommand,
	EditorCommandEmpty,
	EditorCommandItem,
	EditorCommandList,
	EditorContent,
	EditorRoot,
	HorizontalRule,
	TaskItem,
	TaskList,
	TiptapLink,
	TiptapUnderline,
	TextStyle,
	type SuggestionItem,
	createSuggestionItems,
	handleCommandNavigation,
	renderItems,
	useEditor,
} from "novel"
import {
	ArrowUpRight,
	Bold,
	ChevronDown,
	Code2,
	Heading1,
	Heading2,
	Heading3,
	Italic,
	List,
	ListOrdered,
	ListTodo,
	Minus,
	Pilcrow,
	Sigma,
	Strikethrough,
	TextQuote,
	Underline,
} from "lucide-react"
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { useNote, useUpdateNote } from "@/api/hooks/notes"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { usePalette } from "@/lib/highlight-palette"
import { cn } from "@/lib/utils"
import {
	BlockCitationNode,
	MathBlockNode,
	MathInlineNode,
	NoteCitationThemeProvider,
} from "./citation-schema"

type SaveStatus = "idle" | "saving" | "saved" | "failed"

const AUTOSAVE_DEBOUNCE_MS = 1500

// Loose alias — the editor type fully parametrized by our extensions is
// noisy. Consumers (PaperWorkspace) only need a handle to insert citations
// + jump cursor, both reachable via the standard `Editor` interface.
export type NoteEditorRef = Editor

const editorExtensions = [
	StarterKit.configure({
		// Keep dropcursor subtle — the default `#ddeeff` reads teal/green over
		// our cream reading background.
		dropcursor: { color: "rgba(15, 23, 42, 0.22)", width: 2 },
	}),
	Placeholder.configure({
		placeholder: "Type '/' for commands…",
	}),
	TaskList,
	TaskItem.configure({
		nested: true,
	}),
	TextStyle,
	Color,
	TiptapUnderline,
	TiptapLink.configure({
		openOnClick: false,
		HTMLAttributes: {
			class: "text-accent-700 underline underline-offset-2",
		},
	}),
	HorizontalRule,
	BlockCitationNode,
	MathInlineNode,
	MathBlockNode,
	NovelCommand.configure({
		suggestion: {
			items: ({ query }: { query: string }) => getSlashMenuItems(query),
			render: () => renderItems(),
		},
	}),
]

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] } as const

const TEXT_COLORS = [
	{ label: "Default", value: null },
	{ label: "Slate", value: "#334155" },
	{ label: "Amber", value: "#b45309" },
	{ label: "Rose", value: "#be123c" },
	{ label: "Emerald", value: "#047857" },
	{ label: "Blue", value: "#1d4ed8" },
	{ label: "Violet", value: "#6d28d9" },
] as const

const SLASH_MENU_ITEMS = createSuggestionItems([
	{
		title: "Text",
		description: "Start writing with a plain paragraph.",
		searchTerms: ["paragraph", "text", "body"],
		icon: <Pilcrow className="h-4 w-4" />,
		command: ({ editor, range }) => {
			editor.chain().focus().deleteRange(range).setParagraph().run()
		},
	},
	{
		title: "Heading 1",
		description: "Large section heading.",
		searchTerms: ["h1", "title", "heading"],
		icon: <Heading1 className="h-4 w-4" />,
		command: ({ editor, range }) => {
			editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run()
		},
	},
	{
		title: "Heading 2",
		description: "Medium section heading.",
		searchTerms: ["h2", "subtitle", "heading"],
		icon: <Heading2 className="h-4 w-4" />,
		command: ({ editor, range }) => {
			editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run()
		},
	},
	{
		title: "Heading 3",
		description: "Small section heading.",
		searchTerms: ["h3", "subheading", "heading"],
		icon: <Heading3 className="h-4 w-4" />,
		command: ({ editor, range }) => {
			editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run()
		},
	},
	{
		title: "Bullet List",
		description: "Create a bulleted list.",
		searchTerms: ["ul", "bullet", "list"],
		icon: <List className="h-4 w-4" />,
		command: ({ editor, range }) => {
			editor.chain().focus().deleteRange(range).toggleBulletList().run()
		},
	},
	{
		title: "Numbered List",
		description: "Create an ordered list.",
		searchTerms: ["ol", "ordered", "numbered", "list"],
		icon: <ListOrdered className="h-4 w-4" />,
		command: ({ editor, range }) => {
			editor.chain().focus().deleteRange(range).toggleOrderedList().run()
		},
	},
	{
		title: "To-do List",
		description: "Track tasks with checkboxes.",
		searchTerms: ["task", "todo", "checkbox", "list"],
		icon: <ListTodo className="h-4 w-4" />,
		command: ({ editor, range }) => {
			editor.chain().focus().deleteRange(range).toggleTaskList().run()
		},
	},
	{
		title: "Quote",
		description: "Call out a quotation or excerpt.",
		searchTerms: ["blockquote", "quote", "citation"],
		icon: <TextQuote className="h-4 w-4" />,
		command: ({ editor, range }) => {
			editor.chain().focus().deleteRange(range).toggleBlockquote().run()
		},
	},
	{
		title: "Code Block",
		description: "Insert a fenced code block.",
		searchTerms: ["code", "pre", "snippet"],
		icon: <Code2 className="h-4 w-4" />,
		command: ({ editor, range }) => {
			editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
		},
	},
	{
		title: "Divider",
		description: "Separate sections with a horizontal rule.",
		searchTerms: ["divider", "horizontal rule", "line"],
		icon: <Minus className="h-4 w-4" />,
		command: ({ editor, range }) => {
			editor.chain().focus().deleteRange(range).setHorizontalRule().run()
		},
	},
	{
		title: "Inline Math",
		description: "Insert an inline LaTeX token.",
		searchTerms: ["math", "latex", "equation", "inline"],
		icon: <Sigma className="h-4 w-4" />,
		command: ({ editor, range }) => {
			editor
				.chain()
				.focus()
				.deleteRange(range)
				.insertContent([{ type: "math", attrs: { latex: "" } }, { type: "text", text: " " }])
				.run()
		},
	},
	{
		title: "Math Block",
		description: "Insert a display equation block.",
		searchTerms: ["math", "latex", "equation", "block", "$$"],
		icon: <Sigma className="h-4 w-4" />,
		command: ({ editor, range }) => {
			editor
				.chain()
				.focus()
				.deleteRange(range)
				.insertContent([{ type: "mathBlock", attrs: { latex: "" } }])
				.run()
		},
	},
] satisfies SuggestionItem[])

function getSlashMenuItems(query: string) {
	const normalizedQuery = query.trim().toLowerCase()
	if (!normalizedQuery) return SLASH_MENU_ITEMS
	return SLASH_MENU_ITEMS.filter((item) => {
		const haystacks = [item.title, item.description, ...(item.searchTerms ?? [])]
		return haystacks.some((value) => value.toLowerCase().includes(normalizedQuery))
	})
}

interface Props {
	noteId: string
	onEditorReady?: (editor: NoteEditorRef) => void
	onOpenCitationBlock?: (paperId: string, blockId: string) => void
	headerActions?: ReactNode
}

export function NoteEditor({ noteId, onEditorReady, onOpenCitationBlock, headerActions }: Props) {
	const { data: note, isLoading } = useNote(noteId)
	const updateNote = useUpdateNote()

	const [initialContent, setInitialContent] = useState<unknown | null>(null)
	const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle")
	const [titleDraft, setTitleDraft] = useState("")
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	useEffect(() => {
		if (!note) return
		setTitleDraft(note.title)
	}, [note?.id, note])

	// Pull the JSON document from the presigned URL once we have it. Keeps
	// the editor body off the API response path — large notes never round-
	// trip through Hono twice.
	useEffect(() => {
		if (!note?.jsonUrl) return
		let cancelled = false
		fetch(note.jsonUrl)
			.then((r) => (r.ok ? r.json() : null))
			.then((data) => {
				if (cancelled) return
				setInitialContent(normalizeInitialContent(data))
			})
			.catch(() => {
				if (!cancelled) setInitialContent(EMPTY_DOC)
			})
		return () => {
			cancelled = true
		}
	}, [note?.jsonUrl])

	if (isLoading || !note || initialContent === null) {
		return <div className="p-6 text-sm text-text-tertiary">Loading note…</div>
	}

	return (
		<NoteEditorInner
			note={note}
			initialContent={initialContent}
			saveStatus={saveStatus}
			setSaveStatus={setSaveStatus}
			titleDraft={titleDraft}
			setTitleDraft={setTitleDraft}
			updateNote={updateNote}
			debounceRef={debounceRef}
			onEditorReady={onEditorReady}
			onOpenCitationBlock={onOpenCitationBlock}
			headerActions={headerActions}
		/>
	)
}

// Tiptap rejects `[]` as an initial doc — it expects either undefined or a
// well-formed `{ type: 'doc', content: [...] }`. Older notes (or the empty
// initial state from `createNote({ blocknoteJson: [] })`) come in as `[]`
// or `null`; both collapse to a single empty paragraph here.
function normalizeInitialContent(raw: unknown): unknown {
	if (raw == null) return EMPTY_DOC
	if (Array.isArray(raw) && raw.length === 0) return EMPTY_DOC
	if (typeof raw === "object" && raw && "type" in raw) return raw
	return EMPTY_DOC
}

function NovelEditorHandle({ onEditorReady }: { onEditorReady?: (editor: NoteEditorRef) => void }) {
	const { editor } = useEditor()

	useEffect(() => {
		if (editor && onEditorReady) onEditorReady(editor)
	}, [editor, onEditorReady])

	return null
}

function SlashMenu() {
	return (
		<EditorCommand className="note-editor__command rounded-xl border border-border-subtle bg-bg-primary p-2 shadow-[var(--shadow-popover)]">
			<EditorCommandEmpty className="px-2 py-1.5 text-sm text-text-tertiary">
				No matching commands
			</EditorCommandEmpty>
			<EditorCommandList className="flex max-h-80 min-w-[280px] flex-col gap-1 overflow-y-auto">
				{SLASH_MENU_ITEMS.map((item) => (
					<EditorCommandItem
						className="flex items-start gap-3 rounded-lg px-2.5 py-2 text-left outline-none data-[selected=true]:bg-surface-hover"
						key={item.title}
						onCommand={({ editor, range }) => item.command?.({ editor, range })}
						value={item.title}
						keywords={item.searchTerms}
					>
						<div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg-secondary text-text-secondary">
							{item.icon}
						</div>
						<div className="min-w-0">
							<div className="font-medium text-sm text-text-primary">{item.title}</div>
							<div className="text-xs text-text-tertiary">{item.description}</div>
						</div>
					</EditorCommandItem>
				))}
			</EditorCommandList>
		</EditorCommand>
	)
}

function BubbleButton({
	active,
	children,
	className,
	onSelect,
	title,
}: {
	active?: boolean
	children: ReactNode
	className?: string
	onSelect: (editor: Editor) => void
	title: string
}) {
	return (
		<EditorBubbleItem
			className={cn(
				"flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary",
				active && "bg-surface-selected text-text-accent",
				className,
			)}
			onSelect={onSelect}
			title={title}
		>
			{children}
		</EditorBubbleItem>
	)
}

function insertInlineMath(editor: Editor) {
	const { from, to, empty } = editor.state.selection
	const selectedText = editor.state.doc.textBetween(from, to, " ").trim()
	editor
		.chain()
		.focus()
		.insertContentAt(
			{ from, to },
			[
				{
					type: "math",
					attrs: {
						latex: empty ? "" : selectedText,
					},
				},
			],
		)
		.run()
}

function ColorMenuButton({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
	const { editor } = useEditor()
	const currentColor = (editor?.getAttributes("textStyle").color as string | undefined) ?? null
	const [open, setOpen] = useState(false)

	return (
		<DropdownMenu
			modal={false}
			onOpenChange={(nextOpen) => {
				setOpen(nextOpen)
				onOpenChange?.(nextOpen)
			}}
			open={open}
		>
			<DropdownMenuTrigger asChild>
				<button
					className={cn(
						"flex h-8 items-center gap-1 rounded-md px-2 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary",
						currentColor && "bg-surface-selected text-text-accent",
					)}
						onMouseDown={(e) => e.preventDefault()}
					onPointerDown={(e) => e.preventDefault()}
					type="button"
				>
					<span
						className="font-sans text-base font-semibold leading-none"
						style={{ color: currentColor ?? undefined }}
					>
						A
					</span>
					<ChevronDown className="h-3.5 w-3.5" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				className="min-w-44"
				onCloseAutoFocus={(e) => e.preventDefault()}
			>
				{TEXT_COLORS.map((entry) => (
					<DropdownMenuItem
						key={entry.label}
						onSelect={() => {
							if (!editor) return
							if (entry.value === null) {
								editor.chain().focus().unsetColor().run()
								return
							}
							editor.chain().focus().setColor(entry.value).run()
						}}
					>
						<div className="flex w-full items-center gap-2">
							<span
								className="h-3.5 w-3.5 rounded-full border border-border-subtle"
								style={{ backgroundColor: entry.value ?? "transparent" }}
							/>
							<span>{entry.label}</span>
						</div>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

function SelectionBubbleMenu() {
	const { editor } = useEditor()
	const [colorMenuOpen, setColorMenuOpen] = useState(false)

	return (
		<EditorBubble
			className="note-editor__bubble flex items-center gap-1 rounded-2xl border border-border-subtle bg-bg-primary p-1.5 shadow-[var(--shadow-popover)]"
			shouldShow={({ editor: ed, state }) => {
				const { empty } = state.selection
				return colorMenuOpen || (ed.isEditable && !ed.isActive("image") && !empty)
			}}
			tippyOptions={{ duration: 150, placement: "top" }}
		>
			<EditorBubbleItem
				className={cn(
					"flex h-8 items-center gap-1.5 rounded-md px-3 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary",
					editor?.isActive("link") && "bg-surface-selected text-text-accent",
				)}
				onSelect={(ed) => {
					const previousUrl = (ed.getAttributes("link").href as string | undefined) ?? ""
					const nextUrl = window.prompt("Link URL", previousUrl)
					if (nextUrl === null) return
					if (nextUrl.trim().length === 0) {
						ed.chain().focus().extendMarkRange("link").unsetLink().run()
						return
					}
					ed.chain().focus().extendMarkRange("link").setLink({ href: nextUrl.trim() }).run()
				}}
				title="Link"
			>
				<ArrowUpRight className="h-4 w-4" />
				<span className="underline underline-offset-2">Link</span>
			</EditorBubbleItem>
			<div className="mx-1 h-6 w-px bg-border-subtle" />
			<BubbleButton
				active={editor?.isActive("math")}
				className="font-serif"
				onSelect={(ed) => insertInlineMath(ed)}
				title="Inline math"
			>
				<Sigma className="h-4 w-4" />
			</BubbleButton>
			<BubbleButton
				active={editor?.isActive("bold")}
				onSelect={(ed) => ed.chain().focus().toggleBold().run()}
				title="Bold"
			>
				<Bold className="h-4 w-4" />
			</BubbleButton>
			<BubbleButton
				active={editor?.isActive("italic")}
				onSelect={(ed) => ed.chain().focus().toggleItalic().run()}
				title="Italic"
			>
				<Italic className="h-4 w-4" />
			</BubbleButton>
			<BubbleButton
				active={editor?.isActive("underline")}
				onSelect={(ed) => ed.chain().focus().toggleUnderline().run()}
				title="Underline"
			>
				<Underline className="h-4 w-4" />
			</BubbleButton>
			<BubbleButton
				active={editor?.isActive("strike")}
				onSelect={(ed) => ed.chain().focus().toggleStrike().run()}
				title="Strikethrough"
			>
				<Strikethrough className="h-4 w-4" />
			</BubbleButton>
			<BubbleButton
				active={editor?.isActive("code")}
				onSelect={(ed) => ed.chain().focus().toggleCode().run()}
				title="Inline code"
			>
				<Code2 className="h-4 w-4" />
			</BubbleButton>
			<div className="mx-1 h-6 w-px bg-border-subtle" />
			<ColorMenuButton onOpenChange={setColorMenuOpen} />
		</EditorBubble>
	)
}

function NoteEditorInner({
	note,
	initialContent,
	saveStatus,
	setSaveStatus,
	titleDraft,
	setTitleDraft,
	updateNote,
	debounceRef,
	onEditorReady,
	onOpenCitationBlock,
	headerActions,
}: {
	note: { id: string; title: string; workspaceId: string }
	initialContent: unknown
	saveStatus: SaveStatus
	setSaveStatus: (s: SaveStatus) => void
	titleDraft: string
	setTitleDraft: (s: string) => void
	updateNote: ReturnType<typeof useUpdateNote>
	debounceRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
	onEditorReady?: (editor: NoteEditorRef) => void
	onOpenCitationBlock?: (paperId: string, blockId: string) => void
	headerActions?: ReactNode
}) {
	const { palette } = usePalette()

	useEffect(() => {
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current)
		}
	}, [debounceRef])

	const commitTitle = useCallback(async () => {
		if (titleDraft.trim().length === 0 || titleDraft === note.title) return
		setSaveStatus("saving")
		try {
			await updateNote.mutateAsync({ noteId: note.id, title: titleDraft.trim() })
			setSaveStatus("saved")
		} catch {
			setSaveStatus("failed")
		}
	}, [note.id, note.title, setSaveStatus, titleDraft, updateNote])

	return (
		<div className="note-editor flex h-full flex-col bg-[var(--color-reading-bg)]">
			<div className="flex items-start justify-between gap-3 border-b border-border-subtle/80 px-5 py-2.5 text-sm">
				<input
					className="min-w-0 flex-1 bg-transparent font-serif text-lg text-text-primary outline-none"
					onBlur={commitTitle}
					onChange={(e) => setTitleDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault()
							commitTitle()
							e.currentTarget.blur()
						}
					}}
					type="text"
					value={titleDraft}
				/>
				<div className="flex max-w-[65%] flex-wrap items-center justify-end gap-x-3 gap-y-1 text-right">
					{headerActions}
					<div className="text-xs text-text-tertiary">
						{saveStatus === "saving" && "Saving…"}
						{saveStatus === "saved" && "Saved"}
						{saveStatus === "failed" && <span className="text-text-error">Save failed</span>}
					</div>
				</div>
			</div>
			<div className="note-editor__body flex-1 overflow-y-auto">
				<NoteCitationThemeProvider
					onOpenBlock={onOpenCitationBlock}
					palette={palette}
					workspaceId={note.workspaceId}
				>
					<EditorRoot>
						<EditorContent
							className="note-editor__novel"
							editorProps={{
								attributes: {
									class: "prose prose-sm max-w-none focus:outline-none",
								},
								handleDOMEvents: {
									keydown: (_view, event) => handleCommandNavigation(event) ?? false,
								},
							}}
							extensions={editorExtensions}
							initialContent={initialContent as never}
							onUpdate={({ editor: ed }) => {
								// Save on doc change (debounced) AND auto-upgrade
								// `$$` paragraphs into math blocks.
								tryUpgradeMathShortcut(ed)

								setSaveStatus("saving")
								if (debounceRef.current) clearTimeout(debounceRef.current)
								debounceRef.current = setTimeout(async () => {
									try {
										await updateNote.mutateAsync({
											noteId: note.id,
											blocknoteJson: ed.getJSON(),
										})
										setSaveStatus("saved")
									} catch {
										setSaveStatus("failed")
									}
								}, AUTOSAVE_DEBOUNCE_MS)
							}}
						>
							<NovelEditorHandle onEditorReady={onEditorReady} />
							<SelectionBubbleMenu />
							<SlashMenu />
						</EditorContent>
					</EditorRoot>
				</NoteCitationThemeProvider>
			</div>
		</div>
	)
}

// Markdown shortcut: a paragraph that's *just* "$$" gets replaced with an
// empty math block. Mirrors what BlockNote did on `onChange`. We re-walk
// the active paragraph node on every update because Tiptap's InputRules
// fire before the dollars actually land in the doc.
function tryUpgradeMathShortcut(editor: Editor) {
	const { selection } = editor.state
	const $from = selection.$from
	const node = $from.parent
	if (node.type.name !== "paragraph") return
	if (node.childCount !== 1) return
	const text = node.textContent
	if (text !== "$$") return
	const start = $from.before($from.depth)
	const end = $from.after($from.depth)
	editor
		.chain()
		.focus()
		.command(({ tr }) => {
			tr.replaceWith(
				start,
				end,
				editor.schema.nodes.mathBlock.create({ latex: "" }),
			)
			return true
		})
		.run()
}
