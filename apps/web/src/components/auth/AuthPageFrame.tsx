import type { ReactNode } from "react"

export function AuthPageFrame(props: {
	eyebrow: string
	title: string
	description: string
	footer: ReactNode
	children: ReactNode
}) {
	return (
		<div className="min-h-screen bg-bg-primary px-4 py-10 sm:px-6 lg:px-8">
			<div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
				<section className="hidden lg:block">
					<div className="max-w-xl">
						<div className="text-xs font-medium uppercase tracking-[0.18em] text-text-secondary">
							Sapientia
						</div>
						<h1 className="mt-4 font-serif text-5xl font-semibold tracking-[-0.04em] text-text-primary">
							Deep reading, with the quiet parts intact.
						</h1>
						<p className="mt-5 max-w-lg font-serif text-[1.125rem] leading-8 text-text-secondary">
							A reading workspace for papers, notes, and the ideas that accumulate between them. AI
							stays available, but never takes over the desk.
						</p>
					</div>
				</section>

				<section className="mx-auto w-full max-w-[var(--content-narrow)]">
					<div className="rounded-xl border border-border-subtle bg-bg-overlay p-6 shadow-[var(--shadow-popover)] sm:p-8">
						<div className="text-xs font-medium uppercase tracking-[0.18em] text-text-secondary">
							{props.eyebrow}
						</div>
						<h2 className="mt-3 font-serif text-4xl font-semibold tracking-[-0.035em] text-text-primary">
							{props.title}
						</h2>
						<p className="mt-3 text-sm leading-6 text-text-secondary">{props.description}</p>
						<div className="mt-8">{props.children}</div>
						<div className="mt-8 text-center text-sm text-text-secondary">{props.footer}</div>
					</div>
				</section>
			</div>
		</div>
	)
}
