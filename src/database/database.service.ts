import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, QueryResultRow } from 'pg';
import { runMigrations } from './migrations';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly pool: Pool;

  constructor(config: ConfigService) {
    this.pool = new Pool({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
      ssl: config.get<string>('DATABASE_SSL') === 'true' ? { rejectUnauthorized: true } : false,
      max: 10,
      connectionTimeoutMillis: 5000,
    });
  }

  async onModuleInit() {
    await runMigrations(this.pool);
  }

  query<T extends QueryResultRow>(sql: string, parameters: unknown[] = []) {
    return this.pool.query<T>(sql, parameters);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
