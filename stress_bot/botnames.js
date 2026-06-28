/**
 * Generador de nombres de bots compartido entre sim.js y stress-npc.js.
 * ~350 raíces × ~80 tags × ~40 prefijos ≈ 1.1 M combinaciones únicas.
 *
 * Compatible con Node (module.exports) y con browser (se omite el export).
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) module.exports = factory();
    else root.BotNames = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

const NAME_ROOTS = [
    // Animales
    'Drag','Shadow','Ghost','Phoenix','Wolf','Tiger','Lion','Falcon','Eagle','Hawk',
    'Raven','Bear','Snake','Cobra','Viper','Spider','Fox','Cat','Owl','Elk',
    'Bat','Crow','Swan','Lynx','Puma','Croc','Rhino','Shark','Panther','Jaguar',
    'Hyena','Dingo','Gecko','Mamba','Panda','Koala','Moose','Bison','Condor','Pelican',
    'Scorpion','Mantis','Hornet','Wasp','Beetle','Dragonfly','Firefly','Moth','Locust','Venom',
    // Fantasía / personajes
    'Demon','Angel','Reaper','Slayer','Hunter','Killer','Ninja','Samurai','Pirate','Viking',
    'Warrior','Knight','Sniper','Crusher','Smasher','Ripper','Blaster','Striker','Bomber','Soldier',
    'Captain','Major','General','King','Queen','Lord','Sir','Baron','Prince','Master',
    'Wizard','Mage','Sage','Saint','Sinner','Devil','Beast','Monster','Titan','Giant',
    'Hero','Legend','Myth','Rebel','Rogue','Outlaw','Bandit','Thug','Gangster','Mafia',
    'Paladin','Warlock','Druid','Ranger','Berserker','Templar','Crusader','Assassin','Rogue','Scout',
    'Oracle','Prophet','Seer','Sorcerer','Necromancer','Alchemist','Trickster','Brawler','Duelist','Gladiator',
    // Elementos / naturaleza
    'Frost','Fire','Storm','Thunder','Lightning','Blaze','Mist','Rain','Snow','Cloud',
    'Sky','Moon','Sun','Star','Galaxy','Nova','Comet','Meteor','Atom','Neon',
    'Lava','Quake','Tide','Wind','Drift','Gale','Hail','Dusk','Dawn','Void',
    'Abyss','Crater','Glacier','Ember','Ash','Cinder','Spark','Flare','Surge','Torrent',
    'Arctic','Tropic','Desert','Jungle','Tundra','Swamp','Ridge','Peak','Vale','Reef',
    // Tecnología / cyber
    'Pixel','Glitch','Crypto','Byte','Cyber','Hyper','Mega','Ultra','Super','Turbo',
    'Nitro','Rocket','Bullet','Arrow','Blade','Sword','Axe','Hammer','Spear','Shield',
    'Laser','Plasma','Quasar','Pulsar','Photon','Proton','Neutron','Electron','Ion','Flux',
    'Matrix','Vector','Tensor','Kernel','Stack','Queue','Cache','Buffer','Signal','Cipher',
    'Nanobot','Drone','Mech','Synth','Neural','Binary','Hex','Grid','Loop','Codec',
    // Colores / materiales
    'Diamond','Gold','Silver','Iron','Steel','Bronze','Obsidian','Onyx','Jade','Ivory',
    'Crimson','Scarlet','Azure','Indigo','Violet','Teal','Amber','Coral','Cyan','Magenta',
    'Ebony','Titanium','Platinum','Cobalt','Chrome','Carbon','Mithril','Orichalcum','Crystal','Quartz',
    // Acciones / intensidad
    'Crown','Skull','Bone','Blood','Fang','Claw','Wing','Eye','Heart','Soul',
    'Spirit','Echo','Pulse','Rush','Dash','Flash','Bolt','Burst','Force','Drive',
    'Push','Slam','Jump','Spin','Roll','Flip','Snap','Crack','Rip','Tear',
    'Grind','Carry','Stomp','Wreck','Shred','Pierce','Cleave','Smite','Maul','Pummel',
    // Cultura / internet
    'Gamer','Noob','Boss','Pro','Chief','Doc','Mr','Dr','Sage','Dude',
    'Sweat','Cringe','Vibe','Flex','Clout','Hype','Chad','Simp','Nerd','Geek',
    // Nombres españoles / latinos
    'Pablo','Mario','Lucas','Javi','Mateo','Diego','Hugo','Pepe','Tito','Manolo',
    'Carlos','David','Alex','Leo','Toni','Iker','Adri','Bruno','Marc','Ruben',
    'Ivan','Oscar','Victor','Simon','Tomas','Xavier','Fabian','Emilio','Felipe','Cristian',
    'Gonzalo','Hernan','Ignacio','Javier','Kevin','Lorenzo','Martin','Omar','Pedro','Juan',
    'Jose','Angel','Jesus','Miguel','Luis','Jorge','Antonio','Ricardo','Daniel','Francisco',
    'Roberto','Eduardo','Sergio','Nicolas','Santiago','Sebastian','Gabriel','Rodrigo','Manuel','Andres',
    'Lucia','Sofia','Laura','Elena','Maria','Claudia','Natalia','Beatriz','Carmen','Rosa',
    'Ana','Vera','Lena','Nina','Olga','Zara','Emma','Mia','Ava','Eva',
    // Nombres internacionales
    'Max','Rex','Ace','Kai','Jin','Zen','Rio','Rio','Axel','Liam',
    'Noah','Ethan','Mason','Logan','Elijah','Oliver','Lucas','Aiden','Caden','Jackson',
    'Yuki','Kenji','Hiro','Ryu','Kira','Sora','Nami','Taro','Akira','Zara',
    'Ivan','Nikita','Vlad','Boris','Sasha','Dima','Kolya','Vanya','Misha','Pasha',
    'Luca','Marco','Gio','Seb','Nico','Dani','Rafa','Xavi','Riki','Tito'
];

const NAME_TAGS = [
    '','','','','_',
    'XD','YT','TV','TTV','xD',
    '99','420','69','007','HD',
    'Pro','Lite','MAX','x','Z',
    'XX','OG','GG','TM','PvP',
    'FTW','AFK','EZ','WP','MVP',
    '_RU','_ES','_FR','_DE','_USA',
    '_MX','_AR','_BR','_IT','_JP',
    '_KR','_CN','_UK','_PT','_NL',
    '_PL','_TR','_VN','_ID','_PH',
    '_AU','_CA','_ZA','_IN','_NG',
    'gg','ok','lol','omg','wtf',
    'Gaming','Plays','Live','Real','Official'
];

const NAME_PREFS = [
    '','','','',
    'xX','x','iX','iM',
    'TheReal','El','La','Sr.','Sra.',
    'MX_','BR_','iam','its',
    'Lord','King','Queen','Lil','Big',
    'Mr','Ms','Capt','Sgt','Dr','Mc',
    'Dark','Red','Ice','God','Top',
    'Ultra','Mega','Neo','Zeta','Alpha'
];

function genBotName() {
    const r = NAME_ROOTS[Math.floor(Math.random() * NAME_ROOTS.length)];
    let n = r;
    if (Math.random() < 0.3) n = NAME_PREFS[Math.floor(Math.random() * NAME_PREFS.length)] + n;
    if (Math.random() < 0.55) n = n + NAME_TAGS[Math.floor(Math.random() * NAME_TAGS.length)];
    if (Math.random() < 0.4) n = n + (Math.floor(Math.random() * 999) + 1);
    if (n.startsWith('xX')) n = n + 'Xx';
    return n.slice(0, 16);
}

return { NAME_ROOTS, NAME_TAGS, NAME_PREFS, genBotName };

}));
