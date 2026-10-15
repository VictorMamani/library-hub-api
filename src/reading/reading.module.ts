import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ReadingController } from './reading.controller';
import { ReadingService } from './reading.service';

@Module({
  imports: [AuthModule, InventoryModule],
  controllers: [ReadingController],
  providers: [ReadingService],
})
export class ReadingModule {}
