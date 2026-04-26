const navItems = [
	{ label: "Library", hint: "Soon" },
	{ label: "Notes", hint: "Soon" },
	{ label: "Wiki", hint: "Soon" },
	{ label: "Graph", hint: "Soon" },
]

export function LeftNav() {
	return (
		<div className="flex h-full flex-col p-4">
			<div className="text-xs font-medium uppercase tracking-[0.16em] text-text-secondary">
				Workspace
			</div>
			<div className="mt-3 rounded-lg border border-border-subtle bg-surface-selected px-3 py-3">
				<div className="font-medium text-text-accent">My Research</div>
				<p className="mt-1 text-sm text-text-secondary">Personal workspace, created on sign-up.</p>
			</div>

			<nav className="mt-8 space-y-1">
				{navItems.map((item) => (
					<button
						className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-hover"
						key={item.label}
						type="button"
					>
						<span>{item.label}</span>
						<span className="text-xs uppercase tracking-[0.12em] text-text-tertiary">
							{item.hint}
						</span>
					</button>
				))}
			</nav>
		</div>
	)
}
