export interface Book {
  id: string;
  title: string;
  authors: string[];
  coverId: number | null;
  publicationYear: number | null;
  subjects: string[];
  description: string;
  available: boolean;
}

export interface CatalogPage {
  books: Book[];
  total: number;
  page: number;
  pageSize: number;
}
