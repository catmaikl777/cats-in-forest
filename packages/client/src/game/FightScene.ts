import Phaser from 'phaser';
import {
  ARENA_W,
  MAX_HP,
  MOVES,
  ATTACK_ORIGIN,
  countdownNumber,
  type FightWorld,
  type FighterState,
} from '@sf/shared';
import { FightClient } from '../net/FightClient';
import { Joystick } from './Joystick';

/**
 * снапшот-частота 20 Гц, локальный предсказанный мир — 60 Гц; сцена рендерит
 * последний предсказанный мир (FightClient.latest()), а авторитетные
 * события/итоги сервера дают VFX и баннеры.
 */

const SCALE = 960 / ARENA_W; // вся арена 2400px влезает в канвас 960px
const FEET_Y = 540; // где стоит боец на экране (GROUND_Y от верха)
const bodyY = (h: number) => FEET_Y - h * SCALE;

interface Spark {
  x: number;
  y: number;
  age: number;
  dmg: number;
}

interface Banner {
  age: number;
  life: number;
  t: Phaser.GameObjects.Text;
}

export class FightScene extends Phaser.Scene {
  private joystick!: Joystick;

  private gA!: Phaser.GameObjects.Graphics;
  private gB!: Phaser.GameObjects.Graphics;
  private gFx!: Phaser.GameObjects.Graphics;

  private hpBarA!: Phaser.GameObjects.Rectangle;
  private hpBarB!: Phaser.GameObjects.Rectangle;
  private hpTextA!: Phaser.GameObjects.Text;
  private hpTextB!: Phaser.GameObjects.Text;
  private nameA!: Phaser.GameObjects.Text;
  private nameB!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private centerText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private roundPipsA: Phaser.GameObjects.Arc[] = [];
  private roundPipsB: Phaser.GameObjects.Arc[] = [];

  private sparkList: Spark[] = [];
  private bannerList: Banner[] = [];
  private fightFlash = 0;
  private sparkTexts: Phaser.GameObjects.Text[] = [];
  private sparkTextIdx = 0;

  constructor() {
    super('FightScene');
  }

  create(): void {
    const { width } = this.scale;
    this.cameras.main.setBackgroundColor('#07080c');

    // Декорации арены (рисуем один раз).
    const bg = this.add.graphics().setDepth(-20);
    bg.fillGradientStyle(0x131b2e, 0x131b2e, 0x0d1119, 0x0d1119, 1);
    bg.fillRect(0, 0, width, FEET_Y);
    bg.fillStyle(0x18223b, 1);
    bg.fillRect(0, FEET_Y - 6, width, 6);
    bg.fillStyle(0x0e141f, 0.9);
    bg.fillRect(0, 0, width, FEET_Y - 46);
    // Границы арены.
    bg.lineStyle(3, 0x60ffb0, 0.55);
    bg.lineBetween(0, FEET_Y - 4, width, FEET_Y - 4);
    bg.lineStyle(2, 0x3e5a82, 0.6);
    bg.lineBetween(0, FEET_Y - 150 * SCALE, width, FEET_Y - 150 * SCALE);

    // Бойцы.
    this.gA = this.add.graphics().setDepth(100);
    this.gB = this.add.graphics().setDepth(100);
    this.gFx = this.add.graphics().setDepth(150);

    // HUD.
    const hud = this.add.graphics().setDepth(90);
    const barY = 16;
    hud.fillStyle(0x000000, 0.55);
    hud.fillRect(18, barY, 320, 20);
    hud.fillRect(width - 338, barY, 320, 20);
    this.hpBarA = this.add.rectangle(18, barY, 320, 20, 0x3ad06a).setOrigin(0, 0).setDepth(89);
    this.hpBarB = this.add.rectangle(width - 338, barY, 320, 20, 0x3ad06a).setOrigin(0, 0).setDepth(89);

    this.nameA = this.add.text(18, barY - 26, 'side 0', { fontFamily: 'monospace', fontSize: '14px', color: '#ffd166' }).setDepth(90);
    this.nameB = this.add.text(width - 338, barY - 26, 'side 1', { fontFamily: 'monospace', fontSize: '14px', color: '#ff6a95' }).setDepth(90);
    this.hpTextA = this.add.text(24, barY + 7, '100', { fontFamily: 'monospace', fontSize: '12px', color: '#ffffff' }).setDepth(91);
    this.hpTextB = this.add.text(width - 64, barY + 7, '100', { fontFamily: 'monospace', fontSize: '12px', color: '#ffffff' }).setDepth(91);

    this.timerText = this.add
      .text(width / 2, barY + 2, '99', { fontFamily: 'monospace', fontSize: '26px', color: '#eaf2ff' })
      .setOrigin(0.5)
      .setDepth(92);

    for (let i = 0; i < 2; i++) {
      this.roundPipsA.push(
        this.add.circle(width / 2 - 70 - i * 22, barY + 10, 8, 0x3a4a68).setDepth(89),
      );
      this.roundPipsB.push(
        this.add.circle(width / 2 + 70 + i * 22, barY + 10, 8, 0x3a4a68).setDepth(89),
      );
    }

    this.centerText = this.add
      .text(width / 2, FEET_Y * 0.42, '', { fontFamily: 'monospace', fontSize: '64px', color: '#ffffff' })
      .setOrigin(0.5)
      .setAlpha(0)
      .setDepth(200);

    this.statusText = this.add
      .text(10, FEET_Y - 30, '', { fontFamily: 'monospace', fontSize: '11px', color: '#7f8fae' })
      .setDepth(240);

    this.joystick = new Joystick(this);
  }

