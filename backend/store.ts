import type { SettingNumber } from '../shared/settings';

export class SettingStore {
  private number: SettingNumber = 1;

  get(): SettingNumber {
    return this.number;
  }

  set(number: SettingNumber) {
    this.number = number;
    return this.number;
  }
}
