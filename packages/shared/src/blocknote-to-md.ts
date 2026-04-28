/**
 * Lossy editor JSON → markdown serializer.
 *
 * Used for:
 *   - md_object_key in MinIO (alongside the JSON, lossless+lossy pair)
 *   - agent_markdown_cache in Postgres (truncated, fast LLM context)
 *   - search_text input (basic full-text searchability)
 *
 * NOT used for export — that uses a richer pipeline (v0.2). The goal here
 * is "good enough for LLM context and search," not "round-trip lossless."
 *
 * Handles both the modern Tiptap shape (`{ type: 'doc', content: [...] }`)
 * and the legacy BlockNote top-level array shape, so freshly-created notes
 * (which still write `[]`) don't break the pipeline.
 *
 * The function name is kept as `blocknoteJsonToMarkdown` for compatibility
 * with existing call sites and the matching DB column name; the input it
 * accepts is now opaque editor JSON.
 */
import { formatAnnotationCitationToken, formatCitationToken } from "./citations"

export type BlockNoteDoc = unknown

interface AnyNode {
	type?: string
	text?: string
	content?: unknown
	attrs?: Record<string, unknown>
	// Legacy BlockNote shape: properties used to live on `props`/`children`
	// instead of Tiptap's `attrs`/`content`. Read both so notes saved before
	// the migration still serialize.
	props?: Record<string, unknown>
	children?: unknown
	marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>
	styles?: { bold?: boolean; italic?: boolean; code?: boolean }
	// Some legacy node types (notably BlockNote's `link`) carry their own
	// fields directly on the node instead of in `attrs`/`props`.
	href?: string
}

export function blocknoteJsonToMarkdown(doc: BlockNoteDoc): string {
	if (Array.isArray(doc)) {
		// Legacy BlockNote shape — top-level blocks array.
		return doc
			.map((block) => blockToMd(block, 0))
			.filter((line) => line.length > 0)
			.join("\n\n")
	}
	if (typeof doc === "object" && doc !== null) {
		const root = doc as AnyNode
		if (root.type === "doc" && Array.isArray(root.content)) {
			return root.content
				.map((block) => blockToMd(block, 0))
				.filter((line) => line.length > 0)
				.join("\n\n")
		}
	}
	return ""
}

function blockToMd(block: unknown, indent: number): string {
	if (typeof block !== "object" || block === null) return ""
	const node = block as AnyNode

	const text = inlinesToMd(node.content)
	const prefix = "  ".repeat(indent)
	const child = childrenMd(node.children, indent + 1)
	const attrs = node.attrs ?? node.props ?? {}

	switch (node.type) {
		case "paragraph":
			return prefix + text + child
		case "heading": {
			const level = clampHeadingLevel(attrs.level)
			return `${"#".repeat(level)} ${text}${child ? `\n${child}` : ""}`
		}
		// Tiptap StarterKit lists wrap their items in `bulletList`/`orderedList`
		// with each item a `listItem`. BlockNote used flat `bulletListItem`/
		// `numberedListItem` blocks. Handle both.
		case "bulletList":
			return mapListChildren(node.content, indent, "- ")
		case "orderedList":
			return mapListChildren(node.content, indent, "1. ")
		case "listItem": {
			const inner = listItemMd(node.content, indent)
			return inner
		}
		case "bulletListItem":
			return `${prefix}- ${text}${child ? `\n${child}` : ""}`
		case "numberedListItem":
			return `${prefix}1. ${text}${child ? `\n${child}` : ""}`
		case "checkListItem": {
			const checked = attrs.checked === true
			return `${prefix}- [${checked ? "x" : " "}] ${text}`
		}
		case "taskList":
			return mapListChildren(node.content, indent, "- [ ] ")
		case "taskItem": {
			const checked = attrs.checked === true
			const inner = listItemMd(node.content, indent)
			return inner.replace(/^- \[ \]/, `- [${checked ? "x" : " "}]`)
		}
		case "codeBlock": {
			const lang = typeof attrs.language === "string" ? (attrs.language as string) : ""
			return `\`\`\`${lang}\n${text || node.text || ""}\n\`\`\``
		}
		case "blockquote":
		case "quote": {
			const inner = Array.isArray(node.content)
				? node.content
						.map((c) => blockToMd(c, 0))
						.filter((l) => l.length > 0)
						.join("\n")
				: text
			return inner
				.split("\n")
				.map((line) => `${prefix}> ${line}`)
				.join("\n")
		}
		case "horizontalRule":
			return `${prefix}---`
		case "table":
			// Tables don't round-trip well lossy; emit raw text.
			return prefix + text
		case "mathBlock": {
			// Display math: serialize as $$ ... $$ on its own block. Empty
			// latex collapses to a single placeholder so re-parsing later
			// doesn't leave a stray block in the markdown.
			const latex = typeof attrs.latex === "string" ? (attrs.latex as string) : ""
			if (latex.length === 0) return ""
			return `$$\n${latex}\n$$`
		}
		default:
			// Unknown / custom block — fall back to plain text content.
			return prefix + text + child
	}
}