  override update(): void {
    const fight = (this.registry.get('fight') as FightClient | undefined) ?? null;

    if (!fight) {
      this.showIdle();
      return;
    }
    fight.setInput(this.joystick.currentWord());
    this.joystick.update();

    const world = fight.latest();
    if (!world) {
      this.showIdle();
      return;
    }

    this.renderWorld(world);
    this.renderHud(world, fight);
    this.processEvents(fight);
    this.renderFx();
    this.tickBanners();

    this.statusText.setText(
      `room:${fight.roomId.slice(-4)} sid:${fight.sessionId.slice(-6)} t:${world.tick} | ${fight.status}`,
    );
  }

  // ------------------------------------------------------------------ render

  private showIdle(): void {
    this.centerText.setText('FIND MATCH').setAlpha(0.35).setColor('#ffffff');
    this.gA.clear();
    this.gB.clear();
    this.gFx.clear();
    this.statusText.setText('ожидание противника… ищи матч в меню');
  }

  private renderWorld(w: FightWorld): void {
    this.gA.clear();
    this.gB.clear();
    this.drawFighter(this.gA, w.fighters[0], 0x7ed7ff);
    this.drawFighter(this.gB, w.fighters[1], 0xff7e9a);
  }

  private drawFighter(g: Phaser.GameObjects.Graphics, f: FighterState, color: number): void {
    const facing = f.facing;
    const cx = f.x * SCALE;
    const feet = bodyY(f.h);
    const s = SCALE;

    const bob = f.st === 'walk' ? Math.sin(f.stT * 0.45) * 1.5 * s : 0;

    // Земля наклон/стойка.
    if (f.st === 'crouch') {
      g.fillStyle(color, 0.95);
      g.fillRoundedRect(cx - 26 * s, feet - 34 * s, 52 * s, 34 * s, 6 * s);
      g.fillCircle(cx, feet - 40 * s, 12 * s);
      g.fillStyle(0xffffff, 0.95);
      g.fillCircle(cx - 4 * s, feet - 42 * s, 2 * s);
      g.fillCircle(cx + 4 * s, feet - 42 * s, 2 * s);
      return;
    }

    if (f.st === 'ko' && f.down) {
      // Лежит на земле.
      g.fillStyle(color, 0.7);
      g.fillRoundedRect(cx - 36 * s, feet - 12 * s, 72 * s, 12 * s, 6 * s);
      g.fillCircle(cx + facing * -38 * s, feet - 14 * s, 12 * s);
      g.fillStyle(0xfff2b0, 0.9);
      g.fillCircle(cx + facing * -30 * s, feet - 24 * s, 4 * s);
      g.fillCircle(cx + facing * -44 * s, feet - 24 * s, 4 * s);
      return;
    }

    const flash = f.st === 'hitstun' && f.stT % 8 < 4;
    const tint = flash ? 0xffffff : color;

    // Туловище + ноги.
    g.fillStyle(tint, 0.95);
    g.fillRoundedRect(cx - 16 * s, feet - 88 * s - bob, 32 * s, 64 * s, 8 * s);
    // Голова.
    g.fillStyle(tint, 1);
    g.fillCircle(cx, feet - 104 * s - bob, 14 * s);
    g.fillStyle(0x0b0d12, 1);
    g.fillCircle(cx + facing * 5 * s, feet - 106 * s - bob, 3.5 * s);
    g.fillCircle(cx + facing * 11 * s, feet - 106 * s - bob, 3.5 * s);

    // Рука в ударе (активные кадры) — геометрия совпадает с симом.
    const atk = f.attack;
    if (atk?.type) {
      const mv = MOVES[atk.type];
      const active = atk.frame >= mv.startup && atk.frame < mv.startup + mv.active;
      const origin = (f.st === 'attack' && active) ? f.x + facing * ATTACK_ORIGIN : f.x;
      const reach = (f.st === 'attack' && active) ? origin + facing * mv.range : origin + facing * 24;
      const x0 = Math.min(origin, reach) * s;
      const x1 = Math.max(origin, reach) * s;
      const yTop = bodyY(f.h + (mv.top + 8));
      const yBot = bodyY(f.h + (mv.bottom - 12));
      if (active) {
        g.fillStyle(0xffffff, 0.22);
        g.fillRoundedRect(x0, Math.min(yTop, yBot), x1 - x0, Math.abs(yBot - yTop), 6 * s);
        g.lineStyle(2, 0xffffff, 0.8);
        g.strokeRoundedRect(x0, Math.min(yTop, yBot), x1 - x0, Math.abs(yBot - yTop), 6 * s);
      }
      g.fillStyle(0xffe9b0, 0.95);
      g.fillRoundedRect(x1 - Math.sign(facing) * 10 * s, bodyY(f.h + 78) - 4 * s, 14 * s, 8 * s, 4 * s);
    }
  }

