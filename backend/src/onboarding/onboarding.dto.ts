import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AccountType } from '../../generated/prisma/enums.ts';

export class CreateCustomerDto {
  @IsString()
  @MinLength(3, { message: 'Enter the customer\'s full name' })
  @MaxLength(80)
  fullName!: string;

  @IsEmail({}, { message: 'A valid email address is required' })
  email!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[\d\s-]{7,20}$/, { message: 'Enter a valid phone number' })
  phone?: string;

  /** Chosen by the customer at the desk and keyed in by the admin. */
  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'PIN must be 4 to 6 digits' })
  pin!: string;

  @IsOptional()
  @IsEnum(AccountType, { message: 'Account type must be CHECKING or SAVINGS' })
  accountType?: AccountType;
}

export class RejectCustomerDto {
  @IsString()
  @MinLength(5, { message: 'Give a reason so the customer can be told why' })
  @MaxLength(200)
  reason!: string;
}

export class PendingQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;
}
