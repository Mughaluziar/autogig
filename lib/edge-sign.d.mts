export function signEdge(secret: string, ts: string, method: string, path: string, ip: string): Promise<string>;
export const EDGE_HEADERS: string[];
export function clientIpFrom(headers: Headers): string;
export function decodePath(pathname: string): string;
