import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { config } from "../config"

export const s3Client = new S3Client({
	endpoint: config.S3_ENDPOINT,
	region: config.S3_REGION,
	credentials: {
		accessKeyId: config.S3_ACCESS_KEY_ID,
		secretAccessKey: config.S3_SECRET_ACCESS_KEY,
	},
	forcePathStyle: config.S3_FORCE_PATH_STYLE,
	// AWS SDK v3 defaults flexible checksums to WHEN_SUPPORTED, which adds
	// `x-amz-checksum-mode=ENABLED` to presigned GET URLs. AWS S3 accepts that,
	// but some MinIO versions reject the resulting signed URL with 403.
	requestChecksumCalculation: "WHEN_REQUIRED",
	responseChecksumValidation: "WHEN_REQUIRED",
})

// Belt-and-suspenders: even with `responseChecksumValidation: "WHEN_REQUIRED"`
// the SDK's flexible-checksums middleware still injects
// `x-amz-checksum-mode=ENABLED` into the request, which becomes part of the
// SigV4 canonical query string. MinIO doesn't recognise it but still folds it
// into its own signature calculation → mismatch → 403. We strip both the
// header and the query param from every request before it reaches the
// signer. AWS's real S3 ignores this strip; MinIO is happy without it.
s3Client.middlewareStack.add(
	(next) => async (args) => {
		const req = args.request as {
			headers?: Record<string, string>
			query?: Record<string, string | undefined>
		}
		if (req.headers) {
			delete req.headers["x-amz-checksum-mode"]
			delete req.headers["X-Amz-Checksum-Mode"]
		}
		if (req.query) {
			delete req.query["x-amz-checksum-mode"]
			delete req.query["X-Amz-Checksum-Mode"]
		}
		return next(args)
	},
	{ step: "build", name: "stripChecksumModeForMinio", priority: "high" },
)

export async function checkS3Health(): Promise<boolean> {
	try {
		await s3Client.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }))
		return true
	} catch {
		return false
	}
}

export async function uploadPdfToS3(content: Uint8Array, key: string): Promise<void> {
	await s3Client.send(
		new PutObjectCommand({
			Bucket: config.S3_BUCKET,
			Key: key,
			Body: content,
			ContentType: "application/pdf",
			// Pass ContentLength explicitly so the SDK doesn't fall back to its
			// "stream of unknown length" warning + chunked-encoding path.
			ContentLength: content.byteLength,
		}),
	)
}

export async function generatePresignedGetUrl(key: string, ttlSeconds = 3600): Promise<string> {
	return getSignedUrl(
		s3Client,
		new GetObjectCommand({
			Bucket: config.S3_BUCKET,
			Key: key,
		}),
		{ expiresIn: ttlSeconds },
	)
}

export async function downloadFromS3(key: string): Promise<Uint8Array> {
	const res = await s3Client.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }))
	if (!res.Body) {
		throw new Error(`object ${key} has no body`)
	}
	return res.Body.transformToByteArray()
}
