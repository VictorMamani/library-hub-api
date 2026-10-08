import { Module } from '@nestjs/common';
import { OpenLibraryClient } from './open-library.client';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';

@Module({
  controllers: [CatalogController],
  providers: [CatalogService, OpenLibraryClient],
  exports: [CatalogService],
})
export class CatalogModule {}
