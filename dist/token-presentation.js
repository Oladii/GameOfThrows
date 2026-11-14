import { TOKEN_ART, TOKEN_FONT } from './token-assets.js';

// Exact icon geometry exported from Figma node 273:5888.
export const HORN_ICON_PATH = "<svg width=\"24\" height=\"24\" viewBox=\"0 0 97 96\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<path d=\"M55.9121 36.6796C65.1559 32.7528 65.0557 18.2461 70.8605 5.27238M60.5661 47.6352C69.8099 43.7084 77.8541 48.3742 91.2217 53.2034M69.8425 2.87583L92.2397 55.6\" stroke=\"currentColor\" stroke-width=\"5.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n<path d=\"M9.45361 54.7986L15.2711 68.4932C20.7489 66.1662 22.8121 62.4607 20.9215 58.01C19.0308 53.5592 14.9314 52.4716 9.45361 54.7986Z\" stroke=\"currentColor\" stroke-width=\"5.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n<path d=\"M18.5942 52.532L55.912 36.6794M23.2482 63.4877L60.566 47.6351\" stroke=\"currentColor\" stroke-width=\"5.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n<path d=\"M27.0142 61.8882L29.632 68.0507C34.5769 79.6912 44.7268 82.6541 55.3401 78.1456L72.4583 70.8737C83.7563 66.0743 81.1231 49.4105 69.6038 47.0293C66.48 46.3355 63.3048 46.4719 60.5659 47.6354\" stroke=\"currentColor\" stroke-width=\"5.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n<path d=\"M37.2852 57.5251L39.4667 62.6606C41.9391 68.4808 45.4992 70.2017 51.3194 67.7293L66.0411 61.4755C72.2036 58.8576 69.2949 52.0103 63.1323 54.6282L60.7358 55.6462\" stroke=\"currentColor\" stroke-width=\"5.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n<path d=\"M36.3766 66.8022L25.8698 42.0687L23.8852 37.3968M48.7017 61.5665L38.1949 36.8329L36.2103 32.1611M61.0268 56.3307L50.52 31.5972L48.5354 26.9253M20.1191 38.9966L27.6512 35.797M32.4443 33.7609L39.9763 30.5613M44.7694 28.5251L52.3014 25.3255\" stroke=\"currentColor\" stroke-width=\"5.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n</svg>";
// Reuse the former commander's helmet without altering its geometry.
export const COMMANDER_ICON_PATH = '<path d="M3 9c0-4.3 4-7 9-7s9 2.7 9 7M6 9c0-2.5 2.7-4 6-4s6 1.5 6 4M12 2v3M6 4l2 2m10-2-2 2M12 6v3"/><path d="M6 14a6 5 0 0 1 12 0M5 14h14M6 14v6l4 2v-6m8-2v6l-4 2v-6"/>';

// Figma matrix 193:620 uses a 240px hex; the board uses a 64px hex.
export const TOKEN_UNIT_SCALE = 64 / 240;
export const TOKEN_TYPOGRAPHY = Object.freeze({statSize:80, damageSize:68, tracking:-.15, outsideStroke:5});
// Ink centres in the user's latest 96px component containers: stat text y=2,
// incoming text y=-1. The offsets preserve that vertical placement for every value.
export const TOKEN_BADGE_LAYOUT = Object.freeze({statInkY:47.83984375, incomingInkY:44.4638671875});
const tokenX = value => (value - 120) * TOKEN_UNIT_SCALE;
const tokenY = value => (value - 120) * TOKEN_UNIT_SCALE;
const tokenImageUrls = new Map();
let tokenMaskSequence = 0;

if (typeof document !== 'undefined' && document.head && !document.getElementById('token-belwe-font')) {
  const style = document.createElement('style');
  style.id = 'token-belwe-font';
  style.textContent = `@font-face{font-family:"Token Belwe";src:url("${TOKEN_FONT}") format("truetype");font-weight:700;font-style:normal;font-display:block}`;
  document.head.appendChild(style);
}

