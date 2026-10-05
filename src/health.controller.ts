import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from './database/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}
  @Get() async health() {
    await this.db.query('SELECT 1');
    return { status: 'ok' };
  }
}
