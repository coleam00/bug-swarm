import { ServerDecoder } from "../src/shared/arena/snapshot-codec";

/** CDP exposes binary WebSocket payloadData as base64, not UTF-8 JSON. */
export class CdpSnapshots {
  private sockets = new Map<string, ServerDecoder>();
  created(requestId: string) { this.sockets.set(requestId, new ServerDecoder()); }
  closed(requestId: string) { this.sockets.delete(requestId); }
  read(requestId: string, frame: { opcode: number; payloadData: string }) {
    const decoder = this.sockets.get(requestId);
    if (!decoder || frame.opcode !== 1 && frame.opcode !== 2) return null;
    const message = decoder.read(frame.opcode === 1 ? frame.payloadData : Buffer.from(frame.payloadData, "base64"));
    if (!message) throw Error("CDP snapshot is missing its base");
    return message;
  }
}
