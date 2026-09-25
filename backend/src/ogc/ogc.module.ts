import { Module } from '@nestjs/common';
import { OgcController } from './ogc.controller';

@Module({ controllers: [OgcController] })
export class OgcModule {}
