import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogQuery } from './catalog.dto';

@Controller('books')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}
  @Get() search(@Query() query: CatalogQuery) {
    return this.catalog.search(query);
  }
  @Get(':id') detail(@Param('id') id: string) {
    return this.catalog.detail(id);
  }
}