function tokenImageUrl(source) {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return source;
  if (!tokenImageUrls.has(source)) {
    const bytes = Uint8Array.from(atob(source.slice(source.indexOf(',')+1)), char=>char.charCodeAt(0));
    const type = source.slice(5,source.indexOf(';'));
    tokenImageUrls.set(source,URL.createObjectURL(new Blob([bytes],{type})));
  }
  return tokenImageUrls.get(source);
}

export function tokenArtwork(kind, x, y, width, height, className = '') {
  return `<image class="token-art ${className}" data-artwork="${kind}" href="${tokenImageUrl(TOKEN_ART[kind])}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="none" aria-hidden="true"/>`;
}

function tokenTypeIcon(type) {
  const id = `token-type-${++tokenMaskSequence}`;
  const x=tokenX(65), y=tokenY(63), size=110*TOKEN_UNIT_SCALE;
  return `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${size}" height="${size}" style="mask-type:alpha">${tokenArtwork('type-'+type,x,y,size,size)}</mask></defs><rect class="token-type-color" x="${x}" y="${y}" width="${size}" height="${size}" fill="#fff" stroke="none" mask="url(#${id})"/>`;
}

function veteranWreath() {
  const id = `token-wreath-${++tokenMaskSequence}`;
  // The approved asset has its own native hex mask; badges are never clipped.
  const mask = tokenArtwork('wreath-mask',tokenX(21.959389),tokenY(6.792452),196.081238*TOKEN_UNIT_SCALE,226.4151*TOKEN_UNIT_SCALE);
  return `<g class="token-veteran-wreath"><defs><mask id="${id}" maskUnits="userSpaceOnUse" x="${tokenX(20)}" y="${tokenY(6.792452)}" width="${200*TOKEN_UNIT_SCALE}" height="${226.4151*TOKEN_UNIT_SCALE}" style="mask-type:alpha">${mask}</mask></defs><g mask="url(#${id})">${tokenArtwork('wreath',tokenX(20),tokenY(20),200*TOKEN_UNIT_SCALE,200*TOKEN_UNIT_SCALE)}</g></g>`;
}

export function renderTokenBody(appearance, displayTeam = 0) {
  const side = displayTeam ? 'south' : 'north';
  const body = tokenArtwork('body',tokenX(30),tokenY(30),180*TOKEN_UNIT_SCALE,180*TOKEN_UNIT_SCALE,'token-body-image');
  const surfaceId = `token-surface-${++tokenMaskSequence}`;
  const colors = displayTeam ? ['#c33f00', '#ab3300', '#802700'] : ['#58b4df', '#4c9fc9', '#387d9f'];
  const tint = `<defs><radialGradient id="${surfaceId}" cx="43%" cy="40%" r="75%"><stop offset="0" stop-color="${colors[0]}"/><stop offset=".6" stop-color="${colors[1]}"/><stop offset="1" stop-color="${colors[2]}"/></radialGradient></defs><circle class="token-team-tint ${side}" cx="0" cy="0" r="${85.5*TOKEN_UNIT_SCALE}" fill="url(#${surfaceId})"/>`;
  const nativeIcon = appearance.type === 'scoutLamp' ? COMMANDER_ICON_PATH : appearance.type === 'horn' ? `<g color="#fff">${HORN_ICON_PATH}</g>` : null;
  const icon = !nativeIcon && appearance.type && TOKEN_ART['type-'+appearance.type]
    ? tokenTypeIcon(appearance.type)
    : `<g transform="translate(${tokenX(65)},${tokenY(63)}) scale(${110/24*TOKEN_UNIT_SCALE})">${nativeIcon || appearance.icon || ''}</g>`;
  const direction=appearance.type==='archer'&&displayTeam?` transform="rotate(180 0 ${tokenY(118)})"`:'';
  return `<g class="token-body-paint">${body}${tint}</g><circle class="piece-circle" r="${88*TOKEN_UNIT_SCALE}"/>${appearance.veteran?veteranWreath():''}<g class="piece-icon" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"${direction}>${icon}</g>`;
}

