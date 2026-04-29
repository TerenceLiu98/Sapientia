export function RightPanel() {
	return (
		<div className="hidden h-full lg:flex lg:flex-col lg:p-4">
			<div className="text-xs font-medium uppercase tracking-[0.16em] text-text-secondary">
				Agent
			</div>
			<div className="mt-3 rounded-xl border border-dashed border-border-default bg-bg-primary/70 p-4">
				<p className="font-serif text-lg text-text-primary">No paper agent is active here.</p>
				<p className="mt-2 text-sm leading-6 text-text-secondary">
					Open a paper to ask the agent about its blocks, highlights, and summary context.
				</p>
			</div>
		</div>
	)
}
