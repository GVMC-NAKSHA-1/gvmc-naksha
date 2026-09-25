import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { IsArray, IsString } from 'class-validator';
import { CRS_LIST, transformPoints } from './crs';

export class TransformDto {
  @IsString() from!: string;
  @IsString() to!: string;
  @IsArray() points!: [number, number][];
}

/** Coordinate transformation engine (WGS84, UTM 43–45N, Kalianpur 1975, India LCC, Web Mercator). */
@Controller('crs')
export class CrsController {
  @Get()
  list() {
    return CRS_LIST.map(({ code, name, units }) => ({ code, name, units }));
  }

  @Post('transform')
  transform(@Body() dto: TransformDto) {
    if (dto.points.length > 10000) throw new BadRequestException('at most 10 000 points per request');
    const pts = dto.points.map((p, i) => {
      const [x, y] = [Number(p?.[0]), Number(p?.[1])];
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new BadRequestException(`point #${i + 1} is not [x, y]`);
      return [x, y] as [number, number];
    });
    try {
      return { from: dto.from, to: dto.to, points: transformPoints(dto.from, dto.to, pts) };
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }
  }
}
