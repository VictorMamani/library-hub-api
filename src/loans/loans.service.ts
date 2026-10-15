import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { InventoryService } from '../inventory/inventory.service';

interface LoanRow {
  id: string;
  borrowed_at: Date;
  due_at: Date;
  returned_at: Date | null;
  book_id: string;
  title: string;
  authors: string[];
  cover_id: number | null;
}

const toLoan = (row: LoanRow) => ({
  id: row.id,
  borrowedAt: row.borrowed_at,
  dueAt: row.due_at,
  returnedAt: row.returned_at,
  book: { id: row.book_id, title: row.title, authors: row.authors, coverId: row.cover_id },
});

@Injectable()
export class LoansService {
  constructor(
    private readonly db: DatabaseService,
    private readonly inventory: InventoryService,
    private readonly config: ConfigService,
  ) {}

  async list(userId: string) {
    const result = await this.db.query<LoanRow>(
      'SELECT l.id, l.borrowed_at, l.due_at, l.returned_at, l.book_id, b.title, b.authors, b.cover_id FROM loans l JOIN books b ON b.id = l.book_id WHERE l.user_id = $1 ORDER BY l.borrowed_at DESC',
      [userId],
    );
    return result.rows.map(toLoan);
  }

  async borrow(userId: string, bookId: string) {
    await this.inventory.ensureBook(bookId);
    return this.inventory.withBook(bookId, async (client) => {
      const active = await client.query(
        'SELECT id FROM loans WHERE book_id = $1 AND returned_at IS NULL',
        [bookId],
      );
      if (active.rowCount) throw new ConflictException('El ejemplar ya está prestado.');
      const queue = await client.query<{ id: string; user_id: string }>(
        "SELECT id, user_id FROM reservations WHERE book_id = $1 AND status = 'waiting' ORDER BY created_at, id LIMIT 1",
        [bookId],
      );
      const first = queue.rows[0];
      if (first && first.user_id !== userId)
        throw new ConflictException(
          'El ejemplar está reservado para la primera persona de la cola.',
        );
      const id = randomUUID();
      await client.query(
        "INSERT INTO loans (id, user_id, book_id, due_at) VALUES ($1, $2, $3, now() + ($4 * interval '1 day'))",
        [id, userId, bookId, this.config.getOrThrow<number>('LOAN_DAYS')],
      );
      if (first)
        await client.query(
          "UPDATE reservations SET status = 'fulfilled', closed_at = now() WHERE id = $1",
          [first.id],
        );
      return { id, bookId };
    });
  }

  async returnLoan(userId: string, loanId: string) {
    const result = await this.db.query<{ book_id: string }>(
      'SELECT book_id FROM loans WHERE id = $1 AND user_id = $2 AND returned_at IS NULL',
      [loanId, userId],
    );
    if (!result.rowCount)
      throw new NotFoundException('No se encontró un préstamo activo de tu cuenta.');
    return this.inventory.withBook(result.rows[0].book_id, async (client) => {
      const returned = await client.query(
        'UPDATE loans SET returned_at = now() WHERE id = $1 AND user_id = $2 AND returned_at IS NULL RETURNING id',
        [loanId, userId],
      );
      if (!returned.rowCount)
        throw new NotFoundException('No se encontró un préstamo activo de tu cuenta.');
      return { id: loanId };
    });
  }

  async overview(userId: string, page: number) {
    const pageSize = 10;
    const fields =
      'l.id, l.borrowed_at, l.due_at, l.returned_at, l.book_id, b.title, b.authors, b.cover_id';
    const active = await this.db.query<LoanRow>(
      `SELECT ${fields} FROM loans l JOIN books b ON b.id = l.book_id
       WHERE l.user_id = $1 AND l.returned_at IS NULL ORDER BY l.due_at, l.id`,
      [userId],
    );
    const history = await this.db.query<LoanRow>(
      `SELECT ${fields} FROM loans l JOIN books b ON b.id = l.book_id
       WHERE l.user_id = $1 AND l.returned_at IS NOT NULL ORDER BY l.returned_at DESC, l.id
       LIMIT $2 OFFSET $3`,
      [userId, pageSize, (page - 1) * pageSize],
    );
    const count = await this.db.query<{ total: number }>(
      'SELECT count(*)::int AS total FROM loans WHERE user_id = $1 AND returned_at IS NOT NULL',
      [userId],
    );
    return {
      active: active.rows.map(toLoan),
      history: { items: history.rows.map(toLoan), total: count.rows[0].total, page, pageSize },
    };
  }
}
