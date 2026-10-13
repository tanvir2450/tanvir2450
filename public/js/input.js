/**
 * Input: unified touch + keyboard/mouse controller.
 *
 * Touch layout:
 *   - left region  : dynamic virtual stick (movement)
 *   - right region : drag to look; also holds action buttons (handled in DOM)
 * Desktop:
 *   - WASD move, mouse look (pointer lock), LMB fire, RMB ADS,
 *     R reload, G grenade, Space jump, 1-5 weapons, Shift sprint, Esc menu.
 */
export class Input {
  constructor(dom) {
    this.dom = dom;

    // movement vector (-1..1)
    this.move = { x: 0, y: 0 };
    this.lookDX = 0;
    this.lookDY = 0;

    this.fireDown = false;
    this.adsDown = false;
    this.jumpPressed = false;
    this.reloadPressed = false;
    this.nadePressed = false;
    this.sprintDown = false;

    this.weaponSlots = [false, false, false, false, false];
    this.lastSlot = -1;

    this.sensitivity = 1;
    this.invertY = false;

    this.isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    this.pointerLocked = false;

    this._keys = new Set();
    this._stick = { id: null, originX: 0, originY: 0 };
    this._look = { id: null, lastX: 0, lastY: 0 };

    this._bindKeyboard();
    this._bindMouse();
    this._bindTouch();
    this._bindButtons();
  }

