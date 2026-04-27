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
})

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
