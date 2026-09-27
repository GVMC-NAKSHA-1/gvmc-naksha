import { Controller, Get } from '@nestjs/common';
import { VillagesService } from './villages.service';

@Controller('villages')
export class VillagesController {
  constructor(private readonly villages: VillagesService) {}

  @Get() list() { return this.villages.listAll(); }
}