  // ---- keyboard -----------------------------------------------------------
  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this._keys.add(e.code);
      switch (e.code) {
        case 'Space': this.jumpPressed = true; e.preventDefault(); break;
        case 'KeyR': this.reloadPressed = true; break;
        case 'KeyG': this.nadePressed = true; break;
        case 'ShiftLeft': case 'ShiftRight': this.sprintDown = true; break;
        case 'Digit1': this.lastSlot = 0; break;
        case 'Digit2': this.lastSlot = 1; break;
        case 'Digit3': this.lastSlot = 2; break;
        case 'Digit4': this.lastSlot = 3; break;
        case 'Digit5': this.lastSlot = 4; break;
        case 'Tab': e.preventDefault(); this.showScores = true; break;
      }
    });
    window.addEventListener('keyup', (e) => {
      this._keys.delete(e.code);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.sprintDown = false;
      if (e.code === 'Tab') this.showScores = false;
    });
    window.addEventListener('blur', () => {
      this._keys.clear();
      this.fireDown = false;
      this.sprintDown = false;
    });
  }

  _readKeys() {
    if (this.isTouch && this._stick.id !== null) return; // stick wins on touch
    let x = 0;
    let y = 0;
    if (this._keys.has('KeyW') || this._keys.has('ArrowUp')) y += 1;
    if (this._keys.has('KeyS') || this._keys.has('ArrowDown')) y -= 1;
    if (this._keys.has('KeyD') || this._keys.has('ArrowRight')) x += 1;
    if (this._keys.has('KeyA') || this._keys.has('ArrowLeft')) x -= 1;
    const len = Math.hypot(x, y);
    if (len > 0) {
      x /= len;
      y /= len;
    }
    this.move.x = x;
    this.move.y = y;
  }

  // ---- mouse --------------------------------------------------------------
  _bindMouse() {
    const canvas = this.dom.canvas;

    canvas.addEventListener('click', () => {
      if (!this.isTouch && !this.pointerLocked && this.mouseLookEnabled) {
        canvas.requestPointerLock?.();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.lookDX += e.movementX * 0.0022 * this.sensitivity;
      this.lookDY += e.movementY * 0.0022 * this.sensitivity * (this.invertY ? -1 : 1);
    });

    window.addEventListener('mousedown', (e) => {
      if (!this.mouseLookEnabled || this.isTouch) return;
      if (e.button === 0) this.fireDown = true;
      if (e.button === 2) this.adsDown = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fireDown = false;
      if (e.button === 2) this.adsDown = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---- touch --------------------------------------------------------------
  _bindTouch() {
    const stickZone = this.dom.stickZone;
    const lookZone = this.dom.lookZone;
    const base = this.dom.stickBase;
    const nub = this.dom.stickNub;

    const STICK_RADIUS = 52;

    stickZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      if (this._stick.id !== null) return;
      this._stick.id = t.identifier;
      this._stick.originX = t.clientX;
      this._stick.originY = t.clientY;
      base.style.left = `${t.clientX - 58}px`;
      base.style.top = `${t.clientY - 58}px`;
      base.style.bottom = 'auto';
      base.classList.add('active');
      nub.style.transform = 'translate(0px, 0px)';
    }, { passive: false });

    const moveStick = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this._stick.id) continue;
        e.preventDefault();
        let dx = t.clientX - this._stick.originX;
        let dy = t.clientY - this._stick.originY;
        const len = Math.hypot(dx, dy);
        if (len > STICK_RADIUS) {
          dx = (dx / len) * STICK_RADIUS;
          dy = (dy / len) * STICK_RADIUS;
        }
        nub.style.transform = `translate(${dx}px, ${dy}px)`;
        this.move.x = dx / STICK_RADIUS;
        this.move.y = -dy / STICK_RADIUS;
      }
    };
    stickZone.addEventListener('touchmove', moveStick, { passive: false });

    const endStick = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this._stick.id) continue;
        this._stick.id = null;
        this.move.x = 0;
        this.move.y = 0;
        base.classList.remove('active');
      }
    };
    stickZone.addEventListener('touchend', endStick);
    stickZone.addEventListener('touchcancel', endStick);

    // look drag
    lookZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      if (this._look.id !== null) return;
      this._look.id = t.identifier;
      this._look.lastX = t.clientX;
      this._look.lastY = t.clientY;
    }, { passive: false });

    lookZone.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this._look.id) continue;
        e.preventDefault();
        const dx = t.clientX - this._look.lastX;
        const dy = t.clientY - this._look.lastY;
        this._look.lastX = t.clientX;
        this._look.lastY = t.clientY;
        this.lookDX += dx * 0.0042 * this.sensitivity;
        this.lookDY += dy * 0.0042 * this.sensitivity * (this.invertY ? -1 : 1);
      }
    }, { passive: false });

    const endLook = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._look.id) this._look.id = null;
      }
    };
    lookZone.addEventListener('touchend', endLook);
    lookZone.addEventListener('touchcancel', endLook);
  }

  // ---- HUD buttons ----------------------------------------------------------
  _bindButtons() {
    const press = (el, down, up) => {
      if (!el) return;
      el.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.add('pressed');
        down();
      }, { passive: false });
      el.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.remove('pressed');
        if (up) up();
      }, { passive: false });
      // mouse fallback for desktop testing of the touch UI
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        el.classList.add('pressed');
        down();
      });
      el.addEventListener('mouseup', () => {
        el.classList.remove('pressed');
        if (up) up();
      });
    };

    press(this.dom.btnFire, () => (this.fireDown = true), () => (this.fireDown = false));
    press(this.dom.btnAds, () => (this.adsDown = !this.adsDown), null);
    press(this.dom.btnJump, () => (this.jumpPressed = true), null);
    press(this.dom.btnReload, () => (this.reloadPressed = true), null);
    press(this.dom.btnNade, () => (this.nadePressed = true), null);

    this.dom.weaponStrip?.querySelectorAll('.wslot').forEach((btn) => {
      const slot = Number(btn.dataset.slot);
      const pick = () => {
        this.lastSlot = slot;
      };
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        pick();
      }, { passive: false });
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        pick();
      });
    });
  }

  // ---- per-frame ----------------------------------------------------------
  update() {
    this._readKeys();
  }

  consumeLook() {
    const dx = this.lookDX;
    const dy = this.lookDY;
    this.lookDX = 0;
    this.lookDY = 0;
    return { dx, dy };
  }

  consumeJump() {
    const v = this.jumpPressed;
    this.jumpPressed = false;
    return v;
  }

  consumeReload() {
    const v = this.reloadPressed;
    this.reloadPressed = false;
    return v;
  }

  consumeNade() {
    const v = this.nadePressed;
    this.nadePressed = false;
    return v;
  }

  consumeWeaponSlot() {
    const v = this.lastSlot;
    this.lastSlot = -1;
    return v;
  }
}
