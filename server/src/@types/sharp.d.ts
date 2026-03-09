// Local type declaration for sharp.
// sharp bundles its own types in lib/index.d.ts, but some CI environments
// fail to resolve them via module resolution. This declaration ensures
// TypeScript always has a definition regardless of environment.
declare module 'sharp' {
    interface SharpInstance {
        png(options?: { quality?: number; compressionLevel?: number; progressive?: boolean }): SharpInstance;
        toBuffer(): Promise<Buffer>;
    }

    function sharp(input?: Buffer | ArrayBuffer | string): SharpInstance;

    export = sharp;
}
