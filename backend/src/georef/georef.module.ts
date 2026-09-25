import { Module } from '@nestjs/common';
import { GeorefController } from './georef.controller';

@Module({ controllers: [GeorefController] })
export class GeorefModule {}
