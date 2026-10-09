import { Module } from '@nestjs/common';
import { AdminOperatorsController } from './admin-operators.controller';
import { OperatorsService } from './operators.service';

@Module({
  controllers: [AdminOperatorsController],
  providers: [OperatorsService],
})
export class OperatorsModule {}