// Actual glyph ink bounds from the embedded Belwe font, in its 2048 UPM.
// Centre the painted numeral inside its badge, independently of font line boxes.
const DIGIT_INK_BOUNDS = {
  0:[59,-29,1022,1241],1:[260,0,809,1214],2:[76,-43,1006,1243],
  3:[63,-29,979,1294],4:[90,0,1001,1214],5:[98,-29,954,1266],
  6:[63,-29,1018,1241],7:[158,0,961,1294],8:[104,-29,977,1241],9:[63,-29,1018,1241]
};
function numeralInkBounds(text,size) {
  const scale=size/2048,advance=1081*scale,tracking=TOKEN_TYPOGRAPHY.tracking*size;
  let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity,cursor=0;
  for(const char of text){
    const [xMin,yMin,xMax,yMax]=DIGIT_INK_BOUNDS[char]||DIGIT_INK_BOUNDS[0];
    left=Math.min(left,cursor+xMin*scale);right=Math.max(right,cursor+xMax*scale);
    top=Math.min(top,-yMax*scale);bottom=Math.max(bottom,-yMin*scale);
    cursor+=advance+tracking;
  }
  return {left,right,top,bottom,width:right-left,height:bottom-top};
}
function numeralText(text, x, y, size) {
  const outsideStroke = TOKEN_TYPOGRAPHY.outsideStroke;
  // SVG strokes are centred. Painting the fill last leaves the Figma outside stroke.
  return `<text class="token-digit-text" x="${x}" y="${y}" font-family="Token Belwe" font-weight="700" font-size="${size}" letter-spacing="${TOKEN_TYPOGRAPHY.tracking*size}" text-anchor="start" dominant-baseline="alphabetic" style="font-kerning:none" fill="#fff" stroke="#000" stroke-width="${outsideStroke*2}" stroke-linejoin="round" paint-order="stroke fill">${text}</text>`;
}

export function renderTokenNumber(value, centerX, centerY, kind) {
  const text=String(value), signed=text.startsWith('−'), number=signed?text.slice(1):text;
  const size=kind==='incoming'?TOKEN_TYPOGRAPHY.damageSize:TOKEN_TYPOGRAPHY.statSize;
  const bounds=numeralInkBounds(number,size),baseline=-(bounds.top+bounds.bottom)/2;
  let ink=numeralText(number,-(bounds.left+bounds.right)/2,baseline,size);
  if (signed) {
    const minusWidth=18,gap=12,width=minusWidth+gap+bounds.width,start=-width/2;
    ink=`<rect class="token-minus" x="${start}" y="-2.25" width="18" height="4.5" fill="#fff" stroke="#000" stroke-width="${TOKEN_TYPOGRAPHY.outsideStroke*2}" paint-order="stroke fill"/>${numeralText(number,start+minusWidth+gap-bounds.left,baseline,size)}`;
  }
  return `<g class="${kind}-text token-number" data-value="${text}" data-font="Belwe Bd BT Bold" data-font-size="${size}" data-letter-spacing="-15%" data-alignment="badge-center" role="img" aria-label="${text}" transform="translate(${centerX},${centerY}) scale(${TOKEN_UNIT_SCALE})">${ink}</g>`;
}

function attackBacking() {
  // The smaller 72×74.571 frame preserves the original painted crop.
  return `<svg x="${tokenX(34)}" y="${tokenY(138.21428585)}" width="${72*TOKEN_UNIT_SCALE}" height="${74.57142639*TOKEN_UNIT_SCALE}" viewBox="0 0 84 87" overflow="hidden">${tokenArtwork('melee',0,.1392,84,87.6786,'attack-badge')}</svg>`;
}

function detailedTarget() {
  const id=`token-target-${++tokenMaskSequence}`;
  const cx=tokenX(120),cy=tokenY(46.666515),r=35*TOKEN_UNIT_SCALE;
  return `<g class="incoming-target-plate" transform="translate(${cx},${cy}) scale(${86/90}) translate(${-cx},${-cy})"><defs><clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs><g clip-path="url(#${id})">${tokenArtwork('target-texture',tokenX(50.250113),tokenY(-25.666715),139.5*TOKEN_UNIT_SCALE,144.666665*TOKEN_UNIT_SCALE)}</g>${tokenArtwork('target-ring',tokenX(75),tokenY(0),90*TOKEN_UNIT_SCALE,93.333328*TOKEN_UNIT_SCALE,'incoming-badge')}</g>`;
}

