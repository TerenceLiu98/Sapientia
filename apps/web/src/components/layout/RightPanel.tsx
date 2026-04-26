export function RightPanel() {
	return (
		<div className="hidden h-full lg:flex lg:flex-col lg:p-4">
			<div className="text-xs font-medium uppercase tracking-[0.16em] text-text-secondary">
				Assistant
			</div>
			<div className="mt-3 rounded-xl border border-dashed border-border-default bg-bg-primary/70 p-4">
				<p className="font-serif text-lg text-text-primary">Panel stays quiet by default.</p>
				<p className="mt-2 text-sm leading-6 text-text-secondary">
					Highlight a passage and ask a question in later tasks. For now this column is a reserved
					slot so the reading layout lands in the right proportions from day one.
				</p>
			</div>
		</div>
	)
}
