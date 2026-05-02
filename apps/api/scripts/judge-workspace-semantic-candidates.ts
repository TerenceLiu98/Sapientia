#!/usr/bin/env bun
import { judgeWorkspaceSemanticCandidates } from "../src/services/semantic-candidate-judgement"

type Args = {
	workspaceId: string | null
	userId: string | null
	limit: number
	force: boolean
}

async function main() {
	const args = parseArgs(process.argv.slice(2))
	if (!args.workspaceId || !args.userId) {
		console.error(
			"Usage: bun apps/api/scripts/judge-workspace-semantic-candidates.ts --workspace <uuid> --user <id> [--limit 12] [--force]",
		)
		process.exit(1)
	}

	const result = await judgeWorkspaceSemanticCandidates({
		workspaceId: args.workspaceId,
		userId: args.userId,
		limit: args.limit,
		force: args.force,
	})
	console.log(JSON.stringify(result, null, 2))
}

function parseArgs(argv: string[]): Args {
	const args: Args = {
		workspaceId: null,
		userId: null,
		limit: 12,
		force: false,
	}
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index]
		if (value === "--workspace") args.workspaceId = argv[++index] ?? null
		if (value === "--user") args.userId = argv[++index] ?? null
		if (value === "--limit") args.limit = Number(argv[++index] ?? args.limit)
		if (value === "--force") args.force = true
	}
	if (!Number.isFinite(args.limit) || args.limit < 1) args.limit = 12
	return args
}

void main().catch((error) => {
	console.error(error)
	process.exit(1)
})
