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
	Loader2,
	Minus,
	Pilcrow,
	Sigma,
	Sparkles,
	Strikethrough,
	TextQuote,
	Underline,
} from "lucide-react"
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import { streamAskAgentForNote } from "@/api/hooks/agent"
import { type Block, useBlocks } from "@/api/hooks/blocks"
import { type NoteWithUrl, useNote, useUpdateNote } from "@/api/hooks/notes"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { usePalette } from "@/lib/highlight-palette"
import { cn } from "@/lib/utils"
import {
	AnnotationCitationNode,
	BlockCitationNode,
	MathBlockNode,
	MathInlineNode,
	NoteCitationThemeProvider,
} from "./citation-schema"
import { buildAiAskContent } from "./ai-note-content"

export type SaveStatus = "idle" | "saving" | "saved" | "failed"

const AUTOSAVE_DEBOUNCE_MS = 1500
const noteEditorContentCache = new Map<string, unknown>()
const noteEditorContentInflight = new Map<string, Promise<unknown>>()

// Loose alias — the editor type fully parametrized by our extensions is
// noisy. Consumers (PaperWorkspace) only need a handle to insert citations
// + jump cursor, both reachable via the standard `Editor` interface.
export type NoteEditorRef = Editor

export function primeNoteEditorContent(noteId: string, jsonUrl: string) {
	return loadNoteEditorContent(noteId, jsonUrl).then(() => undefined)
}

export function setNoteEditorCachedContent(noteId: string, content: unknown) {
	noteEditorContentCache.set(noteId, normalizeInitialContent(content))
	noteEditorContentInflight.delete(noteId)
}