export function renderTokenBadges(info, { showIncoming = false, potentialDamage = false } = {}) {
  const attack=`<g class="attack-indicator" data-attack="${info.damage}"><title>Урон атаки: ${info.damage}</title>${attackBacking()}${renderTokenNumber(info.damage,tokenX(70),tokenY(128+TOKEN_BADGE_LAYOUT.statInkY),'attack')}</g>`;
  const armor=`<g class="survival-indicator" data-fortitude="${info.fortitude}"><title>Броня: ${info.fortitude}</title>${tokenArtwork('armor',tokenX(131),tokenY(141.467391014),78*TOKEN_UNIT_SCALE,72.065216064*TOKEN_UNIT_SCALE,'fort-badge')}${renderTokenNumber(info.fortitude,tokenX(170),tokenY(128+TOKEN_BADGE_LAYOUT.statInkY),'fort')}</g>`;
  let threat='';
  if(info.dead||info.incoming>0){
    const badge=info.dead
      ? tokenArtwork('skull',tokenX(81.532421112),tokenY(6.706404209),76*TOKEN_UNIT_SCALE,81.221374512*TOKEN_UNIT_SCALE,'fatal-mark')
      : showIncoming?detailedTarget():tokenArtwork('bullseye',tokenX(80.6875),tokenY(9.075),78.625*TOKEN_UNIT_SCALE,78.625*TOKEN_UNIT_SCALE,'incoming-badge');
    const number=!info.dead&&showIncoming?renderTokenNumber(`−${info.incoming}`,tokenX(120),tokenY(-1+TOKEN_BADGE_LAYOUT.incomingInkY),'incoming'):'';
    const state=info.dead?' lethal':!showIncoming?' under-fire-target':'';
    threat=`<g class="incoming-indicator${state}" data-incoming="${info.incoming}"><title>Входящий урон: ${info.incoming}${info.dead?' · погибнет при расчёте':''}</title>${badge}${number}</g>`;
  }
  return `<g class="unit-badges${potentialDamage ? ' potential-damage' : ''}" data-token-style="matrix">${attack}${armor}${threat}</g>`;
}

// Keep arrow labels out of the actual badge artwork and outlined numeral ink.
export function tokenBadgeBounds(info) {
  const number = (value, x, y, kind, backing) => {
    const signed = String(value).startsWith('−');
    const ink = numeralInkBounds(String(value).replace(/^−/, ''), kind === 'incoming' ? TOKEN_TYPOGRAPHY.damageSize : TOKEN_TYPOGRAPHY.statSize);
    const width = (ink.width + (signed ? 30 : 0) + TOKEN_TYPOGRAPHY.outsideStroke * 2) * TOKEN_UNIT_SCALE;
    const height = (ink.height + TOKEN_TYPOGRAPHY.outsideStroke * 2) * TOKEN_UNIT_SCALE;
    return { left: Math.min(backing.left, x - width / 2), right: Math.max(backing.right, x + width / 2),
      top: Math.min(backing.top, y - height / 2), bottom: Math.max(backing.bottom, y + height / 2) };
  };
  const statY = tokenY(128 + TOKEN_BADGE_LAYOUT.statInkY);
  const bounds = [
    number(info.damage, tokenX(70), statY, 'attack', { left: tokenX(34), right: tokenX(106), top: tokenY(138.21428585), bottom: tokenY(212.78571224) }),
    number(info.fortitude, tokenX(170), statY, 'fort', { left: tokenX(131), right: tokenX(209), top: tokenY(141.467391014), bottom: tokenY(213.532607078) })
  ];
  if (info.dead || info.incoming > 0) bounds.push(number(`−${info.incoming}`, 0, tokenY(-1 + TOKEN_BADGE_LAYOUT.incomingInkY), 'incoming',
    { left: -12, right: 12, top: -32, bottom: tokenY(93.333328) }));
  return bounds;
}

export function renderDeathSkull() {
  return tokenArtwork('skull',-16.8,-17.96,33.6,35.92,'fatal-mark');
}
