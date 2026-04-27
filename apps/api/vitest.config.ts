import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { defineConfig } from "vitest/config"

// testcontainers-node looks at DOCKER_HOST. Under colima or rootless docker
// the socket isn't at /var/run/docker.sock; probe the common locations.
if (!process.env.DOCKER_HOST) {
	const candidates = [
		join(homedir(), ".colima/default/docker.sock"),
		join(homedir(), ".docker/run/docker.sock"),
		"/var/run/docker.sock",
	]
	for (const path of candidates) {
		if (existsSync(path)) {
			process.env.DOCKER_HOST = `unix://${path}`
			break
		}
	}
}

// Inside the colima VM the socket lives at /var/run/docker.sock, so tell ryuk
// (and any other container that bind-mounts the socket) to use that path
// instead of the host-side colima socket.
if (process.env.DOCKER_HOST?.includes(".colima/")) {
	process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE ??= "/var/run/docker.sock"
}

process.env.NODE_ENV ??= "test"
process.env.DATABASE_URL ??= "postgresql://sapientia:dev_password@localhost:5432/sapientia_test"
process.env.REDIS_URL ??= "redis://localhost:6379"
process.env.S3_ENDPOINT ??= "http://localhost:9000"
process.env.S3_ACCESS_KEY_ID ??= "minioadmin"
process.env.S3_SECRET_ACCESS_KEY ??= "minioadmin"
process.env.S3_BUCKET ??= "sapientia"
process.env.S3_REGION ??= "us-east-1"
process.env.S3_FORCE_PATH_STYLE ??= "true"
process.env.BETTER_AUTH_SECRET ??= "test-secret-with-at-least-thirty-two-characters"
process.env.BETTER_AUTH_URL ??= "http://localhost:3000"
process.env.FRONTEND_ORIGIN ??= "http://localhost:5173"
process.env.ENCRYPTION_KEY ??= "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="

export default defineConfig({
	test: {
		globals: false,
		environment: "node",
		testTimeout: 120_000,
		hookTimeout: 120_000,
	},
})
