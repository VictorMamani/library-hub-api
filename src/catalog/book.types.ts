export interface Book {
  id: string;
  title: string;
  authors: string[];
  coverId: number | null;
  publicationYear: number | null;
  subjects: string[];
  description: string;
  available: boolean;
  availability?: 'available' | 'borrowed' | 'reserved';
  loanDays?: number;
  readingCount?: number;
}

export interface CatalogPage {
  books: Book[];
  total: number;
  page: number;
  pageSize: number;
  matchedTotal?: number;
  authorSortLimit?: number;
}
