import { Module } from '@nestjs/common';
import { CrsController } from './crs.controller';

@Module({ controllers: [CrsController] })
export class CrsModule {}
