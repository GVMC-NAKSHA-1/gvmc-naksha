import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';

export class DatasetSampleDto {
  @IsArray() @IsString({ each: true }) columns!: string[];
  @IsArray() sampleRows!: Record<string, unknown>[];
}
export class LabelMatchDto {
  @IsBoolean() label!: boolean;          // true = same land record, false = not a match
}
export class SchemaMapDto {
  @ValidateNested() @Type(() => DatasetSampleDto) a!: DatasetSampleDto;
  @ValidateNested() @Type(() => DatasetSampleDto) b!: DatasetSampleDto;
  @IsOptional() @IsUUID() sourceAId?: string;
  @IsOptional() @IsUUID() sourceBId?: string;
}