  private renderHud(w: FightWorld, fight: FightClient): void {
    const mine = w.fighters[fight.side];
    const theirs = w.fighters[fight.side === 0 ? 1 : 0];
    const setBar = (bar: Phaser.GameObjects.Rectangle, hp: number) => {
      const wpx = 318 * Math.max(0, Math.min(1, hp / MAX_HP));
      bar.width = wpx;
      bar.fillColor = 0x3ad06a;
      if (hp < MAX_HP * 0.4) bar.fillColor = 0xffb020;
      if (hp < MAX_HP * 0.18) bar.fillColor = 0xff4040;
    };
    setBar(this.hpBarA, w.fighters[0].hp);
    setBar(this.hpBarB, w.fighters[1].hp);
    this.hpTextA.setText(String(mine.hp));
    this.hpTextB.setText(String(theirs.hp));

    const mineName = fight.side === 0 ? `YOU · ${fight.sessionId.slice(-5)}` : `OPP · ${fight.sessionId.slice(-5)}`;
    this.nameA.setText(mineName);
    this.nameB.setText(fight.side === 0 ? `OPP` : `YOU`);

    this.timerText.setText(String(Math.max(0, Math.ceil(w.roundTimer / 60))));

    // Раунды.
    this.roundPipsA.forEach((p, i) => p.setFillStyle(i < w.wins[0] ? 0xffd166 : 0x3a4a68));
    this.roundPipsB.forEach((p, i) => p.setFillStyle(i < w.wins[1] ? 0xffd166 : 0x3a4a68));

    // Обратный отсчёт.
    if (w.phase === 'countdown') {
      this.centerText.setText(String(countdownNumber(w.phaseT))).setAlpha(1).setColor('#ffffff');
    } else if (this.fightFlash > 0) {
      this.fightFlash -= 1;
      this.centerText.setText('FIGHT!').setAlpha(0.9).setColor('#ffd166');
    } else {
      this.centerText.setAlpha(0);
    }
  }

