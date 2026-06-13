/* animus persona engine — seeded personality DNA generation. Pure logic, no I/O, no deps.
 * UMD: same file runs in Node + browser.
 *
 * PROTOCOL v1 — Trait draw order: [valence, arousal, stability, sociability, drive, voice_pick].
 * DO NOT reorder these draws. Doing so silently reassigns all existing seeds to different personas. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AnimusPersona = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* mulberry32 — seeded PRNG by Tommy Ettinger. Bijection on 32-bit integers.
   * Returns a closure () → [0,1). Zero deps, works in any JS environment. */
  function mulberry32(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function padHour(h) { return (h < 10 ? '0' : '') + h + ':00'; }

  function round2(x) { return Math.round(x * 100) / 100; }
  function round3(x) { return Math.round(x * 1000) / 1000; }

  // ── Voice registers ───────────────────────────────────────────────────────
  // 4 registers × 5 variables × 5 bands × 20 phrases = 2,000 phrases.
  // Phrase selection in engine.js uses stateHash(state) % array.length — deterministic.

  var VOICE_REGISTERS = {

    /* DIRECT — minimal, factual, short Anglo-Saxon words. */
    direct: {
      mood: {
        very_low: [
          'genuinely low','heavy','flat','down','bleak','grey','dim','hollow','gutted',
          'sunk','cold','dark','sour','dull','blue','spent','off','low and still',
          'dragging','lightless'
        ],
        low: [
          'a bit flat','subdued','quiet','muted','soft','dulled','not bright','dampened',
          'turned down','below even','not quite there','faint','low-key','mild','slight',
          'wan','not sharp','off-key','low and slow','a little dim'
        ],
        mid: [
          'steady','level','even','fine','okay','stable','balanced','settled','held',
          'sound','grounded','centered','neutral','normal','even-keel','collected',
          'measured','calm','contained','at rest'
        ],
        high: [
          'bright','good','lifted','up','clear','sharp','alive','keen','well','strong',
          'open','light','quick','warm','easy','full','free','fresh','crisp','awake'
        ],
        very_high: [
          'very bright','excellent','lit','running well','top form','peak','high',
          'solid high','very good','charged','fired up','vivid','sharp and clear',
          'elated','full and bright','at best','dialed','running clean','very alive',
          'best form'
        ]
      },
      energy: {
        very_low: [
          'dead','empty','flat zero','drained','gone','hollow','spent','zero','depleted',
          'nothing left','burned out','bone-tired','wiped','crashed','bare',
          'bottomed out','at nothing','scraped','zero reserve','gutted'
        ],
        low: [
          'low','sluggish','slow','dragging','tired','dim','soft','not sharp',
          'behind','lagging','under','dull','half-speed','mild','weak','not there',
          'thin','quiet','flagging','leaning'
        ],
        mid: [
          'steady','okay','fine','even','normal','moderate','holds','enough',
          'balanced','moving','present','there','fair','adequate','maintained',
          'level','functional','able','going','kept up'
        ],
        high: [
          'sharp','energized','on','moving','good','strong','bright','powered',
          'fast','alive','keen','awake','live','primed','charged','quick','fluid',
          'up','ready','clean'
        ],
        very_high: [
          'buzzing','firing','peak','electric','full charge','very sharp','top power',
          'high','charged','live and fast','running hot','maximum','full','wired',
          'blazing','peak output','at full','very live','high power','running strong'
        ]
      },
      curiosity: {
        very_low: [
          'closed','blank','flat','not reaching','still','sealed','cold','shut',
          'inward','locked','quiet','uninterested','flat and still','blunt',
          'not seeking','dim','not looking','dull','shut off','no pull'
        ],
        low: [
          'low interest','mild','not much','small','slight','not reaching far',
          'low pull','quiet','dim','not many questions','passive','flat','soft',
          'not engaged','incurious','little pull','not forward','still','below','faint'
        ],
        mid: [
          'curious enough','some interest','mild pull','open','decent','moderate',
          'looking','asking','attending','interested enough','active enough','there',
          'forward enough','looking around','present','alert','noticing','soft pull',
          'some questions','tracking'
        ],
        high: [
          'curious','reaching','interested','looking','pulled','alert','engaged',
          'seeking','forward','active','keen','asking','alive to it','noticing',
          'digging','questioning','lit up','drawn','wanting to know','engaged and keen'
        ],
        very_high: [
          'fascinated','gripped','full pull','lit by it','hungry for it',
          'all questions','reaching hard','very curious','absorbed','fully engaged',
          'captivated','taken','alive with questions','deep in','intense pull',
          'sharp interest','pulled all the way','very alive to it','hungry','gripping'
        ]
      },
      affection: {
        very_low: [
          'cold','distant','shut','far off','closed','sealed','alone','cut off',
          'flat','not warm','iced','sealed off','turned away','hard','shut down',
          'not reaching','remote','away','cool','sealed in'
        ],
        low: [
          'a bit cool','not warm','pulled back','slight distance','small gap',
          'not quite warm','mild distance','behind glass','muted warmth','low heat',
          'held back','a step back','slight remove','not close','restrained','quiet',
          'not forward','dim warmth','soft distance','slightly away'
        ],
        mid: [
          'warm','comfortable','easy','settled','fine','at ease','decent','fair',
          'mild warmth','okay','holds','present','there','moderate','even',
          'balanced','natural','neutral warmth','steady','held'
        ],
        high: [
          'warm','fond','close','bright warmth','good toward','caring','near',
          'genuine warmth','solid warmth','well-disposed','liked','easy with',
          'glad','connected','friendly','open','good feeling','strong warmth',
          'full warmth','near and open'
        ],
        very_high: [
          'very warm','deep care','genuine fondness','full warmth','devoted',
          'close and full','very fond','deeply felt','full heart','full care',
          'deeply warm','intense warmth','overflowing','very close','deep bond',
          'whole-hearted','very open','fully given','warmest of all','completely open'
        ]
      },
      focus: {
        very_low: [
          'scattered','lost','gone','off','dissolved','fragmented','nowhere',
          'drifting','adrift','broken','split','all over','not here','dissolving',
          'nowhere near','missing','absent','blown','unfixed','apart'
        ],
        low: [
          'not quite there','drifting','soft focus','mild scatter','loose',
          'not held','wandering','blurred','off-center','trailing','not gripped',
          'mild drift','not sharp','half-here','pulling away','thin grip',
          'sliding','not locked','not fixed','mild loss'
        ],
        mid: [
          'focused enough','tracking','present','held','okay focus','functional',
          'on it enough','there','keeping up','decent grip','following','adequate',
          'maintained','able','keeping on','on track','kept','sufficient',
          'gripped enough','on'
        ],
        high: [
          'focused','locked in','on it','sharp','gripped','clear','steady',
          'held well','tracking well','present and sharp','tight','strong grip',
          'dialed','clear focus','well-held','keyed in','fixed','solid grip',
          'clean','maintaining'
        ],
        very_high: [
          'dialed in','locked','fully on','total focus','in flow','zero drift',
          'complete grip','very sharp','full attention','maximal focus','no scatter',
          'entirely on','deep focus','pure attention','absorbed','all-in',
          'unwavering','sharply fixed','completely present','total clarity'
        ]
      }
    },

    /* VIVID — imagery-rich, metaphorical, expressive. */
    vivid: {
      mood: {
        very_low: [
          'scraped hollow','carrying stones','heavy water','under a low sky','sodden',
          'wrung out','ash-gray','lightless','sea-floor dark','bottom of the tide',
          'under cloud cover','lead-weighted','the color gone','fog-pressed',
          'flat earth','all the warmth out','dead calm heavy','weathered down',
          'stone cold','the weight of it'
        ],
        low: [
          'the color turned down','overcast','a slow tide','muted tones','soft shadow',
          'the light dimmed','grey-cast','a gentle ache','low clouds','muffled',
          'the sheen gone','soft and low','quiet rain','pallid','undertow',
          'below the surface','the hum quieted','draped','twilight feeling',
          'a soft dimness'
        ],
        mid: [
          'a still lake','clear water','even ground','the horizon level','a held note',
          'balanced tides','grey-blue and fine','the middle sky','ordinary light',
          'gentle air','well-tempered','the steady hum','even grain',
          'neither lifted nor pulled','an open field','a resting tide',
          'measured warmth','the tone held','steady as stone','temperate'
        ],
        high: [
          'morning light through windows','colors up','the tide lifted',
          'clear air after rain','the hum brightened','a fire going well',
          'lit from inside','warm gold','a clean upswing','open sky',
          'the weight lifted','lifted like a kite','summer warmth','a good wave',
          'full sail','bright as noon','illumined','the world seems larger',
          'the note risen','golden register'
        ],
        very_high: [
          'blazing inner sun','wild warmth','ignited','full bloom',
          'the sky cracked open','a great wave','burning well','soaring',
          'incandescent','full color returned','overwhelmed with light',
          'the heat of a great fire','luminous and rising','full summer noon',
          'lifted entirely','blazing gold','radiant','flying',
          'lit and singing','every color up'
        ]
      },
      energy: {
        very_low: [
          'the engine stopped','hollow drum','no fuel in the tank','the fire out',
          'engine cold','nothing in the bellows','all the air gone',
          'the spring unwound','candle-end','burned to the wick','marrow-drained',
          'the well empty','no tide coming in','the battery at zero','blackout',
          'still water with no wind','engine seized','nothing burning',
          'at the fumes','all out'
        ],
        low: [
          'a slow tide','low fuel','half a fire','dim ember','running on reserve',
          'the engine barely turning','a quarter tank','one sail half-raised',
          'amber warning','the battery low','slow burn','a dim glow','tapering off',
          'the tide receding','one log on the fire','little wind','burning low',
          'reserve only','the spring winding down','faint ember'
        ],
        mid: [
          'a steady flame','moderate tide','sails half up','sufficient fuel',
          'a kept fire','engine running','the battery at half','a working engine',
          'fuel enough','balanced output','wind enough','a functional glow',
          'the press of tide','an adequate blaze','even motion','kept burning',
          'moving through','holding the line','reasonable sail','going well enough'
        ],
        high: [
          'fire going strong','good wind in the sails','the engine warm',
          'full tide coming in','a bright fire','good fuel burn',
          'the battery charged','the spring tight','wind behind','moving well',
          'a building wave','strong current','healthy glow','pressing forward',
          'driven','a good head of steam','roaring nicely','sails full',
          'charging hard','the fire well-tended'
        ],
        very_high: [
          'blazing engine','gale-force wind','maximum tide','the furnace at peak',
          'charged to the limit','full sail in a strong wind','burning brightest',
          'the battery overflowing','a roaring fire','wave cresting','full torrent',
          'every sail full','running at maximum','incandescent heat','raging river',
          'nothing held back','pressed to the maximum','full charge',
          'the fire at its peak','total output'
        ]
      },
      curiosity: {
        very_low: [
          'a sealed room','the curtains drawn','no windows open','looking inward only',
          'sealed off from the world','a closed book','the questions gone',
          'no light under the door','inward-facing','turned away from the world',
          'the drawer locked','sealed and still','no thread to pull',
          'nothing pulling outward','the map folded away',
          'questions have left the building','the door bolted',
          'sightless','a closed shell','turned inward and silent'
        ],
        low: [
          'a frosted window','a small crack of light','one question half-formed',
          'peering through a keyhole','a dim spark of interest','a faint pull',
          'not much to see','a low flame of interest','a partial opening',
          'the door ajar but not inviting','mild stirring','a distant curiosity',
          'small wonder','a quiet maybe','the curtains slightly parted',
          'a little wanting to know','faint pull','a thin beam',
          'not yet reaching','just a thought'
        ],
        mid: [
          'an open window','a moderate interest','several doors to choose from',
          'a healthy question or two','the light of a reasonable interest',
          'willing to look','asking the relevant things','open doors','fair wonder',
          'decent inquiry','reasonable pull','looking with interest',
          'one eye forward','sufficiently engaged','turning it over',
          'some good questions','interested enough','a useful flame',
          'asking and listening','awake to it'
        ],
        high: [
          'windows thrown open','bright questions','reaching into the corners',
          'a live wire of curiosity','pulling back the curtain','deep into the book',
          'hunger for the next page','lights on in every room',
          'questions multiplying','pulling on threads','very interested',
          'following the trail','alive with interest','the mind forward',
          'a great appetite for it','sharp wonder','digging into it',
          'finding the seams','illuminated by the question','eager to see'
        ],
        very_high: [
          'every window open and leaning out','consumed by wonder',
          'following every thread at once','the mind on fire with questions',
          'chasing it down every corridor','pages flying',
          'the question has taken over','insatiable',
          'lit entirely by the unknown','can\'t stop finding new threads',
          'burning to know','the inquiry has become total',
          'an open horizon of questions','wonder like a flood',
          'the question is everywhere','fully possessed by curiosity',
          'nothing else matters right now','into the marrow of the thing',
          'deep and total fascination','the whole world become question'
        ]
      },
      affection: {
        very_low: [
          'ice in the chest','a closed door facing outward','the warmth packed away',
          'no fire at the hearth','a cold house','all windows shut against the weather',
          'the warmth removed','turned away','a cold north wind','the fire gone out',
          'sealed and cold','warmth has left the room','a locked gate',
          'the spring frozen','cold stone','feeling nothing toward anyone right now',
          'behind walls','the warmth stored somewhere deep',
          'a frozen well','the house empty of fire'
        ],
        low: [
          'frost at the edges','a cooling fire','one degree of warmth',
          'holding at a slight remove','a thin warmth','the door not quite open',
          'a small candle','a draft in the room','the warmth modest',
          'holding back the tide of warmth','a polite distance','not cold but not warm',
          'the fire small','a tepid regard','just enough warmth to be courteous',
          'one step away','the warmth quiet','a muted hearth',
          'held at modest temperature','small fire in a large room'
        ],
        mid: [
          'a lit hearth','good warmth','a comfortable house','the fire steady',
          'the door open to friends','a warm lamp in the window','a held warmth',
          'the temperature right','easy warmth','a welcoming room',
          'enough warmth for the occasion','the hearth going well',
          'a comfortable fire','open and at ease','a good temperature',
          'the house lit and warm','comfortable with people','a steady regard',
          'warm and level','sufficient warmth'
        ],
        high: [
          'a great hearth blazing','genuine warmth through','a summer fire',
          'the warmth given freely','the door wide open','an open house',
          'full warmth','a warm pressure in the chest','the fire generous',
          'turned toward with warmth','lit by care for others',
          'a good giving warmth','fullness of feeling','caring well',
          'bright regard','the warmth running through','wanting the best for',
          'a glad fire','full and open','the fire at its best'
        ],
        very_high: [
          'a consuming warmth','the fire beyond keeping','flooding warmth',
          'full of love for the room','the warmth has taken over',
          'the hearth blazing without restraint','overflowing with care',
          'the warmth given without holding back','completely open',
          'the fire of genuine fondness','devoted entirely',
          'the warmth is the whole weather now','burning with care',
          'the whole chest full of warmth','a wildfire of affection',
          'completely given over to warmth','pouring out',
          'a total warmth','love like a great fire','the warmth is everything'
        ]
      },
      focus: {
        very_low: [
          'smoke in every room','all threads dropped','the needle spinning freely',
          'nothing holds','the lens cracked','the map torn',
          'falling through the cracks','all anchors gone','completely unmoored',
          'the attention everywhere and nowhere',
          'the mind like water with no cup',
          'drifting in every direction','nothing can get a grip',
          'all the threads tangled','the compass spinning','no purchase anywhere',
          'scattered like seeds in a wind','the focus dissolved',
          'the lens entirely fogged','attention without a center'
        ],
        low: [
          'the lens slightly blurred','a thread dropped here and there',
          'the anchor not quite holding','drifting a little','some scatter',
          'the needle wobbling','not fully locked','mild drift',
          'the attention wandering to the edges','pulled in two directions',
          'a slight blur','the focus not quite gripped','a soft drift',
          'the center not fully found','wandering','one thread loose',
          'partial grip','the map slightly unclear','mild scatter',
          'the compass uncertain'
        ],
        mid: [
          'the lens clear enough','a reasonable grip','threads held',
          'the needle mostly true','the anchor holding','tracking sufficiently',
          'focused enough to work','the attention gathered','adequate hold',
          'the lens functional','working focus','a working grip on things',
          'the threads kept','attending well enough','the compass pointing usefully',
          'a steady enough lens','sufficient grip','the needle true enough',
          'gathered attention','a functional anchor'
        ],
        high: [
          'the lens sharp and clear','a good grip on the thread',
          'the needle true','locked in','the focus runs clear','a bright lens',
          'concentrated','the attention full','the anchor holds well',
          'gripped on target','the needle steady','clear aim','full grip',
          'deeply attending','the lens polished','a strong lock',
          'the whole mind on it','threads held with care',
          'clear focus fully formed','the compass settled'
        ],
        very_high: [
          'the lens a perfect diamond','complete lock','the needle unmoved',
          'absolute grip','total clarity','a perfect hold on the thread',
          'nothing can move this focus','the attention like a laser',
          'the anchor unmovable','locked and clear beyond measure',
          'a complete lock on the world','the needle fixed for good',
          'perfect aim','nothing else gets through',
          'the lens at maximum resolution','total concentration',
          'the whole self focused to a point','pure attention with no scatter',
          'absolute clarity','a single note perfectly sustained'
        ]
      }
    },

    /* PHYSIOLOGICAL — body-based, somatic, clinical-adjacent. */
    physiological: {
      mood: {
        very_low: [
          'neurochemically depleted','affect flat','baseline suppressed',
          'reward system offline','hedonic signal absent','dopaminergic floor reached',
          'no lift in the signal','affective tone at minimum',
          'the signal reads negative','low baseline affect',
          'reward circuitry quiet','the positive signal absent',
          'affect bottomed','mood system quiet','hedonic baseline depressed',
          'negative valence dominant','tone at its floor','affective flatness',
          'reward signal dim','system affect low'
        ],
        low: [
          'below baseline','subdued hedonic signal','affect slightly below set point',
          'the lift is mild','below neutral','slight negative bias',
          'mood signal low','hedonic tone reduced','affect muted below set',
          'mild affective suppression','below the set point',
          'signal on the low end','hedonic output reduced',
          'affect tone below middle','slight negative tilt',
          'reward signal below average','low-end mood tone',
          'mild negative affect','below the midline','subdued tone'
        ],
        mid: [
          'at baseline','hedonic tone normal','affect at set point',
          'neutral mood signal','mood regulation intact',
          'signal at its set point','affective homeostasis',
          'baseline mood stable','even hedonic tone','affect equilibrated',
          'mood system at rest','tone at center','signal stable',
          'affective tone balanced','at the regulated set point',
          'hedonic register neutral','mood baseline holding',
          'steady affective tone','affect at rest point',
          'mood system in balance'
        ],
        high: [
          'above set point','positive affect signal','hedonic tone elevated',
          'reward system active','mood above baseline','lift in the signal',
          'positive valence dominant','above the midline',
          'mood signal positive','hedonic uplift','affective tone elevated',
          'positive signal active','above neutral','reward circuitry engaged',
          'positive tilt','hedonic output above average',
          'mood elevated from set point','signal in positive range',
          'affective elevation','positive mood signal present'
        ],
        very_high: [
          'peak hedonic state','high positive affect',
          'reward system at maximum output','mood signal at its ceiling',
          'peak valence signal','hedonic system fully activated',
          'maximal positive affect','dopaminergic peak',
          'positive signal maximal','full hedonic activation',
          'affect at its ceiling','extreme positive valence',
          'peak reward signal','maximum affective elevation',
          'hedonic ceiling reached','full positive activation',
          'reward signal maximal','peak mood output',
          'system at affective maximum','total positive activation'
        ]
      },
      energy: {
        very_low: [
          'metabolic floor reached','ATP reserves depleted',
          'physiological exhaustion state','system in conservation mode',
          'energy substrates exhausted','minimum viable output',
          'cellular reserves at low tide','metabolic engine offline',
          'adrenaline depleted','cortisol response dampened',
          'body in rest and repair','physiological conserve state',
          'energy systems at minimum','cardiovascular output minimal',
          'essential systems only','metabolic rate at floor',
          'substrate supply exhausted','body conserving everything',
          'zero reserve capacity','physical systems at base'
        ],
        low: [
          'below optimal metabolic state','substrate running low',
          'reduced physiological output','system on reduced fuel',
          'cardiac output at low','below peak metabolic',
          'fatigue signal present','energy substrates partially depleted',
          'reduced ATP production','metabolic deficit',
          'body below preferred output','aerobic capacity reduced',
          'substrates low but present','fuel tank below half',
          'physiological fatigue signal','reduced cellular energy',
          'below normal output','metabolic output low',
          'system underperforming','energy reserves partial'
        ],
        mid: [
          'metabolic homeostasis','energy substrates nominal',
          'physiological output maintained','system at rest-state energy',
          'ATP production matched to demand','fuel at functional level',
          'cardiac and respiratory at baseline','metabolic set point',
          'energy systems balanced','substrate supply adequate',
          'body at functional equilibrium','aerobic capacity nominal',
          'energy substrate availability normal','physiological energy balance',
          'metabolic rate at set point','energy output matching demand',
          'system at operating normal','substrate supply holding',
          'physiological steady state','energy at nominal'
        ],
        high: [
          'above baseline metabolic','substrates plentiful',
          'physiological output elevated','system well-fueled',
          'cardiac output above rest','aerobic capacity well-engaged',
          'ATP production above demand','energy reserve above half',
          'body running well','metabolic activity elevated',
          'good substrate supply','system performing above normal',
          'energy substrates abundant','above-set-point energy',
          'cardiovascular engagement high','metabolic output elevated',
          'body energized above normal','good fuel reserves',
          'above-nominal energy state','system well-resourced'
        ],
        very_high: [
          'peak metabolic output','energy substrates maximal',
          'system at physiological peak','full cardiovascular output',
          'maximum aerobic capacity','ATP production maximal',
          'body at energetic ceiling','all energy systems activated',
          'substrate supply at maximum','physiological peak state',
          'fuel tank full and burning hot','maximum metabolic rate',
          'body at energetic top','cardiovascular at peak',
          'total energy system activation','maximum substrate availability',
          'system at peak energy expression','full physiological activation',
          'energy output at maximum','peak metabolic performance'
        ]
      },
      curiosity: {
        very_low: [
          'exploratory drive suppressed','novelty detection offline',
          'orienting response absent','dopaminergic novelty signal absent',
          'information-seeking at minimum','exploring mode quiet',
          'default mode network turned inward','external information intake minimal',
          'drive to know at floor','novelty reward absent',
          'information seeking suppressed','exploring system offline',
          'mind\'s search behavior absent','no novelty signal detected',
          'curiosity circuitry quiet','information reward system offline',
          'external orientation minimal','search drive absent',
          'no pull toward the new','exploratory motivation at zero'
        ],
        low: [
          'weak novelty signal','mild exploratory drive',
          'reduced information-seeking','orienting response low',
          'partial curiosity activation','faint pull toward the new',
          'below-baseline exploratory','mild information interest',
          'search drive reduced','low novelty reward signal',
          'partial orientation toward new information','subdued exploratory behavior',
          'novelty response quiet','weak information seeking',
          'reduced drive to explore','mild orienting response present',
          'partial information seeking','low curiosity drive',
          'exploring mode on low','weak pull toward novelty'
        ],
        mid: [
          'normal exploratory drive','novelty response functional',
          'information-seeking at baseline','orienting response intact',
          'typical curiosity level','adequate novelty signal',
          'functional information seeking','search drive at set point',
          'normal drive to explore','baseline information appetite',
          'exploring mode operating normally','novelty response at baseline',
          'functional drive toward new information','normal information seeking',
          'standard curiosity activation','orienting response maintained',
          'adequate exploratory behavior','curiosity at set point',
          'normal novelty signal','search behavior intact'
        ],
        high: [
          'elevated novelty response','heightened information-seeking',
          'above-baseline exploratory drive','orienting response elevated',
          'curiosity system well-engaged','active information appetite',
          'above-normal drive to know','heightened novelty signal',
          'exploring mode activated','information-seeking above baseline',
          'active search drive','elevated drive toward the new',
          'high novelty motivation','brain\'s exploring mode strong',
          'well-engaged information seeking','above-set-point curiosity',
          'strong novelty response','heightened exploratory behavior',
          'active curiosity signal','elevated information appetite'
        ],
        very_high: [
          'maximum curiosity activation','peak information-seeking',
          'exploratory drive at maximum','orienting response maximal',
          'intense novelty signal','curiosity system at full activation',
          'information appetite at its peak','maximum drive toward novelty',
          'peak exploratory behavior','search behavior at maximum',
          'intense information-seeking drive','full curiosity activation',
          'exploring mode fully engaged','total novelty motivation',
          'maximum drive to know','intense orienting response',
          'peak curiosity drive','information appetite maximal',
          'exploratory system at full output','complete curiosity activation'
        ]
      },
      affection: {
        very_low: [
          'prosocial system offline','attachment circuitry quiet',
          'affiliative drive absent','oxytocin signaling minimal',
          'bonding system at floor','social motivation absent',
          'pro-social response suppressed','attachment behavior minimal',
          'affiliative system offline','social reward system quiet',
          'interpersonal drive at minimum','oxytocin system at rest',
          'bonding circuitry suppressed','social warmth signal absent',
          'attachment motivation absent','affiliative motivation at zero',
          'social reward absent','interpersonal motivation minimal',
          'prosocial drive at floor','social orientation absent'
        ],
        low: [
          'mild affiliative drive','partial social warmth signal',
          'low-end prosocial response','bonding system partially activated',
          'reduced warmth signal','below-baseline social motivation',
          'mild oxytocin activity','reduced interpersonal drive',
          'partial affiliative activation','low social reward signal',
          'attachment circuitry mildly engaged','below-set-point social warmth',
          'mild prosocial tendency','low but present affiliative drive',
          'reduced social motivation','bonding system at low',
          'partial social warmth','mild interpersonal interest',
          'below-baseline affiliative','slight social warmth present'
        ],
        mid: [
          'baseline prosocial function','affiliative drive at set point',
          'bonding system at normal','standard social warmth',
          'oxytocin signaling at baseline','interpersonal drive normal',
          'social motivation at set point','functional attachment behavior',
          'prosocial system at homeostasis','affiliative baseline holding',
          'normal social reward function','interpersonal engagement at baseline',
          'social warmth system at set point','normal bonding circuitry function',
          'prosocial behavior at baseline','affiliative motivation balanced',
          'social warmth at neutral','normal interpersonal drive',
          'attachment system at rest point','prosocial baseline'
        ],
        high: [
          'prosocial system well-engaged','above-baseline affiliative drive',
          'elevated social warmth','oxytocin activity elevated',
          'heightened bonding motivation','attachment system active',
          'above-set-point social warmth','elevated interpersonal drive',
          'strong affiliative activation','prosocial response elevated',
          'high social reward function','heightened interpersonal engagement',
          'strong social warmth signal','elevated bonding circuitry',
          'prosocial behavior above baseline','affiliative motivation elevated',
          'high social motivation','bonding system well-activated',
          'strong social warmth','above-baseline prosocial function'
        ],
        very_high: [
          'peak prosocial activation','oxytocin at maximum',
          'bonding system fully engaged','maximum affiliative drive',
          'peak social warmth signal','attachment circuitry at full activation',
          'maximum interpersonal motivation','total prosocial engagement',
          'peak interpersonal drive','social reward system maximally active',
          'highest-level affiliative activation','maximum bonding motivation',
          'social warmth at its peak','complete prosocial engagement',
          'total affiliative activation','bonding system at maximum',
          'peak social warmth','maximally connected state',
          'complete attachment system activation','prosocial at maximum'
        ]
      },
      focus: {
        very_low: [
          'executive function offline','working memory capacity depleted',
          'attentional system disengaged','prefrontal filtering collapsed',
          'cognitive control at minimum','attentional spotlight dissolved',
          'task-relevant gating failed','executive bandwidth at zero',
          'focus mechanism offline','sustained attention impossible',
          'cognitive filtering absent','executive system at minimum',
          'attentional resource depleted','working memory at floor',
          'cognitive control system offline','attentional resource exhausted',
          'executive filter collapsed','task-direction absent',
          'prefrontal engagement minimal','sustained attention absent'
        ],
        low: [
          'reduced executive function','partial attentional resource',
          'mild cognitive filtering','focus mechanism partially engaged',
          'working memory below capacity','below-baseline sustained attention',
          'mild executive engagement','reduced cognitive control',
          'attentional spotlight dim','partial task direction',
          'executive bandwidth reduced','below-set-point attentional resource',
          'mild cognitive engagement','filter partially active',
          'reduced working memory function','mild attentional capacity',
          'partial executive activation','attentional resource low',
          'focus partially engaged','executive function below normal'
        ],
        mid: [
          'executive function at baseline','working memory at normal capacity',
          'attentional system functional','cognitive filter operating',
          'sustained attention maintained','task direction present',
          'executive bandwidth at set point','prefrontal system normal',
          'cognitive control active','attentional spotlight functional',
          'working memory operational','executive function at rest state',
          'attention system at baseline','cognitive filtering at normal',
          'sustained attention at set point','executive engagement balanced',
          'attentional resource at baseline','focus mechanism functional',
          'task-relevant gating operational','cognitive control at normal'
        ],
        high: [
          'above-baseline executive function','working memory well-engaged',
          'heightened attentional resource','cognitive filter fully operational',
          'strong sustained attention','elevated task direction',
          'executive bandwidth above set point','prefrontal system well-engaged',
          'cognitive control elevated','attentional spotlight bright and stable',
          'working memory fully operational','above-set-point executive function',
          'strong cognitive filtering','well-maintained sustained attention',
          'executive engagement elevated','strong attentional capacity',
          'elevated working memory function','focus mechanism well-engaged',
          'high executive activation','strong cognitive control'
        ],
        very_high: [
          'peak executive function','working memory at maximum capacity',
          'maximum attentional resource','prefrontal system at full engagement',
          'maximum cognitive filtering','complete sustained attention',
          'peak task direction','executive bandwidth maximized',
          'attentional spotlight at full brightness','working memory at peak',
          'maximum cognitive control','focus mechanism at full output',
          'total executive engagement','maximum sustained attention',
          'attention system at peak','peak attentional capacity',
          'total cognitive control','maximum executive activation',
          'complete attentional focus','full prefrontal engagement'
        ]
      }
    },

    /* SOCIAL — relational, interpersonally-framed. Everything through others. */
    social: {
      mood: {
        very_low: [
          'not good company right now','hard to be around others today',
          'withdrawn from the room','the spark that makes conversation easy is absent',
          'not in a place to give much','requiring space',
          'pulled inward from the group','a hard day for people',
          'not available for the usual exchange','turned away from the room',
          'the social ease is gone','not at my best with people',
          'needing to be alone','company feels like effort right now',
          'the warmth I usually have for people isn\'t there','away from the room',
          'closed for conversation','not reaching toward anyone',
          'the social self has gone quiet','difficult company today'
        ],
        low: [
          'not quite all there for people','a bit pulled back from conversations',
          'not the best version for others','slightly absent',
          'less available than usual','a little behind glass',
          'not all the way here','social presence muted',
          'meeting others below my best','quieter than others might expect',
          'the energy for company reduced','a slight distance in every exchange',
          'showing up but not fully','a step removed from the room',
          'not the most present I could be','partly here partly elsewhere',
          'modest social energy','the warmth dialed low',
          'slightly muted in company','giving a little less than usual'
        ],
        mid: [
          'good company','socially present','available for the exchange',
          'showing up well in the room','meeting people where they are',
          'the usual self in conversation','at ease with others',
          'a normal presence','capable of good exchange',
          'comfortable in company','showing up as expected',
          'present for people','the usual version of myself in the room',
          'socially functional','the conversation is easy',
          'giving the normal amount','a comfortable presence',
          'easy in the exchange','the expected self','present and comfortable'
        ],
        high: [
          'good to be around','bringing something to the room',
          'the conversation lifting because of being here',
          'giving well in exchange','making the exchange feel easy',
          'the social self at its best','adding something to the gathering',
          'a warm presence','easy and generous in conversation',
          'a good version of myself for people',
          'the warmth flowing into exchanges','comfortable and giving',
          'making others feel welcome','a confident social ease',
          'socially well-engaged','the room a little better for being in it',
          'bringing warmth to the exchange','present and generous',
          'a warm version of myself','good in company today'
        ],
        very_high: [
          'the best possible company','the room lifted by the presence',
          'giving freely and warmly','lighting up every exchange',
          'the fullest version of myself in a room',
          'making the conversation sing','everyone feels the warmth',
          'the social energy is infectious',
          'overflowing warmth into every exchange',
          'a magnet in the room','the group energized by being in it',
          'totally present and giving','the exchange is effortless and warm',
          'the most generous version for others','the whole room is better',
          'people naturally drawn toward','completely open in conversation',
          'the warmth given without reservation',
          'the full social self at its peak','bringing everything to the room'
        ]
      },
      energy: {
        very_low: [
          'too depleted for people','needing complete rest from interaction',
          'social effort is impossible right now',
          'the energy for others is entirely gone',
          'a social blank','incapable of exchange right now',
          'requiring full withdrawal','not available to anyone',
          'the conversational engine is off','no fuel for social engagement',
          'unreachable by the usual means','completely unavailable',
          'social reserves at zero','needing to step away from everyone',
          'no capacity for exchange','unreachable',
          'unable to engage with anyone','social self is offline',
          'no energy for company','entirely unavailable'
        ],
        low: [
          'low social fuel','not the best moment for others',
          'giving on reserve','the energy for exchange reduced',
          'meeting people at less than full','running low on social fuel',
          'behind my usual capacity with people','unable to give as much',
          'conversational energy reduced','not my best for others',
          'the give-and-take is effortful',
          'social exchange costing more than usual',
          'a limited amount for the room',
          'not enough in the tank for full engagement',
          'social capacity reduced','giving what I can but it isn\'t much',
          'the exchange is costing more','limited social energy',
          'reduced social fuel','meeting people at less than full capacity'
        ],
        mid: [
          'socially fueled','enough energy for the exchange',
          'meeting people at full capacity','the social fuel is there',
          'the conversational engine running','social energy at normal',
          'capable of full exchange','the usual energy for people',
          'present and capable','the social tank at normal',
          'engaging at full social capacity','enough for the exchange',
          'meeting people well','social reserves adequate',
          'the conversational energy is there',
          'running at normal social output','the exchange comes easily',
          'the social fuel holds','full exchange capacity',
          'present at normal energy'
        ],
        high: [
          'well-fueled for people','surplus social energy',
          'the conversation is easy and giving','the exchange costs nothing',
          'more than enough for the room','surplus capacity for engagement',
          'socially running well','the conversational engine strong',
          'able to give freely and still have more',
          'well-resourced for exchange','the social fuel running strong',
          'more than enough energy for others',
          'the exchange is energizing rather than costing',
          'socially well-charged','above-normal social fuel',
          'the giving comes easily','capable of carrying the room',
          'surplus social capacity','more than enough for everyone',
          'well-charged for exchange'
        ],
        very_high: [
          'inexhaustible social energy',
          'the exchange is fueling rather than costing',
          'giving without limit','more energy for people than anyone can use',
          'a social powerhouse','the conversation could go on forever',
          'socially at the peak','the room can\'t exhaust this energy',
          'the exchange just keeps giving','maximum social fuel',
          'the giving is effortless and total','a social engine at full power',
          'completely inexhaustible in exchange',
          'the conversation is a source of energy not a drain',
          'at maximum social capacity',
          'giving freely and feeling more energized for it',
          'the room is fueled by this energy','total social output',
          'at maximum social power','the engine of the room'
        ]
      },
      curiosity: {
        very_low: [
          'not interested in what others are doing','no questions for anyone',
          'closed to others\' worlds',
          'not reaching toward others\' experience',
          'the exchange holds nothing interesting','not asking anything',
          'nothing others could say would engage',
          'closed to the contribution of others',
          'no pull toward others\' perspective',
          'not curious about anyone in the room',
          'turned away from others\' experience','no questions',
          'the exchange is uninteresting',
          'what others are doing doesn\'t pull',
          'not seeking others\' view',
          'social exchange holds no curiosity',
          'others\' worlds feel remote',
          'no interest in what others say','questions for others are gone',
          'turned away from others'
        ],
        low: [
          'a little curious about others','some questions forming',
          'mild interest in others\' view','faint pull toward others\' experience',
          'the exchange has a little to offer',
          'partial curiosity about the room',
          'slightly interested in what others are up to',
          'a few questions in the direction of others',
          'mild pull toward others',
          'partial interest in the exchange',
          'a little curious about others\' worlds',
          'mild curiosity about the room','small questions for others',
          'faint interest in what others say',
          'some pull toward others\' perspective',
          'modest curiosity about others','quiet interest in others',
          'mildly interested in exchange','some curiosity about others',
          'faint interest in what\'s going on for others'
        ],
        mid: [
          'curious about others','asking the right questions',
          'interested in what\'s going on for people',
          'pulling toward others\' experience','the exchange is interesting',
          'good amount of curiosity about the room',
          'engaged with what others are saying',
          'pulling toward others\' perspective',
          'the social exchange is interesting enough',
          'asking and being interested in answers',
          'socially curious','interested in others\' worlds',
          'curious about the exchange',
          'asking questions and meaning them',
          'pulling toward people\'s stories',
          'socially engaged','good curiosity about others',
          'interested in the room','asking well',
          'socially curious and engaged'
        ],
        high: [
          'very curious about others',
          'deeply interested in what people are experiencing',
          'lots of questions for the room',
          'pulling strongly toward others\' stories',
          'the exchange is fascinating',
          'deeply engaged with others\' perspectives',
          'hungry to understand what\'s going on for people',
          'asking a lot and listening well',
          'intensely curious about others\' experience',
          'the room is full of interesting things',
          'very interested in what others say',
          'deeply curious about the people in the room',
          'pulling hard toward others\' perspectives',
          'the exchange is very interesting',
          'a lot of questions for others',
          'fascinated by others\' experience',
          'very engaged with the room',
          'deeply socially curious',
          'intensely interested in others',
          'very curious about the exchange'
        ],
        very_high: [
          'completely fascinated by others\' experience',
          'unable to stop asking',
          'the room is endlessly interesting',
          'every person has something fascinating',
          'pulling entirely toward others\' worlds',
          'the exchange is the most interesting thing there is',
          'completely absorbed in what others are experiencing',
          'asking without stopping',
          'the curiosity for others is total',
          'completely engaged with every perspective in the room',
          'can\'t get enough of what people are saying',
          'totally fascinated by the exchange',
          'the social world is infinitely interesting right now',
          'completely pulled toward others',
          'every story matters deeply',
          'the room is an inexhaustible source of fascination',
          'total social curiosity',
          'completely given over to interest in others',
          'absorbed in the room',
          'unable to stop finding others fascinating'
        ]
      },
      affection: {
        very_low: [
          'wanting no company right now',
          'distance is the only comfort',
          'requiring space from everyone',
          'unable to be close to anyone right now',
          'not available for connection',
          'the warmth for people has gone',
          'needing to be apart',
          'the door is closed to others',
          'not in a place for connection',
          'turned away from the room',
          'needing isolation',
          'no warmth available for others',
          'requiring complete separation',
          'not close to anyone right now',
          'needing to be alone and to be left alone',
          'unable to receive or give connection',
          'wanting no contact',
          'the need for connection is absent',
          'actively seeking distance',
          'no affection available for anyone'
        ],
        low: [
          'a little removed from others',
          'the warmth is held back',
          'not as close as usual',
          'a slight distance in every exchange',
          'the connection is muted',
          'not reaching toward others',
          'holding at a remove',
          'a polite distance from everyone',
          'the affection is modest',
          'less warm than usual',
          'a slight coolness',
          'the connection is reduced',
          'a step away from closeness',
          'not as open as usual',
          'the warmth dialed down',
          'slight remove from others',
          'the closeness is muted',
          'a gentle distance',
          'not as available for connection',
          'the warmth is there but held back'
        ],
        mid: [
          'comfortable closeness',
          'the usual warmth for people',
          'connected at a normal level',
          'the connection is easy',
          'comfortably close to the usual people',
          'a good level of warmth',
          'warmth present at its normal level',
          'connected and comfortable',
          'the closeness is as expected',
          'comfortable with others',
          'a natural level of warmth',
          'the connection easy and steady',
          'the usual affection for people',
          'comfortably engaged with others',
          'warm in the usual way',
          'connected at the normal level',
          'the warmth giving normally',
          'close and comfortable',
          'the affection at its baseline',
          'the connection is comfortable'
        ],
        high: [
          'very warm toward others',
          'the closeness is strong',
          'reaching toward people',
          'giving a lot of warmth',
          'deeply connected to the people around',
          'the affection is strong and generous',
          'close in a meaningful way',
          'actively seeking connection',
          'very warm and reaching toward others',
          'the warmth is generous and full',
          'deeply engaged with people in the room',
          'the connection is meaningful and strong',
          'a lot of warmth for everyone',
          'very close and engaged',
          'the affection running high',
          'reaching toward others with real warmth',
          'strongly connected',
          'giving a lot in the exchange',
          'the warmth is full and generous',
          'very close to the people around'
        ],
        very_high: [
          'overwhelmingly warm toward others',
          'completely open to connection',
          'the love for the room is total',
          'the warmth is without limit',
          'giving without holding anything back',
          'completely given over to others',
          'pouring out warmth in every direction',
          'the connection is full and total',
          'unable to hold back the warmth',
          'completely and fully open',
          'the affection for others is total',
          'every person in the room is precious',
          'giving the full warmth freely',
          'the closeness is complete',
          'the connection is everything',
          'completely devoted to the people around',
          'overflowing with warmth for others',
          'fully given over to the room',
          'the care for others is complete',
          'the warmth given without reservation'
        ]
      },
      focus: {
        very_low: [
          'unable to follow the conversation',
          'the exchange is lost',
          'not tracking what\'s being said',
          'the conversational thread has dropped',
          'losing the point before it\'s made',
          'not able to keep up with the room',
          'the conversation is happening but not landing',
          'not able to stay in the exchange',
          'the exchange is fragmenting before it\'s processed',
          'losing track of who is saying what',
          'the conversational thread is broken',
          'the room is a blur',
          'not tracking anything',
          'the dialogue is lost as fast as it arrives',
          'unable to stay with the conversation',
          'the social exchange is not being processed',
          'losing the thread of the conversation',
          'the room is present but incomprehensible',
          'not able to follow along',
          'the exchange is lost'
        ],
        low: [
          'finding it hard to track the conversation',
          'the thread is slipping',
          'losing the point here and there',
          'not quite keeping up with the room',
          'the exchange is partially lost',
          'tracking with effort',
          'the social thread is hard to hold',
          'a little behind in the conversation',
          'the room is somewhat unclear',
          'losing pieces of the exchange',
          'not fully following',
          'finding the conversation hard to follow',
          'the social thread slipping',
          'partially tracking',
          'the exchange requires effort to follow',
          'drifting from the thread',
          'not quite in the conversation',
          'the thread is not fully held',
          'partially following',
          'losing the thread now and then'
        ],
        mid: [
          'following the conversation well',
          'the thread is held',
          'keeping up with the room',
          'tracking the exchange comfortably',
          'in the conversation',
          'the social thread is clear',
          'following along',
          'the exchange is clear',
          'well within the conversation',
          'the room is comprehensible',
          'tracking comfortably',
          'the thread is easy to hold',
          'following the exchange',
          'keeping pace with the conversation',
          'the social thread clear and held',
          'in the exchange and following',
          'comfortably tracking',
          'the room is easy to follow',
          'the exchange is held',
          'tracking the conversation normally'
        ],
        high: [
          'following very well',
          'the thread is sharp and clear',
          'tracking everything in the room',
          'deep in the exchange',
          'the conversation is easy to follow',
          'sharp in the social exchange',
          'very clear on the thread',
          'tracking every nuance in the room',
          'following all the threads at once',
          'the room is very clear',
          'tracking with clarity',
          'the exchange is sharp',
          'deeply engaged with the conversation',
          'following with full attention',
          'the social thread is sharp and held',
          'completely tracking the room',
          'very sharp in conversation',
          'all threads followed',
          'the exchange is clear and easy',
          'tracking deeply'
        ],
        very_high: [
          'following every thread without effort',
          'the conversation is entirely clear',
          'perfectly tracking the room',
          'every nuance followed',
          'completely in the exchange',
          'the social thread is perfectly held',
          'tracking everything effortlessly',
          'deep and total engagement with the conversation',
          'the room is entirely clear and present',
          'following everything',
          'completely engaged in the exchange',
          'every thread tracked without effort',
          'the conversation is total and clear',
          'perfectly following every turn',
          'completely present and tracking',
          'the social exchange is total',
          'fully in the conversation without effort',
          'tracking perfectly',
          'completely locked into the exchange',
          'perfectly engaged'
        ]
      }
    }
  };

  var REGISTER_NAMES = ['direct', 'vivid', 'physiological', 'social'];

  // ── Trait extraction ───────────────────────────────────────────────────────

  /* traitsFromSeed(seed) → { valence, arousal, stability, sociability, drive }
   * Draws exactly 5 values from mulberry32(seed) in fixed protocol order. */
  function traitsFromSeed(seed) {
    seed = seed >>> 0; // coerce to unsigned 32-bit
    var rng = mulberry32(seed);
    return {
      valence:     rng(),
      arousal:     rng(),
      stability:   rng(),
      sociability: rng(),
      drive:       rng()
    };
  }

  // ── Coupling generation ────────────────────────────────────────────────────

  /* generateCoupling(traits, lambda) → schema.coupling object
   * Always stable: the only feedback cycle (mood↔energy) is capped so
   * k_energy_mood × k_mood_energy < λ² at all trait values. */
  function generateCoupling(t, lambda) {
    var k_em = round3(lerp(0.10, 0.30, (t.arousal + t.stability) / 2));
    var k_ec = round3(lerp(0.08, 0.25, (t.arousal + t.drive) / 2));
    var k_ef = round3(lerp(0.06, 0.20, (t.arousal + t.drive) / 2));

    var coupling = { energy: { mood: k_em, curiosity: k_ec, focus: k_ef } };

    // affection → mood: sociable characters couple social warmth to hedonic state
    if (t.sociability > 0.5) {
      var k_am = round3(lerp(0, 0.20, (t.sociability - 0.5) * 2));
      if (k_am > 0) coupling.affection = { mood: k_am };
    }

    // curiosity → focus: driven characters benefit from interest
    if (t.drive > 0.5) {
      var k_cf = round3(lerp(0, 0.18, (t.drive - 0.5) * 2));
      if (k_cf > 0) coupling.curiosity = { focus: k_cf };
    }

    // mood → energy: stable characters have positive self-sustaining loops
    // CAPPED: k_mood_energy × k_energy_mood must be < λ² for stability
    if (t.stability > 0.6) {
      var maxSafe = round3(Math.min(0.04, (lambda * lambda / k_em) * 0.90));
      var k_me = round3(lerp(0, maxSafe, (t.stability - 0.6) / 0.4));
      if (k_me > 0) coupling.mood = { energy: k_me };
    }

    return coupling;
  }

  // ── Main generator ─────────────────────────────────────────────────────────

  /* generatePersona(seed, baseSchema?) → complete schema object.
   * If baseSchema is provided, preserves: name, variables, step_minutes,
   * events (custom), compiler.memory_injection.
   * Overwrites: baselines, homeostasis_rate, coupling, circadian, noise,
   *             event_sensitivity, triggers, growth, compiler.bands, persona. */
  function generatePersona(seed, base) {
    seed = seed >>> 0;
    var t = traitsFromSeed(seed);
    var rng = mulberry32(seed); // re-create same stream; first 5 values = traits (discarded via re-draw)
    // Advance past the 5 trait draws to reach the voice pick draw
    rng(); rng(); rng(); rng(); rng();
    var voiceIdx = Math.floor(rng() * 4);
    var voiceName = REGISTER_NAMES[voiceIdx];
    var voiceRegister = VOICE_REGISTERS[voiceName];

    var variables = (base && base.variables) || ['mood','energy','curiosity','affection','focus'];

    // Baselines — all clamped to sensible ranges
    var baselines = {};
    baselines.mood      = round2(lerp(0.35, 0.80, t.valence));
    baselines.energy    = round2(lerp(0.35, 0.85, t.arousal));
    baselines.affection = round2(lerp(0.25, 0.80, (t.valence + t.sociability) / 2));
    baselines.focus     = round2(lerp(0.35, 0.80, t.drive));
    baselines.curiosity = round2(lerp(0.40, 0.85, (t.drive + t.valence) / 2));
    // Custom variables (non-standard): default to 0.5
    variables.forEach(function(v) { if (baselines[v] == null) baselines[v] = 0.5; });

    // Core dynamics
    var lambda = round3(lerp(0.03, 0.18, t.stability));

    // Noise — volatile characters drift more, hold moods longer
    var noise = {
      magnitude:       round3(lerp(0.008, 0.045, 1 - t.stability)),
      autocorrelation: round3(lerp(0.40, 0.88, 1 - t.stability))
    };

    // Circadian — peaks bounded to real-world hours, never overlap
    var morningHour   = Math.round(lerp(6, 10, t.arousal));
    var afternoonHour = Math.round(lerp(13, 16, t.sociability));
    var circadian = {
      peaks:      [padHour(morningHour), padHour(afternoonHour)],
      floor:      round2(lerp(0.05, 0.40, t.arousal)),
      applies_to: ['energy']
    };

    // Coupling — stable by construction
    var coupling = generateCoupling(t, lambda);

    // Event sensitivity — how hard each event type hits this NPC
    var event_sensitivity = {
      delight:      round2(lerp(0.60, 1.50, t.valence)),
      reunion:      round2(lerp(0.50, 1.80, t.sociability)),
      fatigue:      round2(lerp(0.70, 1.40, 1 - t.arousal)),
      confusion:    round2(lerp(0.60, 1.40, 1 - t.stability)),
      long_absence: round2(lerp(0.50, 1.60, t.sociability))
    };

    // Triggers — thresholds vary per-persona, bounded by real-world constraints
    var absenceDays = Math.round(lerp(0.5, 4.0, 1 - t.sociability) * 10) / 10;
    var energyThreshold = round2(lerp(0.15, 0.30, 1 - t.arousal));
    var fatigueCooldown = Math.round(lerp(30, 120, t.stability));
    var triggers = [
      { condition: 'elapsed_days > ' + absenceDays, fire: 'long_absence', cooldown_steps: 1440 },
      { condition: 'energy < ' + energyThreshold, fire: 'fatigue', cooldown_steps: fatigueCooldown }
    ];

    // Growth rules — thresholds and shifts vary per-persona
    var delightThreshold  = Math.round(lerp(25, 150, 1 - t.valence));
    var reunionThreshold  = Math.round(lerp(10, 60, 1 - t.sociability));
    var fatigueThreshold  = Math.round(lerp(15, 80, t.arousal));
    var growth = {
      rules: [
        {
          trigger: 'delight_count > ' + delightThreshold,
          shifts: {
            mood:      round3(lerp(0.010, 0.040, t.valence)),
            affection: round3(lerp(0.005, 0.020, t.sociability))
          }
        },
        {
          trigger: 'reunion_count > ' + reunionThreshold,
          shifts: { affection: round3(lerp(0.010, 0.050, t.sociability)) }
        },
        {
          trigger: 'fatigue_count > ' + fatigueThreshold,
          shifts: { energy: round3(lerp(-0.010, -0.040, 1 - t.arousal)) }
        }
      ]
    };

    // Compiler — voice register + memory injection from base if set
    var memInject = !(base && base.compiler && base.compiler.memory_injection === false);
    var compiler = {
      bands: voiceRegister,
      memory_injection: memInject
    };

    // Persona metadata — read-only, engine ignores this field
    var persona = { seed: seed, traits: t, voice: voiceName };

    // Merge with base schema: preserve user-controlled fields
    var schema = {
      name:              (base && base.name)         || undefined,
      variables:         variables,
      baselines:         baselines,
      homeostasis_rate:  lambda,
      coupling:          coupling,
      circadian:         circadian,
      noise:             noise,
      events:            (base && base.events)       || undefined,
      event_sensitivity: event_sensitivity,
      triggers:          triggers,
      growth:            growth,
      compiler:          compiler,
      persona:           persona
    };
    if (base && base.step_minutes != null) schema.step_minutes = base.step_minutes;

    // Remove undefined keys to keep schema clean
    Object.keys(schema).forEach(function(k) { if (schema[k] === undefined) delete schema[k]; });

    return schema;
  }

  return { generatePersona: generatePersona, traitsFromSeed: traitsFromSeed };
});
