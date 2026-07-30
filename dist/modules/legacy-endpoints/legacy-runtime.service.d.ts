type AnyRecord = Record<string, any>;
export declare class LegacyRuntimeService {
    private readonly logger;
    private readonly controllers;
    private readonly middleware;
    private initPromise?;
    private controller;
    private middlewareFor;
    private initialize;
    private parseMultipart;
    private runMiddleware;
    handle(request: AnyRecord, reply: AnyRecord): Promise<void>;
}
export {};
