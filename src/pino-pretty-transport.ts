import pretty, { PrettyOptions, colorizerFactory } from "pino-pretty";

const colorYellow = (msg: string) => {
    return `\u001b[33m${msg}\u001b[0m`;
};

export default (opts?: PrettyOptions) =>
    pretty({
        messageFormat: (log): string => {
            if (log.trace_id) {
                return `[${colorYellow(<string>log.trace_id)}\u001b[36m] ${
                    log.msg
                }`;
            } else {
                return <string>log.msg;
            }
        },
        ignore: "trace_id,hostname,pid",
        ...opts,
    });
