import { IsString, MaxLength, Matches } from 'class-validator';

export class ProfilePhotoDto {
  @IsString()
  @MaxLength(90000)
  @Matches(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/)
  photo!: string;
}