  private processEvents(fight: FightClient): void {
    const mySide = fight.side;
    for (const ev of fight.drainEvents()) {
      switch (ev.type) {
        case 'countdown':
          break;
        case 'fight':
          this.fightFlash = 60;
          break;
        case 'hit': {
          const spark: Spark = { x: ev.x * SCALE, y: bodyY(ev.h), age: 0, dmg: ev.dmg };
          this.sparkList.push(spark);
          break;
        }
        case 'ko':
          this.showBanner('K.O.!', '#ff4040', 110);
          break;
        case 'roundend':
          this.showBanner(
            ev.reason === 'ko' ? `round ${(ev.wins[0] + ev.wins[1]) - 1} down` : 'time!',
            '#ffd166',
            100,
          );
          break;
        case 'matchend': {
          const win = ev.winner === mySide;
          this.showBanner(win ? 'VICTORY' : 'DEFEAT', win ? '#7dff9b' : '#ff6262', 220);
          break;
        }
      }
    }
    for (const kind of fight.drainOpponentStatus()) {
      this.showBanner(kind === 'dq' ? 'оппонент покинул' : 'оппонент вернулся', '#84a8ff', 140);
    }
  }

  private renderFx(): void {
    const g = this.gFx;
    g.clear();
    for (const sp of this.sparkList) {
      sp.age += 1;
      const life = 12;
      if (sp.age > life) continue;
      const t = sp.age / life;
      g.fillStyle(0xffe66a, 1 - t);
      g.fillCircle(sp.x, sp.y - t * 26 * SCALE, 6 * SCALE * (1 - t + 0.4));

      const txt = this.nextSparkText();
      txt.setText(`${sp.dmg}`);
      txt.setPosition(sp.x, sp.y - t * 40 * SCALE);
      txt.setAlpha(1 - t);
    }
    this.sparkList = this.sparkList.filter((s) => s.age <= 12);
  }

  private nextSparkText(): Phaser.GameObjects.Text {
    if (this.sparkTextIdx >= this.sparkTexts.length) {
      const t = this.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff' }).setOrigin(0.5).setDepth(160).setVisible(false);
      this.sparkTexts.push(t);
    }
    const t = this.sparkTexts[this.sparkTextIdx];
    this.sparkTextIdx = (this.sparkTextIdx + 1) % 10;
    t!.setVisible(true);
    return t!;
  }

  private tickBanners(): void {
    for (const b of this.bannerList) {
      b.age += 1;
      b.t.setAlpha(Math.min(1, (b.life - b.age) / 30));
    }
    this.bannerList = this.bannerList.filter((b) => b.age < b.life);
  }

  private showBanner(text: string, color: string, life: number): void {
    const t = this.add
      .text(this.scale.width / 2, this.scale.height * 0.34, text, {
        fontFamily: 'monospace',
        fontSize: '46px',
        color,
      })
      .setOrigin(0.5)
      .setDepth(210);
    this.bannerList.push({ age: 0, life, t });
    // На всякий случай — снять старые баннеры после life.
    this.time.delayedCall(life * 18, () => {
      const idx = this.bannerList.findIndex((b) => b.t === t);
      if (idx >= 0) {
        this.bannerList.splice(idx, 1);
        t.destroy();
      }
    });
  }
}