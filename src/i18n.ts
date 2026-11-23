import { readAppSetting } from './settings';

export type AppLanguage = 'id' | 'en';

export function localize(language: AppLanguage, indonesian: string, english: string): string {
  return language === 'id' ? indonesian : english;
}

export function readAppLanguage(): AppLanguage {
  return readAppSetting<string>('di-language', 'id') === 'en' ? 'en' : 'id';
}
