import { clients, websocketServer } from ".";

export default class WebSocketStream {
    write(chunk: string) {
        let logLine = JSON.parse(chunk);

        if (logLine?.trace_id) {
            let client = clients.get(logLine.trace_id);
            if (client === undefined) {
                return;
            }
            client.send(JSON.stringify(logLine));
        }
    }
}
