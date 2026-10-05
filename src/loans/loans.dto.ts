import { IsString, Matches } from 'class-validator';

export class BorrowDto {
  @IsString()
  @Matches(/^OL\d+W$/)
  bookId!: string;
}
