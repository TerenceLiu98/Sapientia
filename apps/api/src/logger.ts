import pino from "pino"
import { config } from "./config"

const REDACT_PATHS = [
	"password",
	"apiKey",
	"api_key",
	"token",
	"secret",
	"authorization",
	"*.password",
	"*.apiKey",
	"*.token",
	"*.secret",
	"*.authorization",
]

export const logger = pino({
	level: config.LOG_LEVEL,
	redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
	...(config.NODE_ENV === "development"
		? {
				transport: {
					target: "pino-pretty",
					options: {
						colorize: true,
						singleLine: false,
					},
				},
			}
		: {}),
})