const editorExtensions = [
	StarterKit.configure({
		// Keep dropcursor subtle — the default `#ddeeff` reads teal/green over
		// our cream reading background.
		dropcursor: { color: "rgba(15, 23, 42, 0.22)", width: 2 },
		// `horizontalRule` is registered separately below via novel's
		// re-export — disabling it here avoids Tiptap's "duplicate
		// extension names" warning. Behavior identical either way.
		horizontalRule: false,
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
	AnnotationCitationNode,
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

interface NoteAskDraft {
	selectedText: string
	blockIds: string[]
	insertAt: number
	editor: Editor
	mode: "composer" | "direct"
}

interface NoteAskContextValue {
	enabled: boolean
	onAskSelection: (draft: NoteAskDraft) => void
}

const NoteAskContext = createContext<NoteAskContextValue | null>(null)

// Tiptap text-color picker swatches. Like reader-annotations they are
// user-presentation choices (rich-text typography) that get persisted
// onto the doc tree as inline color style — not theme tokens. Keeping
// hex literals so existing notes round-trip cleanly; theme-aware
// version would require migrating every persisted Tiptap textStyle
// mark, deferred. Documented in docs/DESIGN_TOKENS.md §2.7 alongside
// the annotation swatches.
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
				.insertContent([
					{ type: "math", attrs: { latex: "" } },
					{ type: "text", text: " " },
				])
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
	onOpenCitationAnnotation?: (
		paperId: string,
		annotationId: string,
		page?: number,
		yRatio?: number,
	) => void
	headerActions?: ReactNode
	beforeEditorContent?: ReactNode
	// Save-status hand-off. When provided, the parent owns the visual
	// indicator (e.g. the marginalia slip header renders a single icon
	// alongside Jump/Close) and NoteEditor's internal "Saving… / Saved"
	// text is hidden to avoid duplication. When omitted, internal text
	// renders as before — so standalone routes like `/notes/:id` keep
	// their existing UX without changes.
	onSaveStatusChange?: (status: SaveStatus) => void
	// Lookup maps surfaced via NoteCitationThemeContext so chips inside
	// the editor can render the canonical `highlight K p. P blk. B`
	// label. Optional — chips fall back to the snapshot when absent.
	annotationOrdinalById?: Map<string, number>
	annotationBlockIdById?: Map<string, string>
	blockNumberByBlockId?: Map<string, number>
}

export function NoteEditor({
	noteId,
	onEditorReady,
	onOpenCitationBlock,
	onOpenCitationAnnotation,
	headerActions,
	beforeEditorContent,
	onSaveStatusChange,
	annotationOrdinalById,
	annotationBlockIdById,
	blockNumberByBlockId,
}: Props) {
	const { data: note, isLoading } = useNote(noteId)
	const updateNote = useUpdateNote()

	const [displayedNote, setDisplayedNote] = useState<NoteWithUrl | null>(null)
	const [initialContent, setInitialContent] = useState<unknown | null>(null)
	const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle")
	const [titleDraft, setTitleDraft] = useState("")
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	useEffect(() => {
		if (noteEditorContentCache.has(noteId)) {
			setInitialContent(normalizeInitialContent(noteEditorContentCache.get(noteId)))
		}
	}, [noteId])

	useEffect(() => {
		if (!note || note.id !== noteId || !note.jsonUrl) return
		let cancelled = false
		loadNoteEditorContent(note.id, note.jsonUrl)
			.then((data) => {
				if (cancelled) return
				setDisplayedNote(note)
				setInitialContent(normalizeInitialContent(data))
			})
			.catch(() => {
				if (cancelled) return
				setDisplayedNote(note)
				setInitialContent(EMPTY_DOC)
			})
		return () => {
			cancelled = true
		}
	}, [note, noteId])

	useEffect(() => {
		if (!displayedNote) return
		setTitleDraft(displayedNote.title)
	}, [displayedNote])

	useEffect(() => {
		setSaveStatus("idle")
		if (debounceRef.current) {
			clearTimeout(debounceRef.current)
			debounceRef.current = null
		}
	}, [noteId])

	// Forward save-status to a parent that wants to render its own
	// indicator (e.g. the marginalia slip header). Driven by useEffect
	// so we never call back during render. Cheap because saveStatus
	// only flips on a small set of transitions (type → "saving",
	// debounce fires → "saved" / "failed", noteId change → "idle").
	useEffect(() => {
		onSaveStatusChange?.(saveStatus)
	}, [saveStatus, onSaveStatusChange])

	if ((isLoading && !displayedNote) || !displayedNote || initialContent === null) {
		return <div className="p-6 text-sm text-text-tertiary">Loading note…</div>
	}

	return (
		<NoteEditorInner
			note={displayedNote}
			initialContent={initialContent}
			saveStatus={saveStatus}
			setSaveStatus={setSaveStatus}
			suppressInternalSaveStatus={Boolean(onSaveStatusChange)}
			titleDraft={titleDraft}
			setTitleDraft={setTitleDraft}
			updateNote={updateNote}
			debounceRef={debounceRef}
			onEditorReady={onEditorReady}
			onOpenCitationBlock={onOpenCitationBlock}
			onOpenCitationAnnotation={onOpenCitationAnnotation}
			headerActions={headerActions}
			beforeEditorContent={beforeEditorContent}
			annotationOrdinalById={annotationOrdinalById}
			annotationBlockIdById={annotationBlockIdById}
			blockNumberByBlockId={blockNumberByBlockId}
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

function loadNoteEditorContent(noteId: string, jsonUrl: string) {
	if (noteEditorContentCache.has(noteId)) {
		return Promise.resolve(noteEditorContentCache.get(noteId))
	}
	const inflight = noteEditorContentInflight.get(noteId)
	if (inflight) return inflight
	const request = fetch(jsonUrl)
		.then((response) => (response.ok ? response.json() : null))
		.then((data) => {
			const normalized = normalizeInitialContent(data)
			noteEditorContentCache.set(noteId, normalized)
			noteEditorContentInflight.delete(noteId)
			return normalized
		})
		.catch(() => {
			noteEditorContentInflight.delete(noteId)
			noteEditorContentCache.set(noteId, EMPTY_DOC)
			return EMPTY_DOC
		})
	noteEditorContentInflight.set(noteId, request)
	return request
}

function blockExcerpt(block: Block | null) {
	if (!block) return null
	const raw = (block.caption ?? block.text ?? "").replace(/\s+/g, " ").trim()
	if (!raw) return null
	return raw.length > 220 ? `${raw.slice(0, 217)}...` : raw
}

function useNoteAskContext() {
	return useContext(NoteAskContext)
}

function NovelEditorHandle({
	noteId,
	initialContent,
	onEditorReady,
}: {
	noteId: string
	initialContent: unknown
	onEditorReady?: (editor: NoteEditorRef) => void
}) {
	const { editor } = useEditor()
	const lastSyncedNoteIdRef = useRef<string | null>(null)

	useEffect(() => {
		if (editor && onEditorReady) onEditorReady(editor)
	}, [editor, onEditorReady])

	useEffect(() => {
		if (!editor) return
		if (lastSyncedNoteIdRef.current === noteId) return
		lastSyncedNoteIdRef.current = noteId
		editor.commands.setContent(initialContent as never, false)
		const scrollBody = editor.view.dom.closest(".note-editor__body")
		if (scrollBody instanceof HTMLElement) scrollBody.scrollTop = 0
	}, [editor, initialContent, noteId])

	return null
}

function SlashMenu() {
	const noteAsk = useNoteAskContext()

	return (
		<EditorCommand className="note-editor__command rounded-xl border border-border-subtle bg-bg-primary p-2 shadow-[var(--shadow-popover)]">
			<EditorCommandEmpty className="px-2 py-1.5 text-sm text-text-tertiary">
				No matching commands
			</EditorCommandEmpty>
			<EditorCommandList className="reader-scrollbar flex max-h-80 min-w-[280px] flex-col gap-1 overflow-y-auto">
				{noteAsk?.enabled ? (
					<EditorCommandItem
						className="flex items-start gap-3 rounded-lg px-2.5 py-2 text-left outline-none data-[selected=true]:bg-surface-hover"
						key="Ask AI"
						keywords={["ai", "ask", "agent", "question", "sapientia"]}
						onCommand={({ editor, range }) => {
							editor.chain().focus().deleteRange(range).run()
							noteAsk.onAskSelection({
								selectedText: "",
								blockIds: [],
								insertAt: range.from,
								editor,
								mode: "composer",
							})
						}}
						value="Ask AI"
					>
						<div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg-secondary text-text-accent">
							<Sparkles className="h-4 w-4" />
						</div>
						<div className="min-w-0">
							<div className="font-medium text-sm text-text-primary">Ask AI</div>
							<div className="text-xs text-text-tertiary">
								Ask about this paper and insert the answer here.
							</div>
						</div>
					</EditorCommandItem>
				) : null}
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
					active && "bg-surface-selected text-text-primary",
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
		.insertContentAt({ from, to }, [
			{
				type: "math",
				attrs: {
					latex: empty ? "" : selectedText,
				},
			},
		])
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
							currentColor && "bg-surface-selected text-text-primary",
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
	const noteAsk = useNoteAskContext()
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
						editor?.isActive("link") && "bg-surface-selected text-text-primary",
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
			{noteAsk?.enabled ? (
				<EditorBubbleItem
					className="flex h-8 items-center gap-1.5 rounded-md px-3 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-accent"
					onSelect={(ed) => {
						const { from, to } = ed.state.selection
						const selectedText = ed.state.doc.textBetween(from, to, " ").trim()
						noteAsk.onAskSelection({
							selectedText,
							blockIds: [],
							insertAt: to,
							editor: ed,
							mode: "direct",
						})
					}}
					title="Ask AI"
				>
					<Sparkles className="h-4 w-4" />
					<span>Ask</span>
				</EditorBubbleItem>
			) : null}
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
	suppressInternalSaveStatus,
	titleDraft,
	setTitleDraft,
	updateNote,
	debounceRef,
	onEditorReady,
	onOpenCitationBlock,
	onOpenCitationAnnotation,
	headerActions,
	beforeEditorContent,
	annotationOrdinalById,
	annotationBlockIdById,
	blockNumberByBlockId,
}: {
	note: NoteWithUrl
	initialContent: unknown
	saveStatus: SaveStatus
	setSaveStatus: (s: SaveStatus) => void
	suppressInternalSaveStatus?: boolean
	titleDraft: string
	setTitleDraft: (s: string) => void
	updateNote: ReturnType<typeof useUpdateNote>
	debounceRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
	onEditorReady?: (editor: NoteEditorRef) => void
	onOpenCitationBlock?: (paperId: string, blockId: string) => void
	onOpenCitationAnnotation?: (
		paperId: string,
		annotationId: string,
		page?: number,
		yRatio?: number,
	) => void
	headerActions?: ReactNode
	beforeEditorContent?: ReactNode
	annotationOrdinalById?: Map<string, number>
	annotationBlockIdById?: Map<string, string>
	blockNumberByBlockId?: Map<string, number>
}) {
	const { palette } = usePalette()
	const { data: blocks = [] } = useBlocks(note.paperId ?? "")
	const blocksById = useMemo(() => new Map(blocks.map((block) => [block.blockId, block])), [blocks])
	const [askDraft, setAskDraft] = useState<NoteAskDraft | null>(null)
	const [askQuestion, setAskQuestion] = useState("")
	const [askError, setAskError] = useState<string | null>(null)
	const [askStreamedAnswer, setAskStreamedAnswer] = useState("")
	const [isAskingNote, setIsAskingNote] = useState(false)
	const askAbortControllerRef = useRef<AbortController | null>(null)
	const anchorBlock =
		note.anchorBlockId != null
			? (blocks.find((block) => block.blockId === note.anchorBlockId) ?? null)
			: null
	const anchorBlockNumber = anchorBlock ? anchorBlock.blockIndex + 1 : null
	const anchorBlockTag = note.anchorBlockId
		? anchorBlockNumber
			? `block ${anchorBlockNumber}`
			: "block"
		: null
	const anchorExcerpt = blockExcerpt(anchorBlock)
	const isMarginaliaNote = Boolean(
		note.paperId && (note.anchorBlockId || note.anchorPage || note.anchorAnnotationId),
	)
	const anchorLabel =
		note.anchorKind === "highlight"
			? "highlight"
			: note.anchorKind === "underline"
				? "underline"
				: null
	const canJumpToAnchor =
		(note.anchorKind === "highlight" || note.anchorKind === "underline") &&
		note.paperId &&
		note.anchorAnnotationId &&
		onOpenCitationAnnotation
			? true
			: Boolean(note.paperId && note.anchorBlockId && onOpenCitationBlock)
	const handleOpenAnchor = useCallback(() => {
		if (!note.paperId) return
		if (
			(note.anchorKind === "highlight" || note.anchorKind === "underline") &&
			note.anchorAnnotationId &&
			onOpenCitationAnnotation
		) {
			onOpenCitationAnnotation(
				note.paperId,
				note.anchorAnnotationId,
				note.anchorPage ?? undefined,
				note.anchorYRatio ?? undefined,
			)
			return
		}
		if (note.anchorBlockId && onOpenCitationBlock) {
			onOpenCitationBlock(note.paperId, note.anchorBlockId)
		}
	}, [
		note.anchorAnnotationId,
		note.anchorBlockId,
		note.anchorKind,
		note.anchorPage,
		note.anchorYRatio,
		note.paperId,
		onOpenCitationAnnotation,
		onOpenCitationBlock,
	])
	const submitAskDraft = useCallback(async (draft: NoteAskDraft, rawQuestion: string) => {
		const question = rawQuestion.trim()
		if (!note.paperId || !question || isAskingNote) return
		setAskError(null)
		setAskStreamedAnswer("")
		setIsAskingNote(true)
		const controller = new AbortController()
		askAbortControllerRef.current = controller
		try {
			const answer = await streamAskAgentForNote(
				{
					paperId: note.paperId,
					workspaceId: note.workspaceId,
					question,
					selectionContext: {
						blockIds: draft.blockIds,
						selectedText: draft.selectedText || undefined,
					},
				},
				{
					signal: controller.signal,
					onChunk: (_chunk, accumulated) => setAskStreamedAnswer(accumulated),
				},
			)
			insertAgentAnswerIntoNote({
				editor: draft.editor,
				insertAt: draft.insertAt,
				paperId: note.paperId,
				blocksById,
				question,
				selectedText: draft.selectedText,
				answer,
			})
			setAskDraft(null)
			setAskQuestion("")
			setAskStreamedAnswer("")
		} catch (error) {
			setAskError(error instanceof Error ? error.message : "Ask failed")
		} finally {
			setIsAskingNote(false)
			if (askAbortControllerRef.current === controller) {
				askAbortControllerRef.current = null
			}
		}
	}, [blocksById, isAskingNote, note.paperId, note.workspaceId])
	const handleAskSelection = useCallback(
		(draft: NoteAskDraft) => {
			const anchorBlockIds = note.anchorBlockId ? [note.anchorBlockId] : []
			const nextDraft = {
				...draft,
				blockIds: draft.blockIds.length > 0 ? draft.blockIds : anchorBlockIds,
			}
			setAskDraft(nextDraft)
			setAskQuestion("")
			setAskError(null)
			setAskStreamedAnswer("")
			if (draft.mode === "direct" && draft.selectedText.trim().length > 0) {
				void submitAskDraft(nextDraft, draft.selectedText.trim())
			}
		},
		[note.anchorBlockId, submitAskDraft],
	)
	const handleSubmitAsk = useCallback(async () => {
		if (!askDraft) return
		await submitAskDraft(askDraft, askQuestion)
	}, [askDraft, askQuestion, submitAskDraft])

	useEffect(() => {
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current)
			askAbortControllerRef.current?.abort()
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
				{isMarginaliaNote ? (
					<div className="flex-1" />
				) : (
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
						placeholder="Untitled note"
						type="text"
						value={titleDraft}
					/>
				)}
				<div className="flex max-w-[65%] flex-wrap items-center justify-end gap-x-3 gap-y-1 text-right">
					{headerActions}
					{suppressInternalSaveStatus ? null : (
						<div className="text-xs text-text-tertiary">
							{saveStatus === "saving" && "Saving…"}
							{saveStatus === "saved" && "Saved"}
							{saveStatus === "failed" && <span className="text-text-error">Save failed</span>}
						</div>
					)}
				</div>
			</div>
				<div className="note-editor__body reader-scrollbar flex-1 overflow-y-auto">
				<NoteCitationThemeProvider
					onOpenBlock={onOpenCitationBlock}
					onOpenAnnotation={onOpenCitationAnnotation}
					palette={palette}
					workspaceId={note.workspaceId}
					annotationOrdinalById={annotationOrdinalById}
					annotationBlockIdById={annotationBlockIdById}
					blockNumberByBlockId={blockNumberByBlockId}
				>
					{isMarginaliaNote ? (
						<div className="border-b border-border-subtle/70 px-5 py-3">
								<div
									className={cn(
										"rounded-2xl border border-border-subtle/80 bg-[color-mix(in_srgb,var(--color-reading-bg)_88%,var(--color-bg-overlay))] px-3.5 py-3 shadow-[var(--shadow-sm)]",
										canJumpToAnchor && "cursor-pointer transition-colors hover:bg-surface-hover",
									)}
								onClick={canJumpToAnchor ? handleOpenAnchor : undefined}
								onKeyDown={
									canJumpToAnchor
										? (event) => {
												if (event.key === "Enter" || event.key === " ") {
													event.preventDefault()
													handleOpenAnchor()
												}
											}
										: undefined
								}
								role={canJumpToAnchor ? "button" : undefined}
								tabIndex={canJumpToAnchor ? 0 : undefined}
							>
									<div className="mb-2 flex flex-wrap items-center gap-2">
										{anchorBlockTag ? (
											<span className="inline-flex min-h-6 items-center rounded-full px-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-reader-tag-text)] [background:var(--color-reader-tag-bg)] [box-shadow:inset_0_0_0_1px_var(--color-reader-tag-border)]">
												{anchorBlockTag}
											</span>
										) : null}
									{note.anchorPage ? (
										<span className="inline-flex min-h-6 items-center rounded-full bg-surface-hover px-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
											{`p.${note.anchorPage}`}
										</span>
									) : null}
									{anchorLabel ? (
											<span className="inline-flex min-h-6 items-center rounded-full px-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-reader-tag-text)] [background:var(--color-reader-tag-bg)] [box-shadow:inset_0_0_0_1px_var(--color-reader-tag-border)]">
												{anchorLabel}
											</span>
									) : null}
								</div>
								{anchorExcerpt ? (
									<p className="font-serif text-sm leading-6 text-text-primary">{anchorExcerpt}</p>
								) : (
									<p className="text-sm text-text-tertiary">Source anchor saved for this note.</p>
								)}
							</div>
						</div>
					) : null}
					{beforeEditorContent}
					{askDraft && note.paperId && askDraft.mode === "composer" ? (
						<NoteAskComposer
							error={askError}
							isSending={isAskingNote}
							onCancel={() => {
								askAbortControllerRef.current?.abort()
								setAskDraft(null)
								setAskError(null)
								setAskQuestion("")
								setAskStreamedAnswer("")
							}}
							onChange={setAskQuestion}
							onSubmit={() => void handleSubmitAsk()}
							question={askQuestion}
							selectedText={askDraft.selectedText}
							streamedAnswer={askStreamedAnswer}
						/>
					) : null}
					{askDraft && note.paperId && askDraft.mode === "direct" ? (
						<NoteAskStatus
							error={askError}
							isSending={isAskingNote}
							onCancel={() => {
								askAbortControllerRef.current?.abort()
								setAskDraft(null)
								setAskError(null)
								setAskStreamedAnswer("")
							}}
							streamedAnswer={askStreamedAnswer}
						/>
					) : null}
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
										const json = ed.getJSON()
										await updateNote.mutateAsync({
											noteId: note.id,
											blocknoteJson: json,
										})
										// Keep the in-memory cache in sync with what we
										// just persisted. Without this, folding the slip
										// then reopening it (e.g. in the marginalia
										// gutter) re-reads the stale pre-edit JSON from
										// the cache and the user's writing appears to
										// vanish, even though the backend has it. Fixed
										// here rather than via cache-bust on every
										// reopen because we already have the canonical
										// JSON in hand at save time — no extra fetch.
										noteEditorContentCache.set(note.id, json)
										setSaveStatus("saved")
									} catch {
										setSaveStatus("failed")
									}
								}, AUTOSAVE_DEBOUNCE_MS)
							}}
						>
							<NovelEditorHandle
								initialContent={initialContent}
								noteId={note.id}
								onEditorReady={onEditorReady}
							/>
							<NoteAskContext.Provider
								value={{
									enabled: Boolean(note.paperId),
									onAskSelection: handleAskSelection,
								}}
							>
								<SelectionBubbleMenu />
								<SlashMenu />
							</NoteAskContext.Provider>
						</EditorContent>
					</EditorRoot>
				</NoteCitationThemeProvider>
			</div>
		</div>
	)
}

