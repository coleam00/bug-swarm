import { ServerDecoder } from "../src/shared/arena/snapshot-codec";
// The evidence observers run before the app in an isolated CDP page.
(window as any).ArenaSnapshotDecoder = ServerDecoder;
