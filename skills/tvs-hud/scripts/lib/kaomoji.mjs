// 颜文字脸池——底层桶语义移植自「思绪」`core/kaomoji.mjs`，素材大量取自你自己的
// E:\inksnow\Thoughts\.claude\rules\fontFace.json（个人表情库），按情绪桶重新归类、
// 挑了视觉上足够有区分度的（避免同一桶里塞两张几乎一样的脸）。除纯颜文字外也收了几个
// "表情+字符画"的（掀桌子/散花/打哈欠序列之类），不是每张都只是眼睛嘴巴的排列组合。

/**
 * 把 PAD 三轴折算成心情桶——14 桶，比原版 7 桶更细：
 * 正情绪按"唤醒度×掌控感"再分层（得意/来劲/满足/松弛/慵懒），
 * 负情绪同理（毛刺/愤世/烦躁/闷闷不乐/心灰/蔫），中性区分"紧绷"和"平"。
 * @param {{valence?: number, energy?: number, control?: number}} pad
 * @returns {'elated'|'up'|'content'|'relaxed'|'chill'|'steady'|'flat'|'wired'|'restless'|'prickly'|'fierce'|'sulky'|'weary'|'down'}
 */
export function moodBucket(pad = {}) {
  const v = Number(pad.valence ?? 0.5);
  const e = Number(pad.energy ?? 0.5);
  const c = Number(pad.control ?? 0.5);
  const hi = (x) => x >= 0.65;
  const lo = (x) => x <= 0.35;

  if (hi(v)) {
    if (hi(e)) return hi(c) ? 'elated' : 'up';       // 得意亢奋（掌控在手）/ 单纯来劲
    if (lo(e)) return hi(c) ? 'relaxed' : 'chill';    // 松弛笃定 / 纯慵懒
    return 'content';                                 // 满足，中等唤醒
  }
  if (lo(v)) {
    if (hi(e)) return lo(c) ? 'prickly' : hi(c) ? 'fierce' : 'restless'; // 毛刺 / 愤世来劲 / 烦躁不安
    if (lo(e)) return hi(c) ? 'weary' : 'down';        // 心灰但压得住 / 蔫到失控
    return 'sulky';                                    // 闷闷不乐
  }
  // valence 居中
  if (hi(e) && lo(c)) return 'wired';  // 紧绷但没到愤世——忙且没掌控
  if (hi(c)) return 'steady';          // 笃定
  return 'flat';                       // 平，兜底
}

/** 彩蛋池：~2% 概率无视处境心情直接蹦出来。混了几个"表情+字符画"（桌子/闹钟/惊呆）。 */
const EASTER = [
  '(╯°□°)╯︵┻━┻', '┬─┬ノ(º_ºノ)', '(；一_一)☕', '_(:з」∠)_',
  'ε=ε=┌(；ﾟдﾟ)┘', '(´；ω；`)つ旦', 'ヾ(￣▽￣)~', '(σ｀д′)σ',
  '(((ﾟдﾟ)))', '╰(￣ω￣ｏ)', 'Σ(っ °Д °;)っ', '(((φ(◎ロ◎;)φ)))',
  '☆{{{Д}}} ☆!!', '(￣△￣；)zzZ?',
];

