import "katex/dist/katex.min.css"
import { Children, cloneElement, isValidElement, type ReactNode, useMemo } from "react"
import katex from "katex"

const katexHtmlCache = new Map<string, string>()
const mathSegmentsCache = new Map<string, MathSegment[]>()

type MathSegment =
	| { type: "text"; value: string }
	| { type: "math"; value: string; displayMode: boolean }

function renderKatex(latex: string, displayMode: boolean) {
	if (!latex.trim()) return ""
	const cacheKey = `${displayMode ? "display" : "inline"}:${latex}`
	const cached = katexHtmlCache.get(cacheKey)
	if (cached != null) return cached
	try {
		const html = katex.renderToString(latex, {
			displayMode,
			throwOnError: false,
			strict: "ignore",
		})
		katexHtmlCache.set(cacheKey, html)
		return html
	} catch {
		return ""
	}
}

function splitTextWithMath(source: string): MathSegment[] {
	const cached = mathSegmentsCache.get(source)
	if (cached) return cached
	if (!source) {
		const empty: MathSegment[] = [{ type: "text", value: "" }]
		mathSegmentsCache.set(source, empty)
		return empty
	}

	const segments: MathSegment[] = []
	const pattern = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^\n$]+?)\$/g
	let lastIndex = 0

	for (const match of source.matchAll(pattern)) {
		const full = match[0]
		const index = match.index ?? 0
		if (index > lastIndex) {
			segments.push({ type: "text", value: source.slice(lastIndex, index) })
		}
		if (match[1] != null) {
			segments.push({ type: "math", value: match[1], displayMode: true })
		} else if (match[2] != null) {
			segments.push({ type: "math", value: match[2], displayMode: true })
		} else if (match[3] != null) {
			segments.push({ type: "math", value: match[3], displayMode: false })
		} else if (match[4] != null) {
			segments.push({ type: "math", value: match[4], displayMode: false })
		}
		lastIndex = index + full.length
	}

	if (lastIndex < source.length) {
		segments.push({ type: "text", value: source.slice(lastIndex) })
	}

	const result: MathSegment[] = segments.length > 0 ? segments : [{ type: "text", value: source }]
	mathSegmentsCache.set(source, result)
	return result
}

function renderNodeWithMath(node: ReactNode, displayClassName?: string): ReactNode {
	if (typeof node === "string") {
		return <MarkdownMathText displayClassName={displayClassName} text={node} />
	}
	if (Array.isArray(node)) {
		return node.map((child, index) => <span key={index}>{renderNodeWithMath(child, displayClassName)}</span>)
	}
	if (isValidElement<{ children?: ReactNode }>(node)) {
		return cloneElement(node, {
			children: renderNodeWithMath(node.props.children, displayClassName),
		})
	}
	return node
}

export function MarkdownMathText({
	text,
	displayClassName = "markdown-prose__math-display",
}: {
	text: string
	displayClassName?: string
}) {
	const segments = useMemo(() => splitTextWithMath(text), [text])

	return (
		<>
			{segments.map((segment, index) => {
				if (segment.type === "text") {
					return <span key={`text-${index}`}>{segment.value}</span>
				}
				const html = renderKatex(segment.value, segment.displayMode)
				if (!html) {
					return (
						<span className={segment.displayMode ? displayClassName : ""} key={`math-fallback-${index}`}>
							{segment.displayMode ? `$$${segment.value}$$` : `$${segment.value}$`}
						</span>
					)
				}
				return (
					<span
						className={segment.displayMode ? displayClassName : ""}
						dangerouslySetInnerHTML={{ __html: html }}
						key={`math-${index}`}
					/>
				)
			})}
		</>
	)
}

export function withMarkdownMath(children: ReactNode, displayClassName?: string) {
	return Children.map(children, (child) => renderNodeWithMath(child, displayClassName))
}