function NoteAskComposer({
	error,
	isSending,
	onCancel,
	onChange,
	onSubmit,
	question,
	selectedText,
	streamedAnswer,
}: {
	error: string | null
	isSending: boolean
	onCancel: () => void
	onChange: (value: string) => void
	onSubmit: () => void
	question: string
	selectedText: string
	streamedAnswer: string
}) {
	const normalizedSelection = selectedText.replace(/\s+/g, " ").trim()
	const selectionPreview =
		normalizedSelection.length > 180
			? `${normalizedSelection.slice(0, 177)}...`
			: normalizedSelection

	return (
		<div className="border-b border-border-subtle/70 bg-[color-mix(in_srgb,var(--color-reading-bg)_82%,var(--color-bg-secondary))] px-5 py-3">
			<div className="rounded-2xl border border-border-subtle bg-bg-primary/90 p-3 shadow-[var(--shadow-sm)]">
				<div className="mb-2 flex items-center justify-between gap-3">
					<div className="flex items-center gap-2 text-sm font-medium text-text-primary">
						<Sparkles className="h-4 w-4 text-text-accent" />
						Ask into note
					</div>
					<button
						className="text-xs text-text-tertiary transition-colors hover:text-text-primary"
						onClick={onCancel}
						type="button"
					>
						Cancel
					</button>
				</div>
				{selectionPreview ? (
					<div className="mb-2 rounded-xl bg-bg-secondary px-3 py-2 font-serif text-xs leading-5 text-text-secondary">
						{selectionPreview}
					</div>
				) : null}
				<textarea
					autoFocus
					className="min-h-20 w-full resize-none rounded-xl border border-border-subtle bg-[var(--color-reading-bg)] px-3 py-2 text-sm leading-6 text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong"
					disabled={isSending}
					onChange={(event) => onChange(event.target.value)}
					onKeyDown={(event) => {
						if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
							event.preventDefault()
							onSubmit()
						}
					}}
					placeholder="Ask Sapientia about this passage..."
					value={question}
				/>
				<div className="mt-2 flex items-center justify-between gap-3">
					<div className="min-h-5 text-xs text-text-tertiary">
						{error ? <span className="text-text-error">{error}</span> : "Answer will be inserted into this note."}
					</div>
					<button
						className="inline-flex h-8 items-center gap-2 rounded-full bg-text-primary px-3 text-sm font-medium text-bg-primary transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
						disabled={isSending || question.trim().length === 0}
						onClick={onSubmit}
						type="button"
					>
						{isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
						{isSending ? "Asking" : "Insert answer"}
					</button>
				</div>
				{streamedAnswer ? (
					<div className="mt-3 max-h-36 overflow-y-auto rounded-xl border border-border-subtle bg-[var(--color-reading-bg)] px-3 py-2 text-sm leading-6 text-text-secondary">
						{streamedAnswer}
					</div>
				) : null}
			</div>
		</div>
	)
}

