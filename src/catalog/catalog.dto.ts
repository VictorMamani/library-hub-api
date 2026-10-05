import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CatalogQuery {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  q = '';

  @IsOptional()
  @IsIn(['', 'fiction', 'science', 'history', 'computers'])
  category = '';

  @IsOptional()
  @IsIn(['relevance', 'new', 'old'])
  sort = 'relevance';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page = 1;
}
