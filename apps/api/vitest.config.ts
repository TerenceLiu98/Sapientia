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

export default defineConfig({
	test: {
		globals: false,
		environment: "node",
		testTimeout: 120_000,
		hookTimeout: 120_000,
	},
})
