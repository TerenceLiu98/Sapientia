export async function copyTextToClipboard(text: string): Promise<boolean> {
	const trimmed = text.trim()
	if (!trimmed) return false

	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(trimmed)
			return true
		}
	} catch {
		// Fall back to the legacy copy path below. Some environments
		// expose `navigator.clipboard` but still reject writes.
	}

	if (typeof document === "undefined") return false

	const textarea = document.createElement("textarea")
	textarea.value = trimmed
	textarea.setAttribute("readonly", "")
	textarea.style.position = "fixed"
	textarea.style.top = "-1000px"
	textarea.style.opacity = "0"
	document.body.appendChild(textarea)
	textarea.focus()
	textarea.select()

	try {
		return document.execCommand("copy")
	} catch {
		return false
	} finally {
		document.body.removeChild(textarea)
	}
}
