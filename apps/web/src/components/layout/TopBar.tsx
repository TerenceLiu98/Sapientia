import { useNavigate } from "@tanstack/react-router"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { signOut } from "@/lib/auth-client"
import { useCurrentUser } from "@/lib/use-current-user"

export function TopBar({
	title,
	isAgentPanelOpen,
	onToggleAgentPanel,
}: {
	title: string
	isAgentPanelOpen: boolean
	onToggleAgentPanel: () => void
}) {
	const navigate = useNavigate()
	const currentUser = useCurrentUser()

	async function handleSignOut() {
		await signOut()
		await navigate({ to: "/sign-in" })
	}

	if (currentUser.isPending) {
		return <div className="flex h-full items-center bg-bg-primary px-4 sm:px-6" />
	}

	const { user } = currentUser

	return (
		<div className="flex h-full items-center justify-between gap-4 bg-bg-primary px-4 sm:px-6">
			<div className="min-w-0 flex-1">
				<div className="text-xs font-medium uppercase tracking-[0.16em] text-text-secondary">
					Sapientia
				</div>
				<div className="mt-1 truncate font-serif text-base font-semibold tracking-[-0.03em] text-text-primary sm:text-xl">
					{title}
				</div>
			</div>

			<div className="shrink-0 flex items-center gap-3">
				<button
					aria-expanded={isAgentPanelOpen}
					className="hidden h-9 rounded-full border border-border-default px-3 text-sm text-text-secondary transition-colors hover:bg-surface-hover lg:inline-flex lg:items-center"
					onClick={onToggleAgentPanel}
					type="button"
				>
					{isAgentPanelOpen ? "Close Ask" : "Ask"}
				</button>

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							aria-label="Open user menu"
							className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-600 text-sm font-medium text-text-inverse transition-colors hover:bg-accent-700"
							type="button"
						>
							{user.email?.[0]?.toUpperCase() ?? "?"}
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuLabel>{user.email}</DropdownMenuLabel>
						<DropdownMenuSeparator />
						<DropdownMenuItem onSelect={() => void navigate({ to: "/settings" })}>
							Settings
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => void handleSignOut()}>Sign out</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	)
}
