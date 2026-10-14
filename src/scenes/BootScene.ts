import Phaser from 'phaser';
import atlasUrl from '../../assets/textures/atlas.png?url';
import atlasData from '../../assets/textures/atlas.json';

export const CAR_ATLAS_KEY = 'car_layers';

/** Only core car layers load at boot; district-specific art will be lazy-loaded. */
export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  preload(): void {
    this.load.atlas(CAR_ATLAS_KEY, atlasUrl, atlasData);
  }

  create(): void {
    this.scene.start('Drive');
  }
}
