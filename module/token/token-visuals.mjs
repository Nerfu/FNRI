import {readTempHpState,tempHpMax} from "../damage/temporary-hp-layers.mjs";
const HP_COLOR = 0x35c759;
const TEMP_HP_COLOR = 0x4f9ee8;
const EMPTY_COLOR = 0x10141a;
const BORDER_COLOR = 0x000000;
const MAX_TEMP_SHARE = 0.70;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Calculate the visual shares of the single combined HP bar.
 *
 * Order:
 *   current HP (green) -> missing normal HP (empty gap) -> temporary HP (blue)
 *
 * The whole bar represents maxHP + tempHP = 100%.
 * Temporary HP therefore occupy tempHP / (maxHP + tempHP).
 * Blue is capped at 70% only as a visual ceiling for extreme temp HP.
 * Current and missing ordinary HP preserve currentHP / maxHP inside
 * the ordinary-HP portion.
 */
export function calculateHpBarLayout({ value = 0, max = 0, temp = 0 } = {}) {
  const maxHp = nonnegative(max);
  const currentHp = clamp(nonnegative(value), 0, maxHp);
  const tempHp = nonnegative(temp);

  if (maxHp <= 0) {
    return {
      green: 0,
      gap: tempHp > 0 ? 1 - MAX_TEMP_SHARE : 1,
      blue: tempHp > 0 ? MAX_TEMP_SHARE : 0
    };
  }

  if (tempHp <= 0) {
    const green = currentHp / maxHp;
    return {
      green,
      gap: 1 - green,
      blue: 0
    };
  }

  // Canonical visual rule:
  // max normal HP + current temporary HP = 100% of the bar.
  //
  // Example: max 100 + temp 20 => total visual maximum 120,
  // so temp occupies 20 / 120 = 16.67%.
  const effectiveMaximum = maxHp + tempHp;
  const rawBlue = tempHp / effectiveMaximum;
  const blue = Math.min(rawBlue, MAX_TEMP_SHARE);

  // If blue did not hit the 70% visual ceiling, ordinary HP naturally
  // occupies maxHp / (maxHp + tempHp). If it did hit the ceiling, the
  // entire ordinary-HP scale is compressed into the remaining 30%.
  const ordinaryShare = 1 - blue;
  const hpRatio = currentHp / maxHp;
  const green = ordinaryShare * hpRatio;
  const gap = ordinaryShare * (1 - hpRatio);

  return { green, gap, blue };
}

export const supportsHpBar = actor => ["character","npc"].includes(actor?.type) && !!actor.system?.hp;
const nonnegative = n => Number.isFinite(n) ? Math.max(0,n) : 0;

/** Native resource-bar interface for the current schema, not a second HP pool. */
export function hpTokenDocumentClass(BaseTokenDocument) {
  return class FastNriTokenDocument extends BaseTokenDocument {
    getBarAttribute(barName, options={}) {
      const attribute=options.alternative ?? this[barName]?.attribute;
      if(attribute!=="hp" || !supportsHpBar(this.actor)) return super.getBarAttribute(barName,options);
      const {current,max}=this.actor.system.hp;
      return {type:"bar",attribute:"hp",value:nonnegative(current),max:nonnegative(max),editable:true};
    }
    static getTrackedAttributes(data, ...args) {
      const tracked=super.getTrackedAttributes(data,...args);
      // Native discovery still supplies every other resource and numeric field.
      const topLevel=!args[0]?.length;
      const hpModel=["character","npc"].includes(data) || !!data?.hp || !!data?.system?.hp || !!data?.schema?.fields?.hp || !!data?.fields?.hp;
      if(!topLevel || !hpModel || tracked.bar.some(path=>path.length===1&&path[0]==="hp"))return tracked;
      return {...tracked,bar:[...tracked.bar,["hp"]]};
    }
  };
}

export function hpActorClass(BaseActor) {
  return class FastNriActor extends BaseActor {
    modifyTokenAttribute(attribute,value,isDelta=false,isBar=true) {
      if(attribute!=="hp" || !isBar || !supportsHpBar(this) || !Number.isFinite(value))
        return super.modifyTokenAttribute(attribute,value,isDelta,isBar);
      const next=nonnegative(isDelta?nonnegative(this.system.hp.current)+value:value);
      const max=this.system.hp.max;
      // A HUD edit changes ordinary HP, not damage application or temporary layers.
      return super.modifyTokenAttribute("hp.current",Number.isFinite(max)?Math.min(next,nonnegative(max)):next,false,false);
    }
  };
}