// 14 桶的基础脸池：每桶素材独立挑选，桶内不放视觉上过于相似的两张脸。
const BASE = {
  elated: ['ヽ(✿ﾟ▽ﾟ)ノ', '(๑•̀ㅂ•́)و✧', '(((o(*ﾟ▽ﾟ*)o)))', '(o゜▽゜)o☆', 'ㄟ(≧◇≦)ㄏ', '٩(ˊᗜˋ*)و', '*★,°*:.☆(￣▽￣)/$:*.°★*', 'd=====(￣▽￣*)b'],
  up: ['(p≧w≦q)', 'ヾ(≧∇≦*)ゝ', '(≧∀≦)ゞ', '(☆▽☆)', 'o(*^▽^*)┛', '♪(^∇^*)', '(o^▽^o)', 'ヾ(´ω`)ノ゛'],
  content: ['o(*￣︶￣*)o', 'o(^▽^)o', '( ╯▽╰)', '（´v｀）', '(o≖◡≖)', '(´▽`ʃ♡ƪ)'],
  relaxed: ['(-̀ω-́)✧', '(￣ー￣)b', '╰(￣▽￣)╭', '( ͡° ͜ʖ ͡°)', '(｡-`ω´-)', '(´ω`)☕'],
  chill: ['(～o￣3￣)～', '(つω｀)～', '(˘ω˘)', '(´ωー`)', '(￣▽￣～)'],
  steady: ['(•̀ω•́)', '┗( -o-)┛', '(｀・ω・´)', '(￣ー￣)', '( ・∀・)b', '(-ω-)'],
  flat: ['(-_-)', '(・_・)', '(￣.￣)', '(°ー°)', '(・_・)ゞ', 'φ(・∀・)'],
  wired: ['Σ( ° △ °|||)︴', 'o((⊙﹏⊙))o.', '(((φ(◎ロ◎;)φ)))', '━━∑(￣□￣*|||━━', '(￣△￣；)'],
  restless: ['(*￣︿￣)', 'o(一︿一+)o', "o(′益`)o", "( -'`-; )", '(눈_눈)', '(¬_¬)'],
  prickly: ['(#`O′)', '( ｀д′)', '(￢д￢)', '(◣_◢)', '(눈_눈)？', '(；¬_¬)'],
  fierce: ['(╬▔皿▔)', '(╬￣皿￣)凸', '（╯－_－）╯╧╧', '┴─┴︵╰（‵□′╰）', '(｀Δ´)'],
  sulky: ['(#｀-_ゝ-)', "(′д｀ )…彡…彡", '（〃｀ 3′〃）', "( ′ 3`) sigh~", '(￣﹏￣)'],
  weary: ['┌( ´_ゝ` )┐', '(´ｰ∀ｰ`)', '（。－_－。）', '(ρ_・).。', '(￣o￣)'],
  down: ['〒▽〒', 'o(╥﹏╥)o', 'ε(┬┬﹏┬┬)3', 'つ﹏⊂', '(´；ω；`)', '(个_个)'],
};

// hot（卡壳/啃硬骨头/高压）专属加成——更炸裂的变体，只在这类处境才出现。
const HOT_EXTRA = {
  elated: ['(((o(*ﾟ▽ﾟ*)o)))！！'],
  up: ['ヽ(*≧ω≦)ﾉ'],
  wired: ['┌(。Д。)┐', 'ヽ(*。>Д<)ﾉ'],
  restless: ['(ﾟДﾟ*)ﾉ', '___*( ￣皿￣)/#____'],
  prickly: ['o(≧口≦)o', '(╬￣皿￣)'],
  fierce: ['(╯‵□′)╯炸弹！•••*～●', 'Ｏ(≧口≦)Ｏ'],
  down: ['→)╥﹏╥)'],
};

// quiet（闲/长时间无操作）专属加成——瞌睡序列，混了几个"表情+字符画"打哈欠动作。
const QUIET_EXTRA = {
  down: ['(。＿　＿)。ZZzzzz…', '(∪｡∪)｡｡｡zzz'],
  weary: ['(￣o￣) . z Z', '(_ _)( - . - )(~O~)( - . - )'],
  chill: ['(つω｀)～zzZ', '(+.+)(-.-)(_ _) ..zzZZ'],
  relaxed: ['(˘ω˘)zzZ', '(-ω-)zzZ'],
  flat: ['(-ω-)..zzZ', '(￣o￣)..zzZ'],
  sulky: ['(´-ω-)zzZ'],
  steady: ['(˘ω˘)'],
  content: ['(´ω`)zzZ'],
};

function poolFor(situation, bucket) {
  const base = BASE[bucket] || BASE.flat;
  const extra = situation === 'hot' ? HOT_EXTRA[bucket] : situation === 'quiet' ? QUIET_EXTRA[bucket] : null;
  return extra?.length ? [...base, ...extra] : base;
}

/**
 * 挑一张脸。
 * @param {'hot'|'warm'|'cold'|'quiet'} situation
 * @param {object} pad
 * @param {() => number} rand 随机源（测试可注入）
 * @returns {string}
 */
export function pickKaomoji(situation, pad = {}, rand = Math.random) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  if (rand() < 0.02) return pick(EASTER);
  return pick(poolFor(situation, moodBucket(pad)));
}
