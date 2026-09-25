import Phaser from 'phaser';
import { ButtonBit, directionBitsFromVector } from '@sf/shared';

interface ToolButton {
  x: number;
  y: number;
  r: number;
  bit: number;
  label: string;
  color: number;
  owner: number | null;
}

/**
 * Виртуальные органы управления (джойстик слева + кнопки справа) для тача и
 * мыши. Алгоритм маппинга — общий с сервером: направление через
 * directionBitsFromVector (+y = вверх), кнопки — hold-биты ButtonBit.
 *
 * Слово ввода дёргается ТОЛЬКО при фактическом изменении состояний — так
 * симуляция получает корректные edges (нажатие/отпускание).
 */
export class Joystick {
  private readonly scene: Phaser.Scene;
  private readonly g: Phaser.GameObjects.Graphics;

  private readonly baseX = 128;
  private readonly baseY = 448;
  private readonly baseR = 44;
  private readonly thumbR = 20;

  private readonly buttons: ToolButton[] = [
    { x: 858, y: 452, r: 34, bit: ButtonBit.PUNCH as number, label: 'PUNCH', color: 0x54c2ff, owner: null },
    { x: 776, y: 468, r: 24, bit: ButtonBit.KICK as number, label: 'KICK', color: 0xff6a95, owner: null },
    { x: 688, y: 488, r: 18, bit: ButtonBit.DASH as number, label: 'DASH', color: 0xffd166, owner: null },
  ];

  private joyPointer: number | null = null;
  private joyDx = 0;
  private joyDyUp = 0;

  private labelTexts: { t: Phaser.GameObjects.Text; btn: ToolButton }[] = [];

  private word = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.g = scene.add.graphics().setDepth(300);
    for (const b of this.buttons) {
      const t = scene.add
        .text(b.x, b.y - 4, b.label, { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff' })
        .setOrigin(0.5)
        .setDepth(301);
      this.labelTexts.push({ t, btn: b });
    }
    scene.input.addPointer(2);
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onDown(p));
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onMove(p));
    scene.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onUp(p));
    scene.input.on('pointerupoutside', (p: Phaser.Input.Pointer) => this.onUp(p));
  }

  currentWord(): number {
    return this.word;
  }

  destroy(): void {
    this.scene.input.removeAllListeners('pointerdown');
    this.scene.input.removeAllListeners('pointermove');
    this.scene.input.removeAllListeners('pointerup');
    this.scene.input.removeAllListeners('pointerupoutside');
    this.g.destroy();
    for (const { t } of this.labelTexts) t.destroy();
  }

  update(): void {
    this.redraw();
  }

  private onDown(p: Phaser.Input.Pointer): void {
    // Джойстик — самый большой тач-регион.
    if (this.joyPointer === null && Phaser.Math.Distance.Between(p.x, p.y, this.baseX, this.baseY) <= this.baseR + 20) {
      this.joyPointer = p.id;
      this.joyDx = 0;
      this.joyDyUp = 0;
      this.recomputeWord();
      return;
    }
    for (const b of this.buttons) {
      if (b.owner === null && Phaser.Math.Distance.Between(p.x, p.y, b.x, b.y) <= b.r + 14) {
        b.owner = p.id;
        this.recomputeWord();
        return;
      }
    }
  }

  private onMove(p: Phaser.Input.Pointer): void {
    if (p.id !== this.joyPointer) return;
    const dx = p.x - this.baseX;
    const dy = p.y - this.baseY;
    const len = Math.hypot(dx, dy);
    if (len > this.baseR) {
      const k = this.baseR / len;
      this.joyDx = dx * k;
      this.joyDyUp = -dy * k;
    } else {
      this.joyDx = dx;
      this.joyDyUp = -dy;
    }
    this.recomputeWord();
  }

  private onUp(p: Phaser.Input.Pointer): void {
    if (p.id === this.joyPointer) {
      this.joyPointer = null;
      this.joyDx = 0;
      this.joyDyUp = 0;
      this.recomputeWord();
      return;
    }
    for (const b of this.buttons) {
      if (b.owner === p.id) {
        b.owner = null;
        this.recomputeWord();
        return;
      }
    }
  }

  private recomputeWord(): void {
    const dir = directionBitsFromVector(
      this.joyDx,
      this.joyDyUp,
      this.baseR * 0.4,
    );
    let word = dir;
    for (const b of this.buttons) {
      if (b.owner !== null) word |= b.bit;
    }
    this.word = word;
  }

  private redraw(): void {
    const g = this.g;
    g.clear();

    // База джойстика.
    g.fillStyle(0x2a3550, 0.55);
    g.fillCircle(this.baseX, this.baseY, this.baseR + 8);
    g.lineStyle(2, 0x8ba0c4, 0.7);
    g.strokeCircle(this.baseX, this.baseY, this.baseR + 8);
    g.fillStyle(0xdfe9ff, 0.25);
    g.fillCircle(this.baseX, this.baseY, this.baseR);

    // Большой палец.
    const tx = this.baseX + this.joyDx;
    const ty = this.baseY - this.joyDyUp;
    g.fillStyle(0x9fb8e8, 0.9);
    g.fillCircle(tx, ty, this.thumbR);
    g.lineStyle(1.5, 0xe6f0ff, 0.8);
    g.strokeCircle(tx, ty, this.thumbR);

    // Кнопки.
    for (const { t, btn: b } of this.labelTexts) {
      const pressed = b.owner !== null;
      g.fillStyle(b.color, pressed ? 0.95 : 0.45);
      g.fillCircle(b.x, b.y, pressed ? b.r + 3 : b.r);
      g.lineStyle(2, 0xffffff, 0.7);
      g.strokeCircle(b.x, b.y, b.r);
      t.setPosition(b.x, b.y - 4).setVisible(!pressed);
    }
  }
}