import { relations } from "drizzle-orm"
import {
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core"
import { papers } from "./papers"

export const blocks = pgTable(
	"blocks",
	{
		paperId: uuid("paper_id")
			.notNull()
			.references(() => papers.id, { onDelete: "cascade" }),
		// 8-char content hash so the same content reproduces the same id on
		// re-parse. Composite PK with paperId.
		blockId: text("block_id").notNull(),
		blockIndex: integer("block_index").notNull(),
		// MinerU's wider taxonomy collapses to these eight; heading vs text is
		// disambiguated via heading_level.
		type: text("type", {
			enum: ["text", "heading", "figure", "table", "equation", "list", "code", "other"],
		}).notNull(),
		// 1-indexed for the UI; MinerU's page_idx is 0-indexed and we translate.
		page: integer("page").notNull(),
		// {x, y, w, h} as ratios in [0, 1] of the page's rasterized pixel
		// dimensions. If page size is unavailable, bbox is stored as null rather
		// than raw pixels so the frontend never mis-renders overlays.
		bbox: jsonb("bbox").$type<{ x: number; y: number; w: number; h: number } | null>(),
		text: text("text").notNull().default(""),
		headingLevel: integer("heading_level"),
		caption: text("caption"),
		// Type-specific overflow: tableHtml, listItems, originalType, ...
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		imageObjectKey: text("image_object_key"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		primaryKey({ name: "blocks_pkey", columns: [table.paperId, table.blockId] }),
		index("idx_blocks_paper_index").on(table.paperId, table.blockIndex),
		index("idx_blocks_paper_page").on(table.paperId, table.page),
	],
)

export const blocksRelations = relations(blocks, ({ one }) => ({
	paper: one(papers, {
		fields: [blocks.paperId],
		references: [papers.id],
	}),
}))

export type Block = typeof blocks.$inferSelect
export type NewBlock = typeof blocks.$inferInsert
