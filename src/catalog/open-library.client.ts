import { BadGatewayException, Injectable, NotFoundException } from '@nestjs/common';

@Injectable()
export class OpenLibraryClient {
  private readonly cache = new Map<string, { expires: number; value: unknown }>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private queue: Promise<void> = Promise.resolve();
  private nextRequest = 0;

  request<T>(url: URL): Promise<T> {
    const key = url.href;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return Promise.resolve(cached.value as T);
    const pending = this.pending.get(key);
    if (pending) return pending as Promise<T>;

    const gate = this.queue.then(async () => {
      const delay = Math.max(0, this.nextRequest - Date.now());
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      this.nextRequest = Date.now() + 1100;
    });
    this.queue = gate.catch(() => undefined);
    const result = gate
      .then(async () => {
        try {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(15000),
            headers: {
              'User-Agent': 'LibraryHub/0.1 (academic catalog application)',
              Accept: 'application/json',
            },
          });
          if (response.status === 404)
            throw new NotFoundException('El libro no está disponible en el catálogo.');
          if (!response.ok) throw new Error(`Open Library ${response.status}`);
          const value: unknown = await response.json();
          if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
          this.cache.set(key, { expires: Date.now() + 60000, value });
          return value;
        } catch (error) {
          if (error instanceof NotFoundException) throw error;
          throw new BadGatewayException('No se pudo consultar Open Library. Intenta nuevamente.');
        }
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, result);
    return result as Promise<T>;
  }
}
