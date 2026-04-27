import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { config } from "../config"

const ALG = "aes-256-gcm"
const NONCE_LEN = 12 // GCM standard
const TAG_LEN = 16
const DATA_KEY_LEN = 32
const VERSION_BYTE = 0x01

const masterKey = Buffer.from(config.ENCRYPTION_KEY, "base64")

/*
 * Envelope encryption:
 *   plaintext → encrypt with random data key (DEK)
 *   DEK → encrypt with master key (KEK = ENCRYPTION_KEY)
 *
 * Why envelope vs direct master-key encryption:
 *   - Compromise of one ciphertext exposes only its DEK, not the master key.
 *   - Future master-key rotation re-encrypts only DEKs, not plaintext data.
 *   - Different DEK per record means cryptanalysis on bulk data is harder.
 *
 * Ciphertext layout (concatenated bytes):
 *   [ version | dek_nonce | dek_tag | encrypted_dek
 *            | data_nonce | data_tag | encrypted_data ]
 * The leading version byte lets us migrate algorithms without breaking
 * existing rows: future versions read the byte and dispatch.
 */

export function encrypt(plaintext: string): Buffer {
	const dek = randomBytes(DATA_KEY_LEN)

	const dekNonce = randomBytes(NONCE_LEN)
	const dekCipher = createCipheriv(ALG, masterKey, dekNonce)
	const encryptedDek = Buffer.concat([dekCipher.update(dek), dekCipher.final()])
	const dekTag = dekCipher.getAuthTag()

	const dataNonce = randomBytes(NONCE_LEN)
	const dataCipher = createCipheriv(ALG, dek, dataNonce)
	const encryptedData = Buffer.concat([dataCipher.update(plaintext, "utf8"), dataCipher.final()])
	const dataTag = dataCipher.getAuthTag()

	return Buffer.concat([
		Buffer.from([VERSION_BYTE]),
		dekNonce,
		dekTag,
		encryptedDek,
		dataNonce,
		dataTag,
		encryptedData,
	])
}

export function decrypt(ciphertext: Buffer): string {
	let offset = 0
	const version = ciphertext[offset]
	offset += 1
	if (version !== VERSION_BYTE) {
		throw new Error(`unknown ciphertext version: ${version}`)
	}

	const dekNonce = ciphertext.subarray(offset, offset + NONCE_LEN)
	offset += NONCE_LEN
	const dekTag = ciphertext.subarray(offset, offset + TAG_LEN)
	offset += TAG_LEN
	const encryptedDek = ciphertext.subarray(offset, offset + DATA_KEY_LEN)
	offset += DATA_KEY_LEN

	const dataNonce = ciphertext.subarray(offset, offset + NONCE_LEN)
	offset += NONCE_LEN
	const dataTag = ciphertext.subarray(offset, offset + TAG_LEN)
	offset += TAG_LEN
	const encryptedData = ciphertext.subarray(offset)

	const dekDecipher = createDecipheriv(ALG, masterKey, dekNonce)
	dekDecipher.setAuthTag(dekTag)
	const dek = Buffer.concat([dekDecipher.update(encryptedDek), dekDecipher.final()])

	const dataDecipher = createDecipheriv(ALG, dek, dataNonce)
	dataDecipher.setAuthTag(dataTag)
	const plaintext = Buffer.concat([dataDecipher.update(encryptedData), dataDecipher.final()])
	return plaintext.toString("utf8")
}

// Stable, non-reversible identifier safe to attach to log lines.
// Truncated to 8 hex chars — enough for grep, not enough for reverse lookup.
export function fingerprint(plaintext: string): string {
	return createHash("sha256").update(plaintext).digest("hex").slice(0, 8)
}
