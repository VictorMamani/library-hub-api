import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LoansController } from './loans.controller';
import { LoansService } from './loans.service';

@Module({
  imports: [AuthModule, InventoryModule],
  controllers: [LoansController],
  providers: [LoansService],
})
export class LoansModule {}
