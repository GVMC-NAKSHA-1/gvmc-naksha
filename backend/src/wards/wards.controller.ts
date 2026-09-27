import { Controller, Get, Param, Query } from '@nestjs/common';
import { WardsService } from './wards.service';
import { UnassessedQueryDto } from './dto';

@Controller('wards')
export class WardsController {
  constructor(private readonly wards: WardsService) {}

  @Get()                       list() { return this.wards.listWards(); }
  @Get(':id/changes')          changes(@Param('id') id: string) { return this.wards.getChanges(id); }
  @Get(':id/unassessed')       unassessed(@Param('id') id: string, @Query() q: UnassessedQueryDto) {
                                 return this.wards.getUnassessed(id, q); }
  @Get(':id/alerts')           alerts(@Param('id') id: string) { return this.wards.getAlerts(id); }
  @Get(':id/geojson')          geojson(@Param('id') id: string) { return this.wards.getWardGeoJSON(id); }
  @Get(':id/villages')         villages(@Param('id') id: string) { return this.wards.getVillages(id); }
}
