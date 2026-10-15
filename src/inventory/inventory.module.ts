import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { InventoryService } from './inventory.service';

@Module({ imports: [CatalogModule], providers: [InventoryService], exports: [InventoryService] })
export class InventoryModule {}
