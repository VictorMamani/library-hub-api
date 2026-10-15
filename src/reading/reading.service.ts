import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { InventoryService } from '../inventory/inventory.service';
import { ReadingDto } from './reading.dto';
import { ReadingQuery } from './reading-query.dto';

@Injectable()
export class ReadingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly inventory: InventoryService,
  ) {}

  async list(userId: string, query: ReadingQuery) {
    const pageSize = 10;
    const count = await this.db.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM reading_states WHERE user_id = $1 AND ($2 = '' OR status = $2)",
      [userId, query.status],
    );
    const result = await this.db.query<{
      status: ReadingDto['status'];
      updated_at: Date;
      id: string;
      title: string;
      authors: string[];
      cover_id: number | null;
    }>(
      `SELECT r.status, r.updated_at, b.id, b.title, b.authors, b.cover_id
       FROM reading_states r JOIN books b ON b.id = r.book_id WHERE r.user_id = $1 AND ($2 = '' OR r.status = $2)
       ORDER BY r.updated_at DESC, b.id LIMIT $3 OFFSET $4`,
      [userId, query.status, pageSize, (query.page - 1) * pageSize],
    );
    return {
      items: result.rows.map((row) => ({
        status: row.status,
        updatedAt: row.updated_at,
        book: { id: row.id, title: row.title, authors: row.authors, coverId: row.cover_id },
      })),
      total: count.rows[0].total,
      page: query.page,
      pageSize,
    };
  }

  async get(userId: string, bookId: string) {
    const result = await this.db.query<{ status: ReadingDto['status'] }>(
      'SELECT status FROM reading_states WHERE user_id = $1 AND book_id = $2',
      [userId, bookId],
    );
    return { status: result.rows[0]?.status ?? 'none' };
  }

  async set(userId: string, bookId: string, status: ReadingDto['status']) {
    if (status === 'none') {
      await this.db.query('DELETE FROM reading_states WHERE user_id = $1 AND book_id = $2', [
        userId,
        bookId,
      ]);
    } else {
      await this.inventory.ensureBook(bookId);
      await this.db.query(
        `INSERT INTO reading_states (user_id, book_id, status) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, book_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now()`,
        [userId, bookId, status],
      );
    }
    return { status };
  }
}
