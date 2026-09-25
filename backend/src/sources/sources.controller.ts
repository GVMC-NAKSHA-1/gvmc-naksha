import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../common/roles.decorator';
import { SourcesService } from './sources.service';
import { CreateSourceDto, ListSourcesDto } from './dto';

@Controller('sources')
export class SourcesController {
  constructor(private readonly svc: SourcesService) {}

  @Post('upload')
  @Roles('admin', 'analyst')
  @HttpCode(202)
  createUpload(@Body() dto: CreateSourceDto, @Req() req: any) { return this.svc.registerAndPresign(dto, req.user.id); }

  @Post(':id/complete')
  @Roles('admin', 'analyst')
  @HttpCode(202)
  complete(@Param('id') id: string, @Req() req: any) { return this.svc.completeUpload(id, req.user.id); }

  @Get()
  list(@Query() q: ListSourcesDto) { return this.svc.list(q); }

  @Get(':id')
  getOne(@Param('id') id: string) { return this.svc.getWithDownloadUrl(id); }

  @Get(':id/features')
  features(@Param('id') id: string) { return this.svc.featuresGeoJSON(id); }

  @Post(':id/digitize')
  @Roles('admin', 'analyst')
  @HttpCode(202)
  digitize(@Param('id') id: string) { return this.svc.enqueueOcr(id); }
}
