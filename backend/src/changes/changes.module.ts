import { Module } from '@nestjs/common';
import { ChangesController } from './changes.controller';

@Module({ controllers: [ChangesController] })
export class ChangesModule {}