export function hpTokenClass(BaseToken) {
  class FastNriToken extends BaseToken {
    _drawBar(number, bar, data) {
      if (!globalThis.canvas?.initialized) return;

      const actor = this.document?.actor;
      if (data?.attribute !== "hp" || !supportsHpBar(actor)) {
        return super._drawBar(number, bar, data);
      }

      const hp = actor.system.hp;
      const layout = calculateHpBarLayout({
        value: hp.current,
        max: hp.max,
        temp: tempHpMax(readTempHpState(actor))
      });

      // Follow the core/PF2e height convention so the bar remains familiar.
      let h = Math.max(canvas.dimensions.size / 12, 8);
      if (this.document.height >= 2) h *= 1.6;

      const border = clamp(h / 8, 1, 2);
      const innerX = border;
      const innerY = border;
      const innerWidth = Math.max(0, this.w - border * 2);
      const innerHeight = Math.max(1, h - border * 2);

      const greenWidth = innerWidth * layout.green;
      const blueWidth = innerWidth * layout.blue;

      // Blue is anchored to the right. The untouched background between
      // green and blue is exactly the visual share of missing ordinary HP.
      const blueX = innerX + innerWidth - blueWidth;

      bar.clear();

      // Whole bar / missing HP.
      bar.lineStyle(0)
        .beginFill(EMPTY_COLOR, 0.82)
        .drawRoundedRect(0, 0, this.w, h, 3);

      // Current ordinary HP.
      if (greenWidth > 0) {
        bar.lineStyle(0)
          .beginFill(HP_COLOR, 1)
          .drawRect(innerX, innerY, greenWidth, innerHeight);
      }

      // Temporary HP.
      if (blueWidth > 0) {
        bar.lineStyle(0)
          .beginFill(TEMP_HP_COLOR, 1)
          .drawRect(blueX, innerY, blueWidth, innerHeight);
      }

      // Single container border around the combined bar.
      bar.beginFill(BORDER_COLOR, 0)
        .lineStyle(border, BORDER_COLOR, 1)
        .drawRoundedRect(0, 0, this.w, h, 3);

      bar.position.set(0, number === 0 ? this.h - h : 0);
    }
  }

  return FastNriToken;
}

export function touchesHp(changes) {
  const hp=changes?.system?.hp;
  return ["current","max","temp"].some(key=>Object.hasOwn(hp??{},key)||Object.hasOwn(changes??{},`system.hp.${key}`)) ||
    Object.hasOwn(changes?.flags?.["fast-nri-v14"]??{},"tempHpState") ||
    Object.keys(changes??{}).some(key=>key.startsWith("flags.fast-nri-v14.tempHpState"));
}
export function activeActorTokens(actor) {
  if(!globalThis.canvas?.ready || !actor?.uuid)return [];
  // Exact synthetic Actor identity; no base-Actor fallback for unlinked tokens.
  return (canvas.tokens?.placeables??[]).filter(token=>token.document?.actor?.uuid===actor.uuid);
}
export function refreshActorHpBars(actor) {
  for(const token of activeActorTokens(actor))token.renderFlags?.set?.({refreshBars:true});
}

export function registerTokenPresentation() {
  CONFIG.Token.objectClass=hpTokenClass(CONFIG.Token.objectClass);
  CONFIG.Token.documentClass=hpTokenDocumentClass(CONFIG.Token.documentClass);
  CONFIG.Actor.documentClass=hpActorClass(CONFIG.Actor.documentClass);
  Hooks.on("preMoveToken",(_document,movement)=>{movement.autoRotate=false;});
  // New Actors get the legacy visual default; explicit import settings survive.
  Hooks.on("preCreateActor",(actor,data)=>{
    if(!supportsHpBar(actor))return;
    const supplied=data?.prototypeToken??{};
    const patch={};
    if(!Object.hasOwn(supplied,"displayBars"))patch["prototypeToken.displayBars"]=CONST.TOKEN_DISPLAY_MODES.ALWAYS;
    if(!Object.hasOwn(supplied.bar1??{},"attribute"))patch["prototypeToken.bar1.attribute"]="hp";
    if(Object.keys(patch).length)actor.updateSource(patch);
  });
  Hooks.on("preCreateToken",(token,data)=>{
    if(!supportsHpBar(token.actor))return;
    // Respect an explicit placement setting and the Actor prototype. Only
    // an absent field is supplied; no stored Scene or Actor is rewritten.
    const prototype=token.actor.prototypeToken;
    const patch={};
    if(!Object.hasOwn(data??{},"displayBars"))patch.displayBars=prototype?.displayBars??CONST.TOKEN_DISPLAY_MODES.ALWAYS;
    if(!Object.hasOwn(data?.bar1??{},"attribute"))patch["bar1.attribute"]=prototype?.bar1?.attribute??"hp";
    if(Object.keys(patch).length)token.updateSource(patch);
  });
  Hooks.on("updateActor",(actor,changes)=>{if(touchesHp(changes))refreshActorHpBars(actor);});
  Hooks.on("updateActorDelta",(delta,changes)=>{if(touchesHp(changes))refreshActorHpBars(delta.parent?.actor);});
}
