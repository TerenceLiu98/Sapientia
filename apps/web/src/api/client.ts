export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
		public body?: unknown,
	) {
		super(message)
		this.name = "ApiError"
	}
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
	const isFormData = init.body instanceof FormData
	const res = await fetch(path, {
		credentials: "include",
		...init,
		headers: {
			...(isFormData ? {} : { "content-type": "application/json" }),
			...init.headers,
		},
	})

	if (!res.ok) {
		let body: unknown
		try {
			body = await res.json()
		} catch {
			body = await res.text().catch(() => undefined)
		}
		throw new ApiError(res.status, res.statusText, body)
	}

	if (res.status === 204) return undefined as T
	return (await res.json()) as T
}
