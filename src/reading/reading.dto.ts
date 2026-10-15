import { IsIn } from 'class-validator';

export class ReadingDto {
  @IsIn(['none', 'wishlist', 'reading', 'completed'])
  status!: 'none' | 'wishlist' | 'reading' | 'completed';
}
