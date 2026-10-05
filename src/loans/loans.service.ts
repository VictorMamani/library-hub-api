import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { CatalogService } from '../catalog/catalog.service';

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
    private readonly catalog: CatalogService,
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
    const book = await this.catalog.detail(bookId);
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO books (id, title, authors, cover_id, publication_year, subjects, description) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING',
        [
          book.id,
          book.title,
          JSON.stringify(book.authors),
          book.coverId,
          book.publicationYear,
          JSON.stringify(book.subjects),
          book.description,
        ],
      );
      const id = randomUUID();
      await client.query(
        "INSERT INTO loans (id, user_id, book_id, due_at) VALUES ($1, $2, $3, now() + ($4 * interval '1 day'))",
        [id, userId, book.id, this.config.getOrThrow<number>('LOAN_DAYS')],
      );
      await client.query('COMMIT');
      return { id, bookId: book.id };
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException('El ejemplar ya está prestado.');
      throw error;
    } finally {
      client.release();
    }
  }

  async returnLoan(userId: string, loanId: string) {
    const result = await this.db.query(
      'UPDATE loans SET returned_at = now() WHERE id = $1 AND user_id = $2 AND returned_at IS NULL RETURNING id',
      [loanId, userId],
    );
    if (!result.rowCount)
      throw new NotFoundException('No se encontró un préstamo activo de tu cuenta.');
    return { id: loanId };
  }
}
