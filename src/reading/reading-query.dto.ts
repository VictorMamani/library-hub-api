import { IsIn, IsOptional } from 'class-validator';
import { PageQuery } from '../loans/page.dto';

export class ReadingQuery extends PageQuery {
  @IsOptional()
  @IsIn(['', 'wishlist', 'reading', 'completed'])
  status = '';
}