function listItemMd(content: unknown, indent: number): string {
	if (!Array.isArray(content)) return ""
	const prefix = "  ".repeat(indent)
	const lines: string[] = []
	for (const child of content) {
		if (typeof child !== "object" || child === null) continue
		const c = child as AnyNode
		if (c.type === "paragraph") {
			lines.push(`${prefix}- ${inlinesToMd(c.content)}`)
		} else if (c.type === "bulletList" || c.type === "orderedList" || c.type === "taskList") {
			lines.push(blockToMd(c, indent + 1))
		} else {
			lines.push(blockToMd(c, indent))
		}
	}
	return lines.filter((l) => l.length > 0).join("\n")
}

function mapListChildren(content: unknown, indent: number, _bullet: string): string {
	if (!Array.isArray(content)) return ""
	return content
		.map((c) => blockToMd(c, indent))
		.filter((line) => line.length > 0)
		.join("\n")
}

function inlinesToMd(content: unknown): string {
	if (!Array.isArray(content)) return ""
	return content
		.map((item) => {
			if (typeof item !== "object" || item === null) return ""
			const node = item as AnyNode

			if (node.type === "text") {
				return applyMarks(node.text ?? "", node)
			}
			// BlockNote stored links as a node type; Tiptap stores them as
			// marks on text nodes. Both shapes are handled in the text branch
			// above (via marks) and the legacy node branch here.
			if (node.type === "link") {
				const inner = inlinesToMd(node.content ?? [])
				const href =
					(node.attrs?.href as string) ??
					(node.props?.href as string) ??
					(node.href as string) ??
					""
				return `[${inner}](${href})`
			}
			// Inline math: emit as $latex$ so the LLM and search index see
			// the actual expression.
			if (node.type === "math") {
				const latex =
					(node.attrs?.latex as string) ?? (node.props?.latex as string) ?? ""
				return latex.length > 0 ? `$${latex}$` : ""
			}
			// Block citations get the canonical token form so the markdown
			// surface stays grep-able and round-trippable.
			if (node.type === "blockCitation") {
				const data = (node.attrs ?? node.props ?? {}) as {
					paperId?: string
					blockId?: string
					blockNumber?: number
					snapshot?: string
				}
				if (data.paperId && data.blockId) {
					return formatCitationToken({
						paperId: data.paperId,
						blockId: data.blockId,
						blockNumber: data.blockNumber,
						snapshot: data.snapshot,
					})
				}
				return data.snapshot ?? ""
			}
			if (node.type === "annotationCitation") {
				const data = (node.attrs ?? node.props ?? {}) as {
					paperId?: string
					annotationId?: string
					annotationKind?: "highlight" | "underline" | "ink"
					page?: number
					snapshot?: string
				}
				if (
					data.paperId &&
					data.annotationId &&
					(data.annotationKind === "highlight" || data.annotationKind === "underline")
				) {
					return formatAnnotationCitationToken({
						paperId: data.paperId,
						annotationId: data.annotationId,
						annotationKind: data.annotationKind,
						page: data.page,
						snapshot: data.snapshot,
					})
				}
				return data.snapshot ?? ""
			}
			// Other custom inline nodes — fall back to any snapshot/text they
			// carry so the markdown isn't blank for them.
			const snapshot =
				(node.attrs?.snapshot as string | undefined) ??
				(node.props?.snapshot as string | undefined)
			if (typeof snapshot === "string") return snapshot
			return node.text ?? ""
		})
		.join("")
}

function applyMarks(text: string, node: AnyNode): string {
	if (!text) return text
	let out = text
	// Tiptap marks
	if (Array.isArray(node.marks)) {
		const types = new Set(node.marks.map((m) => m.type))
		const link = node.marks.find((m) => m.type === "link")
		if (types.has("code")) out = `\`${out}\``
		if (types.has("bold")) out = `**${out}**`
		if (types.has("italic")) out = `_${out}_`
		if (link?.attrs?.href) out = `[${out}](${link.attrs.href as string})`
		return out
	}
	// Legacy BlockNote styles
	const styles = node.styles
	if (!styles) return out
	if (styles.code) out = `\`${out}\``
	if (styles.bold) out = `**${out}**`
	if (styles.italic) out = `_${out}_`
	return out
}

function childrenMd(children: unknown, indent: number): string {
	if (!Array.isArray(children) || children.length === 0) return ""
	return children
		.map((c) => blockToMd(c, indent))
		.filter((line) => line.length > 0)
		.join("\n")
}

function clampHeadingLevel(value: unknown): number {
	const n = typeof value === "number" ? value : 1
	if (n < 1) return 1
	if (n > 6) return 6
	return n
}
