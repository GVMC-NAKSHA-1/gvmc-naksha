import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class CreateSourceDto {
  @IsIn(['drone_imagery','ori','dsm_dtm','cadastral','revenue','municipal_gis','utility','ground_truth','gnss_cors','building_footprint','ai_extracted'])
  type!: string;
  @IsOptional() @IsString() wardId?: string;
  @IsOptional() @IsString() originalName?: string;
  @IsOptional() @Matches(/^EPSG:\d{4,6}$/) crs?: string;
  @IsOptional() @IsDateString() capturedAt?: string;
  @IsOptional() @IsBoolean() scanned?: boolean;
}
export class ListSourcesDto {
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() wardId?: string;
  @IsOptional() @IsString() status?: string;
}