function NoteAskStatus({
	error,
	isSending,
	onCancel,
	streamedAnswer,
}: {
	error: string | null
	isSending: boolean
	onCancel: () => void
	streamedAnswer: string
}) {
	if (!isSending && !error) return null

	return (
		<div className="border-b border-border-subtle/70 bg-[color-mix(in_srgb,var(--color-reading-bg)_82%,var(--color-bg-secondary))] px-5 py-3">
			<div className="rounded-2xl border border-border-subtle bg-bg-primary/90 px-3 py-2 text-sm shadow-[var(--shadow-sm)]">
				<div className="flex items-center justify-between gap-3">
					<div className="flex min-w-0 items-center gap-2 text-text-secondary">
						{isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-text-accent" /> : null}
						<span className={error ? "text-text-error" : ""}>
							{error ?? "Asking Sapientia about the selected text..."}
						</span>
					</div>
					<button
						className="shrink-0 text-xs text-text-tertiary transition-colors hover:text-text-primary"
						onClick={onCancel}
						type="button"
					>
						{error ? "Dismiss" : "Cancel"}
					</button>
				</div>
				{streamedAnswer ? (
					<div className="mt-2 max-h-36 overflow-y-auto rounded-xl border border-border-subtle bg-[var(--color-reading-bg)] px-3 py-2 leading-6 text-text-secondary">
						{streamedAnswer}
					</div>
				) : null}
			</div>
		</div>
	)
}

function insertAgentAnswerIntoNote(args: {
	editor: Editor
	insertAt: number
	paperId: string
	blocksById: Map<string, Block>
	question: string
	selectedText: string
	answer: string
}) {
	const content = buildAiAskContent(args)

	args.editor.chain().focus().insertContentAt(args.insertAt, content).run()
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
			tr.replaceWith(start, end, editor.schema.nodes.mathBlock.create({ latex: "" }))
			return true
		})
		.run()
}
