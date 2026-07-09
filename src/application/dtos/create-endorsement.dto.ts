// ═══════════════════════════════════════════════════════════════════════════
// CREATE ENDORSEMENT DTO — Data Transfer Object
// Valida y documenta los datos de entrada para crear un endoso.
//
// class-validator: decoradores de validación en tiempo de ejecución
// @ApiProperty: decoradores de documentación Swagger
// ═══════════════════════════════════════════════════════════════════════════

import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsObject,
  IsArray,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';


/**
 * @class CreateEndorsementDto
 * @description Datos requeridos para iniciar el proceso de emisión de un endoso.
 *
 * Este DTO refleja la interfaz EndorsementRequest del frontend.
 * class-validator rechazará automáticamente requests con campos inválidos
 * gracias al ValidationPipe global configurado en main.ts.
 */
export class CreateEndorsementDto {
  @ApiProperty({
    description: 'ID de la póliza en el sistema del asegurador',
    example: 'POL-001',
    minLength: 1,
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty({ message: 'El ID de póliza es requerido' })
  @MinLength(1)
  @MaxLength(100)
  policyId: string;

  @ApiProperty({
    description: 'ID del tipo de endoso según la configuración del tenant',
    example: 'plan-increment',
    minLength: 1,
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty({ message: 'El tipo de endoso es requerido' })
  @MinLength(1)
  @MaxLength(100)
  endorsementTypeId: string;

  @ApiPropertyOptional({
    description: 'ID de la ruta de endoso (para endosos cuantitativos)',
    example: 'route-basic-to-plata',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  routeId?: string;

  @ApiProperty({
    description: 'ID del canal de venta (backoffice, digital, agencia, etc.)',
    example: 'backoffice',
    minLength: 1,
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty({ message: 'El canal es requerido' })
  @MaxLength(100)
  channelId: string;

  @ApiProperty({
    description: 'Fecha efectiva del endoso (ISO 8601: YYYY-MM-DD)',
    example: '2025-01-15',
    format: 'date',
  })
  @IsDateString({}, { message: 'La fecha efectiva debe ser una fecha válida (YYYY-MM-DD)' })
  @IsNotEmpty()
  effectiveDate: string;

  @ApiPropertyOptional({
    description: 'Datos del formulario dinámico. Campos según el tipo de endoso.',
    example: { newPlanCode: 'PLATA', reason: 'Mejora de cobertura' },
  })
  @IsOptional()
  @IsObject()
  formData?: Record<string, unknown>;
}

/**
 * @class EvaluateRulesDto
 * @description Datos para pre-evaluar las reglas de un endoso sin persistirlo.
 * Usado en el endpoint POST /endorsements/evaluate para el paso del wizard.
 */
export class EvaluateRulesDto {
  @ApiProperty({ description: 'ID de la póliza', example: 'POL-001' })
  @IsString()
  @IsNotEmpty()
  policyId: string;

  @ApiProperty({ description: 'ID del canal', example: 'backoffice' })
  @IsString()
  @IsNotEmpty()
  channelId: string;
}

/**
 * @class CalculateEndorsementDto
 * @description Datos para pre-calcular el costo de un endoso sin persistirlo.
 * Permite al usuario ver el costo antes de confirmar.
 */
export class CalculateEndorsementDto {
  @ApiProperty({ description: 'ID de la póliza', example: 'POL-001' })
  @IsString()
  @IsNotEmpty()
  policyId: string;

  @ApiProperty({ description: 'ID de la ruta de endoso', example: 'route-basic-to-plata' })
  @IsString()
  @IsNotEmpty()
  routeId: string;

  @ApiProperty({ description: 'Fecha efectiva del endoso', example: '2025-01-15' })
  @IsDateString()
  effectiveDate: string;
}
