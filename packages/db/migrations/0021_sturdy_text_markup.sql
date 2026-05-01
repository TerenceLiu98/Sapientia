DELETE FROM "reader_annotations"
WHERE "kind" = 'ink'
   OR "kind" NOT IN ('highlight', 'underline');
--> statement-breakpoint

WITH highlight_rects AS (
	SELECT
		"id",
		GREATEST(0, LEAST(1, (("body"->'rect'->>'x')::double precision))) AS x,
		GREATEST(0, LEAST(1, (("body"->'rect'->>'y')::double precision))) AS y,
		GREATEST(0, LEAST(1, (("body"->'rect'->>'w')::double precision))) AS raw_w,
		GREATEST(0, LEAST(1, (("body"->'rect'->>'h')::double precision))) AS raw_h,
		COALESCE("body"->>'quote', '') AS quote
	FROM "reader_annotations"
	WHERE "kind" = 'highlight'
		AND "body" ? 'rect'
		AND NOT ("body" ? 'rects')
)
UPDATE "reader_annotations" AS ra
SET "body" = jsonb_build_object(
	'rects',
	jsonb_build_array(
		jsonb_build_object(
			'x', hr.x,
			'y', hr.y,
			'w', LEAST(1 - hr.x, GREATEST(0.01, hr.raw_w)),
			'h', LEAST(1 - hr.y, GREATEST(0.012, hr.raw_h))
		)
	),
	'quote',
	hr.quote
)
FROM highlight_rects AS hr
WHERE ra."id" = hr."id";
--> statement-breakpoint

WITH underline_rects AS (
	SELECT
		"id",
		GREATEST(
			0,
			LEAST(
				1,
				LEAST(
					("body"->'from'->>'x')::double precision,
					("body"->'to'->>'x')::double precision
				)
			)
		) AS x,
		GREATEST(
			0,
			LEAST(
				1,
				LEAST(
					("body"->'from'->>'y')::double precision,
					("body"->'to'->>'y')::double precision
				) - 0.006
			)
		) AS y,
		GREATEST(
			0.01,
			ABS((("body"->'to'->>'x')::double precision) - (("body"->'from'->>'x')::double precision))
		) AS raw_w,
		GREATEST(
			0.012,
			ABS((("body"->'to'->>'y')::double precision) - (("body"->'from'->>'y')::double precision)) + 0.012
		) AS raw_h,
		COALESCE("body"->>'quote', '') AS quote
	FROM "reader_annotations"
	WHERE "kind" = 'underline'
		AND "body" ? 'from'
		AND "body" ? 'to'
		AND NOT ("body" ? 'rects')
)
UPDATE "reader_annotations" AS ra
SET "body" = jsonb_build_object(
	'rects',
	jsonb_build_array(
		jsonb_build_object(
			'x', ur.x,
			'y', ur.y,
			'w', LEAST(1 - ur.x, ur.raw_w),
			'h', LEAST(1 - ur.y, ur.raw_h)
		)
	),
	'quote',
	ur.quote
)
FROM underline_rects AS ur
WHERE ra."id" = ur."id";
--> statement-breakpoint

ALTER TABLE "reader_annotations"
ADD CONSTRAINT "reader_annotations_kind_text_markup_check"
CHECK ("kind" IN ('highlight', 'underline'));
