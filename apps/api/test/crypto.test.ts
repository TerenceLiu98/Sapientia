import { describe, expect, it, vi } from "vitest"

const baseEnv = {
	NODE_ENV: "test",
	LOG_LEVEL: "error",
	DATABASE_URL: "postgresql://sapientia:dev_password@localhost:5432/sapientia_dev",
	REDIS_URL: "redis://localhost:6379",
	S3_ENDPOINT: "http://localhost:9000",
	S3_ACCESS_KEY_ID: "test",
	S3_SECRET_ACCESS_KEY: "test",
	BETTER_AUTH_SECRET: "test_secret_32_chars_minimum_aaaa",
	BETTER_AUTH_URL: "http://localhost:3000",
	ENCRYPTION_KEY: "vmJVlH/PNqbzZGyWB5INuG2ZhuM9Q4jK0r4zNLmUKQk=",
} satisfies NodeJS.ProcessEnv

async function importCrypto() {
	vi.resetModules()
	Object.assign(process.env, baseEnv)
	return await import("../src/services/crypto")
}

describe("crypto envelope encryption", () => {
	it("round-trips a plaintext string", async () => {
		const { encrypt, decrypt } = await importCrypto()
		const cipher = encrypt("hello mineru")
		expect(decrypt(cipher)).toBe("hello mineru")
	})

	it("produces different ciphertext for the same plaintext (random nonces + DEKs)", async () => {
		const { encrypt } = await importCrypto()
		const a = encrypt("same secret")
		const b = encrypt("same secret")
		expect(a.equals(b)).toBe(false)
	})

	it("decryption with a different master key throws", async () => {
		const { encrypt } = await importCrypto()
		const cipher = encrypt("the answer")

		// Re-import the module under a different ENCRYPTION_KEY.
		vi.resetModules()
		Object.assign(process.env, {
			...baseEnv,
			// A different valid 32-byte base64 key (44 chars, distinct from baseEnv).
			ENCRYPTION_KEY: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
		})
		const { decrypt: decryptWithWrongKey } = await import("../src/services/crypto")
		expect(() => decryptWithWrongKey(cipher)).toThrow()
	})

	it("decryption of a tampered ciphertext throws", async () => {
		const { encrypt, decrypt } = await importCrypto()
		const cipher = encrypt("integrity matters")
		const tampered = Buffer.from(cipher)
		// Flip a byte deep inside the encrypted payload.
		tampered[tampered.length - 1] ^= 0xff
		expect(() => decrypt(tampered)).toThrow()
	})

	it("rejects ciphertext with an unknown version byte", async () => {
		const { encrypt, decrypt } = await importCrypto()
		const cipher = encrypt("future-proofing")
		const wrongVersion = Buffer.from(cipher)
		wrongVersion[0] = 0xff
		expect(() => decrypt(wrongVersion)).toThrow(/version/i)
	})

	it("fingerprint is stable and reveals 8 hex chars", async () => {
		const { fingerprint } = await importCrypto()
		const fp = fingerprint("the key")
		expect(fp).toMatch(/^[0-9a-f]{8}$/)
		expect(fingerprint("the key")).toBe(fp)
		expect(fingerprint("a different key")).not.toBe(fp)
	})
})
