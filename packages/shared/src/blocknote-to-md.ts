/**
 * Lossy BlockNote document → markdown serializer.
 *
 * Used for:
 *   - md_object_key in MinIO (alongside the JSON, lossless+lossy pair)
 *   - agent_markdown_cache in Postgres (truncated, fast LLM context)
 *   - search_text input (basic full-text searchability)
 *
 * NOT used for export — that uses a richer pipeline (v0.2). The goal here
 * is "good enough for LLM context and search," not "round-trip lossless."
 *
 * The schema is intentionally permissive (`unknown`) because BlockNote's
 * Block type is involved + customisable; we don't want this serializer to
 * reach into @blocknote/core types and force every consumer to do so too.
 */

export type BlockNoteDoc = unknown[]

export function blocknoteJsonToMarkdown(blocks: BlockNoteDoc): string {
	if (!Array.isArray(blocks)) return ""
	return blocks
		.map((block) => blockToMd(block, 0))
		.filter((line) => line.length > 0)
		.join("\n\n")
}

function blockToMd(block: unknown, indent: number): string {
	if (typeof block !== "object" || block === null) return ""
	const node = block as {
		type?: string
		content?: unknown
		props?: Record<string, unknown>
		children?: unknown[]
	}

	const text = inlinesToMd(node.content)
	const prefix = "  ".repeat(indent)
	const child = childrenMd(node.children, indent + 1)

	switch (node.type) {
		case "paragraph":
			return prefix + text + child
		case "heading": {
			const level = clampHeadingLevel(node.props?.level)
			return `${"#".repeat(level)} ${text}${child ? `\n${child}` : ""}`
		}
		case "bulletListItem":
			return `${prefix}- ${text}${child ? `\n${child}` : ""}`
		case "numberedListItem":
			return `${prefix}1. ${text}${child ? `\n${child}` : ""}`
		case "checkListItem": {
			const checked = node.props?.checked === true
			return `${prefix}- [${checked ? "x" : " "}] ${text}`
		}
		case "codeBlock": {
			const lang = typeof node.props?.language === "string" ? (node.props.language as string) : ""
			return `\`\`\`${lang}\n${text}\n\`\`\``
		}
		case "quote":
			return `${prefix}> ${text}`
		case "table":
			// Tables don't round-trip well lossy; emit raw text.
			return prefix + text
		default:
			// Unknown / custom block — fall back to plain text content.
			return prefix + text + child
	}
}

function inlinesToMd(content: unknown): string {
	if (!Array.isArray(content)) return ""
	return content
		.map((item) => {
			if (typeof item !== "object" || item === null) return ""
			const node = item as {
				type?: string
				text?: string
				href?: string
				content?: unknown
				styles?: { bold?: boolean; italic?: boolean; code?: boolean }
				props?: Record<string, unknown>
			}

			if (node.type === "text") {
				return applyStyles(node.text ?? "", node.styles)
			}
			if (node.type === "link") {
				const inner = inlinesToMd(node.content ?? [])
				return `[${inner}](${node.href ?? ""})`
			}
			// Custom inline nodes — TASK-013's blockCitation wires through here.
			// We default to using a `snapshot` prop or any text the node carries
			// so the markdown still has something to surface.
			if (typeof node.props === "object" && node.props && typeof node.props.snapshot === "string") {
				return node.props.snapshot
			}
			return node.text ?? ""
		})
		.join("")
}

function applyStyles(
	text: string,
	styles: { bold?: boolean; italic?: boolean; code?: boolean } | undefined,
): string {
	if (!styles || !text) return text
	let out = text
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
