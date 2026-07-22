// A TTL is read fresh (via getTtlMs) on every miss rather than captured once, so a live change to
// the nugetUpgrade.cacheTTL setting takes effect on the next fetch without an extension reload.
// A TTL of 0ms means "always expired", i.e. caching is effectively disabled.
export class TtlCache<T> {

    private readonly entries = new Map<string, { expiresAt: number; value: Promise<T> }>();

    constructor(private readonly getTtlMs: () => number) {}

    public get(key: string, factory: () => Promise<T>): Promise<T> {
        const now = Date.now();
        const existing = this.entries.get(key);
        if (existing && existing.expiresAt > now) {
            return existing.value;
        }

        const value = factory();
        this.entries.set(key, { expiresAt: now + this.getTtlMs(), value });
        return value;
    }
}
