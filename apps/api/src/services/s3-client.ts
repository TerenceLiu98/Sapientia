import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3"
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
