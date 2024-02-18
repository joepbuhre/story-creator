// logger.js
import pino, { Logger } from "pino";
import pinoPrettyTransport from "./pino-pretty-transport";
import WebSocketStream from "./web-socket-stream";

// Create a logging instance
export const logger = pino(
    {
        formatters: {
            level: (label) => {
                return { level: label };
            },
        },
        level: process.env.LOG_LEVEL || "debug",
        name: process.env.LOGGER_NAME,
        redact: {
            paths: ["email", "password", "token"],
        },
        // https://github.com/pinojs/pino/issues/674
        timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.multistream([
        {
            level: "debug",
            stream: pinoPrettyTransport(),
        },
        {
            level: "debug",
            stream: new WebSocketStream(),
        },
    ])
);
