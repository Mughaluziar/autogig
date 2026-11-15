export declare function signEdge(secret: string, ts: string, method: string, path: string, ip: string, nonce: string): Promise<string>;
export declare const EDGE_HEADERS: string[];
export declare function clientIpFrom(headers: Headers): string;
export declare function decodePath(pathname: string): string;
