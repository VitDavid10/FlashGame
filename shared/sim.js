/*
 * PillSim — Simulación pura de Pill Wars (sin DOM, sin audio, sin render).
 * Se ejecuta igual en navegador (window.PillSim) y en Node (module.exports),
 * para que en multijugador el servidor sea la única autoridad de físicas.
 *
 * La presentación (sonidos, partículas de UI, textos, overlays) se comunica
 * mediante eventos: la sim los emite y el cliente los consume con drainEvents().
 */
(function (root, factory) {
    if (typeof module === 'object' && typeof module.exports === 'object') { module.exports = factory(); }
    else { root.PillSim = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // --- CONSTANTES DE JUEGO ---
    const WORLD_CONFIG = { arcade: { size: 3500 }, classic: { size: 7000 }, foodDensity: 40, virusDensity: 1 };
    const SKILL_PARAMS = { clonCost: 2000, clonCooldown: 1000, clonSpeed: 40, shootCost: 2500, shootBulletSpeed: 20, shootVirusSpeed: 20, shootDmgThreshold: 15000, sprintSpeedMult: 1.5, sprintDuration: 10000, magnetForce: 3, magnetRange: 200, magnetDuration: 8000, shieldDuration: 3000, bigMin: 5000, bigMax: 12000 };
    const VIRUS_RADIUS = 70, VIRUS_GAIN_LOW = 5000, VIRUS_GAIN_HIGH = 10000, VIRUS_GAIN_THRESHOLD = 100000;
    const BASE_MERGE_TIME = 15000, MERGE_MASS_FACTOR = 0.225, SPLIT_COOLDOWN_MS = 1000, GLOBAL_CD_MS = 1000;
    const AUTO_SPLIT_LEVEL_1 = 200000, AUTO_SPLIT_LEVEL_2 = 300000;
    const INITIAL_RADIUS = 10, MAX_CELLS = 16, VELOC_BASE = 1.4, SPLIT_FORCE = 65, PILL_RATIO = 2.0;
    const COLORS = ['#F44336', '#9C27B0', '#3F51B5', '#03A9F4', '#009688', '#8BC34A', '#FFC107', '#FF5722'];
    // Generador de nombres realistas: ~350 raíces × ~80 tags × ~40 prefijos ≈ 1.1M combinaciones
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
        'Paladin','Warlock','Druid','Ranger','Berserker','Templar','Crusader','Assassin','Scout','Gladiator',
        'Oracle','Sorcerer','Necromancer','Alchemist','Trickster','Brawler','Duelist','Prophet','Seer','Archon',
        // Elementos / naturaleza
        'Frost','Fire','Storm','Thunder','Lightning','Blaze','Mist','Rain','Snow','Cloud',
        'Sky','Moon','Sun','Star','Galaxy','Nova','Comet','Meteor','Atom','Neon',
        'Lava','Quake','Tide','Wind','Drift','Gale','Hail','Dusk','Dawn','Void',
        'Abyss','Crater','Glacier','Ember','Ash','Cinder','Spark','Flare','Surge','Torrent',
        'Arctic','Tropic','Desert','Jungle','Tundra','Swamp','Ridge','Peak','Vale','Reef',
        // Tecnología / cyber
        'Pixel','Glitch','Crypto','Byte','Cyber','Hyper','Mega','Ultra','Super','Turbo',
        'Nitro','Rocket','Bullet','Arrow','Blade','Sword','Axe','Hammer','Spear','Shield',
        'Laser','Plasma','Quasar','Pulsar','Photon','Proton','Electron','Ion','Flux','Matrix',
        'Vector','Kernel','Stack','Cache','Signal','Cipher','Nanobot','Drone','Mech','Synth',
        'Neural','Binary','Hex','Grid','Loop','Codec','Tensor','Buffer','Queue','Shader',
        // Colores / materiales
        'Diamond','Gold','Silver','Iron','Steel','Bronze','Obsidian','Onyx','Jade','Ivory',
        'Crimson','Scarlet','Azure','Indigo','Violet','Teal','Amber','Coral','Cyan','Magenta',
        'Ebony','Titanium','Platinum','Cobalt','Chrome','Carbon','Crystal','Quartz','Opal','Garnet',
        // Acciones / intensidad
        'Crown','Skull','Bone','Blood','Fang','Claw','Wing','Eye','Heart','Soul',
        'Spirit','Echo','Pulse','Rush','Dash','Flash','Bolt','Burst','Force','Drive',
        'Push','Slam','Jump','Spin','Roll','Flip','Snap','Crack','Rip','Tear',
        'Grind','Stomp','Wreck','Shred','Pierce','Cleave','Smite','Maul','Pummel','Ravage',
        // Internet / cultura gamer
        'Gamer','Noob','Boss','Pro','Chief','Doc','Dude','Sweat','Vibe','Flex',
        'Clout','Hype','Chad','Nerd','Geek','Cringe','Frag','Loot','Grinder','Carry',
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
        'Max','Rex','Ace','Kai','Jin','Zen','Axel','Liam','Noah','Ethan',
        'Mason','Logan','Oliver','Aiden','Caden','Jackson','Yuki','Kenji','Hiro','Ryu',
        'Kira','Sora','Nami','Taro','Akira','Nikita','Vlad','Boris','Sasha','Dima',
        'Luca','Marco','Gio','Rafa','Xavi','Riki','Kai','Remy','Enzo','Dario'
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
        // ~30% lleva prefijo
        if (Math.random() < 0.3) n = NAME_PREFS[Math.floor(Math.random() * NAME_PREFS.length)] + n;
        // ~55% lleva sufijo/etiqueta
        if (Math.random() < 0.55) n = n + NAME_TAGS[Math.floor(Math.random() * NAME_TAGS.length)];
        // ~40% lleva número al final
        if (Math.random() < 0.4) n = n + (Math.floor(Math.random() * 999) + 1);
        // cerrar con xX si va prefijado xX
        if (n.startsWith('xX')) n = n + 'Xx';
        return n.slice(0, 16);
    }
    // BOT_NAMES = los 10 nombres simples originales (se usan en offline para que se note "modo casual")
    const BOT_NAMES = ["ETH", "USA", "Doge", "NASA", "Icefox", "Bandit", "Mars", "BTC", "PUMP", "Noob"];
    const SKILL_DEFS = {
        1: { id: 1, name: 'CLON', uses: 4, maxActive: SKILL_PARAMS.clonCooldown },
        2: { id: 2, name: 'SHOOT', uses: 4, maxActive: 15 },
        3: { id: 3, name: 'SPRINT', uses: 1, maxActive: SKILL_PARAMS.sprintDuration },
        4: { id: 4, name: 'TELEPORT', uses: 1, maxActive: 20 },
        5: { id: 5, name: 'MAGNET', uses: 1, maxActive: SKILL_PARAMS.magnetDuration },
        6: { id: 6, name: 'SHIELD', uses: 1, maxActive: SKILL_PARAMS.shieldDuration },
        7: { id: 7, name: 'PLUS', uses: 1, maxActive: 20 },
        8: { id: 8, name: 'GAMBLE', uses: 1, maxActive: 20 }
    };

    // --- HELPERS PUROS ---
    const uuid = () => Math.random().toString(36).substr(2, 9);
    // Id numérico único por entidad (celdas, virus, eyectados, proyectiles):
    // permite emparejar entidades entre snapshots para interpolar en red.
    let SEQ = 1;
    const nextSeq = () => SEQ++;
    const getEllipticalDist = (c1, c2) => { let dx = c1.x - c2.x, dy = c1.y - c2.y, k = 0.7071; let rx = dx * k - dy * k, ry = (dx * k + dy * k) / PILL_RATIO; return Math.sqrt(rx * rx + ry * ry); };
    const getRandomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

    class ObjectPool {
        constructor(createFn) { this.createFn = createFn; this.pool = []; }
        get() { return this.pool.length > 0 ? this.pool.pop() : this.createFn(); }
        free(obj) { this.pool.push(obj); }
    }
    const createFood = () => ({ x: 0, y: 0, r: 0, c1: '#fff', c2: '#fff', angle: 0, spikes: [], eaten: false });
    const createVirus = () => ({ x: 0, y: 0, r: 0, vx: 0, vy: 0, hits: 0, damaged: false, animTime: 0, spots: [] });

    class SpatialGrid {
        constructor(cellSize) { this.cellSize = cellSize; this.buckets = new Map(); }
        clear() { this.buckets.clear(); }
        // Clave entera: evita template strings (150ns/llamada → ~1ns).
        // Rango seguro para |cx|,|cy| < 256 (cubre mapSize hasta ~38400 con cellSize=150).
        insert(obj) {
            const cs = this.cellSize;
            const k = (Math.floor(obj.x / cs) + 256) * 512 + (Math.floor(obj.y / cs) + 256);
            let b = this.buckets.get(k);
            if (!b) { b = []; this.buckets.set(k, b); }
            b.push(obj);
        }
        // radius opcional en unidades de mundo. Sin radius, busca 3x3 celdas.
        // Con radius, cubre ceil(radius/cellSize) celdas en cada dirección.
        query(x, y, radius) {
            const cs = this.cellSize;
            const cx = Math.floor(x / cs), cy = Math.floor(y / cs);
            const r = radius ? Math.ceil(radius / cs) : 1;
            const results = [];
            for (let i = -r; i <= r; i++) {
                for (let j = -r; j <= r; j++) {
                    const b = this.buckets.get((cx + i + 256) * 512 + (cy + j + 256));
                    if (b) for (const o of b) results.push(o);
                }
            }
            return results;
        }
    }

    // --- CÉLULA (jugador o bot) ---
    // No conoce mouse/cámara/teclado: el input del jugador llega como {tx, ty}
    // en coordenadas de mundo. bornTime y cooldowns usan el reloj de la sim.
    class Cell {
        constructor(x, y, r, cBot, cTop, name, isBot = false, skinUrl = null, id = null, bornTime = 0) {
            this.x = x; this.y = y; this.r = r; this.colorBot = cBot; this.colorTop = cTop;
            this.name = name; this.isBot = isBot; this.id = id || uuid();
            this.ci = nextSeq();
            this.skinUrl = (skinUrl && skinUrl.length > 5) ? skinUrl : null;
            this.particles = []; this.vx = 0; this.vy = 0; this.boostX = 0; this.boostY = 0;
            this.bornTime = bornTime; this.changeDirTimer = 0; this.targetX = x; this.targetY = y;
            this.immuneTime = 0; this.groupMaxR = r; this.flashTime = 0; this.flashColor = null;
            this.lastSplitTime = 0;
            this.tpPhase = 0; this.tpTimer = 0; this.tpDest = { x: 0, y: 0 };
            this.magnetTime = 0; this.sprintTime = 0;
            if (this.isBot) { this.botSkills = []; this.botGcd = 0; this.botNextSkillTime = 0; this.massMilestoneMet = false; this.shouldSplit = false; }
        }
        get mass() { return Math.PI * this.r * (this.r * PILL_RATIO); }
        mergeTime() { return BASE_MERGE_TIME + (this.mass * MERGE_MASS_FACTOR); }
        canMerge(now) { return (now - this.bornTime) > this.mergeTime(); }

        update(sim, delta, input) {
            const timeScale = sim.timeScale;
            if (this.tpPhase > 0) {
                this.tpTimer -= delta;
                if (this.tpPhase === 1) { if (this.tpTimer <= 0) { this.x = this.tpDest.x; this.y = this.tpDest.y; this.targetX = this.x; this.targetY = this.y; this.tpPhase = 2; this.tpTimer = 500; this.immuneTime = 500; } }
                else if (this.tpPhase === 2) { if (this.tpTimer <= 0) { this.tpPhase = 0; } }
                this.vx = 0; this.vy = 0; this.boostX = 0; this.boostY = 0; return;
            }
            if (this.immuneTime > 0) { this.immuneTime -= delta; if (this.immuneTime < 0) this.immuneTime = 0; }
            if (this.flashTime > 0) { this.flashTime -= delta; if (this.flashTime < 0) this.flashTime = 0; }
            if (this.magnetTime > 0) { this.magnetTime -= delta; if (this.magnetTime < 0) this.magnetTime = 0; }
            if (this.sprintTime > 0) { this.sprintTime -= delta; if (this.sprintTime < 0) this.sprintTime = 0; }

            for (let i = this.particles.length - 1; i >= 0; i--) { let p = this.particles[i]; p.life -= 0.05 * timeScale; p.y += p.vy * timeScale; p.x += p.vx * timeScale; if (p.life <= 0) this.particles.splice(i, 1); }
            let effectiveR = Math.max(this.groupMaxR, this.r, 20);
            let baseSpeed = VELOC_BASE * (sim.config.worldSettings.speed || 1);
            let speedMult = baseSpeed * 10.0 * Math.pow(effectiveR, -0.46);
            let isSprinting = this.sprintTime > 0;
            if (isSprinting) speedMult *= SKILL_PARAMS.sprintSpeedMult;

            if (isSprinting && Math.random() < 0.2) this.spawnParticles(sim, 'BOLT');
            if (speedMult < 0.2) speedMult = 0.2;
            if (Math.abs(this.boostX) > 0.1 || Math.abs(this.boostY) > 0.1) { this.boostX *= Math.pow(0.9, timeScale); this.boostY *= Math.pow(0.9, timeScale); } else { this.boostX = 0; this.boostY = 0; }
            let dx = 0, dy = 0;
            if (this.isBot) { this.botAI(sim, delta); dx = this.targetX - this.x; dy = this.targetY - this.y; }
            else if (input && typeof input.tx === 'number') { dx = input.tx - this.x; dy = input.ty - this.y; }

            // Si está a menos de 5px del objetivo se para; cerca del objetivo frena
            // gradualmente para "aparcar" sin vibrar.
            let dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 5) {
                this.vx = (dx / dist) * speedMult;
                this.vy = (dy / dist) * speedMult;
                if (dist < 40) {
                    let brake = dist / 40;
                    this.vx *= brake;
                    this.vy *= brake;
                }
            } else {
                this.vx = 0;
                this.vy = 0;
            }

            let maxAllowed = speedMult * 1.2, currentSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy); if (currentSpeed > maxAllowed) { let ratio = maxAllowed / currentSpeed; this.vx *= ratio; this.vy *= ratio; }
            this.x += (this.vx + this.boostX) * timeScale; this.y += (this.vy + this.boostY) * timeScale;
            // Solo el CENTRO queda dentro del mapa: el cuerpo puede asomar por el borde,
            // así las píldoras grandes llegan a las esquinas y nadie puede esconderse ahí.
            let limit = sim.mapSize; this.x = Math.max(Math.min(this.x, limit), -limit); this.y = Math.max(Math.min(this.y, limit), -limit);
        }

        spawnParticles(sim, type) {
            if (!sim.config.fx.enabled) return;
            if (this.isBot && !sim.config.fx.enemyFX) return;
            let count = (type === 'BOLT') ? 1 : (Math.floor(Math.random() * 3) + 4); let scale = (type === 'BOLT') ? Math.max(1, this.r / 15) : 1;
            for (let i = 0; i < count; i++) {
                let angle = Math.random() * Math.PI * 2; let offset = this.r * Math.random(); let vy = (type === 'PLUS') ? -(Math.random() * 2 + 1) : (Math.random() * 2 + 1);
                if (type === 'BOLT') { this.particles.push({ x: Math.cos(angle) * this.r, y: Math.sin(angle) * this.r, vx: Math.cos(angle) * 3, vy: Math.sin(angle) * 3, life: 0.8, type: type, rot: Math.random() * 360, scale: scale }); }
                else { this.particles.push({ x: Math.cos(angle) * offset, y: Math.sin(angle) * offset, vx: (Math.random() - 0.5) * 2, vy: vy, life: 1.0, type: type, rot: Math.random() * 360, scale: 1 }); }
            }
        }

        botAI(sim, delta) {
            if (this.botGcd > 0) this.botGcd -= delta;
            let siblings = sim.enemies.filter(e => e.id === this.id).sort((a, b) => b.mass - a.mass);
            let leader = siblings[0];
            if (this !== leader) { this.targetX = leader.targetX; this.targetY = leader.targetY; return; }

            if (sim.config.mode === 'skills') {
                if (sim.now > this.botNextSkillTime) { let nextTime = sim.now + 3000; siblings.forEach(s => s.botNextSkillTime = nextTime); sim.grantBotSkill(this); }
            } else if (sim.config.mode === 'arcade') {
                if (!this.massMilestoneMet && this.mass >= 3500) { let nextTime = sim.now + 30000; siblings.forEach(s => { s.massMilestoneMet = true; s.botNextSkillTime = nextTime; }); sim.grantBotSkill(this); }
                if (this.massMilestoneMet && sim.now > this.botNextSkillTime) { let nextTime = sim.now + 30000; siblings.forEach(s => s.botNextSkillTime = nextTime); sim.grantBotSkill(this); }
            }

            if (this.botSkills.length > 0 && this.botGcd <= 0) {
                let priorityIdx = this.botSkills.findIndex(id => id === 7 || id === 8); let skillToUse = -1;
                if (priorityIdx !== -1) { skillToUse = this.botSkills[priorityIdx]; }
                else { let chance = (sim.config.mode === 'skills') ? 0.1 : 0.02; if (this.botSkills.includes(3) && Math.random() < 0.05) skillToUse = 3; else if (Math.random() < chance) skillToUse = this.botSkills[0]; }
                if (skillToUse !== -1) { this.executeBotSkill(sim, skillToUse); siblings.forEach(s => { let idx = s.botSkills.indexOf(skillToUse); if (idx !== -1) s.botSkills.splice(idx, 1); s.botGcd = 1000; }); }
            }

            this.changeDirTimer--; if (Math.abs(this.x) > sim.mapSize - 200 || Math.abs(this.y) > sim.mapSize - 200) { this.targetX = 0; this.targetY = 0; return; }
            let flee = false, visionRange = 750, targetPrey = null;

            // Antes: `[...sim.enemies, ...sim.allPlayerCells()]` por cada bot líder cada tick.
            // Ahora iteramos en sitio los dos contenedores sin crear el array intermedio.
            const checkEntity = (e) => {
                if (e.id === this.id) return;
                let d = getEllipticalDist(this, e);
                if (e.mass > this.mass * 1.25 && d < visionRange + this.r) { this.targetX = this.x - (e.x - this.x); this.targetY = this.y - (e.y - this.y); flee = true; }
                else if (this.mass > e.mass * 1.25 && d < visionRange) { if (!targetPrey || d < targetPrey.dist) { targetPrey = { cell: e, dist: d }; } }
            };
            for (const e of sim.enemies) checkEntity(e);
            for (const p of sim.players.values()) { for (const c of p.cells) checkEntity(c); }

            if (!flee && targetPrey) { let isHiding = sim.isHiddenInVirus(targetPrey.cell); if (!isHiding) { this.targetX = targetPrey.cell.x; this.targetY = targetPrey.cell.y; flee = true; } }
            if (!flee) sim.viruses.forEach(v => { if (this.r > v.r && getEllipticalDist(this, v) < this.r + 120) flee = true; });

            if (targetPrey && this.r > 45) {
                let mySplitMass = (this.mass / 2); let preyMass = targetPrey.cell.mass; let boostRange = 400 + this.r; let attackRange = boostRange * 0.66;
                if (mySplitMass > preyMass * 1.5 && targetPrey.dist < attackRange && (sim.now - this.lastSplitTime > 8000)) {
                    let currentCount = siblings.length;
                    siblings.forEach(s => {
                        if (currentCount >= sim.config.maxBotCells) return;
                        if ((s.mass / 2) > preyMass * 1.5) { sim.performSplit(s, Math.atan2(targetPrey.cell.y - s.y, targetPrey.cell.x - s.x)); s.lastSplitTime = sim.now; currentCount++; }
                    });
                }
            }
            if (flee) return; if (this.changeDirTimer <= 0) { this.targetX = Math.random() * (sim.mapSize * 1.8) - sim.mapSize * 0.9; this.targetY = Math.random() * (sim.mapSize * 1.8) - sim.mapSize * 0.9; this.changeDirTimer = Math.random() * 80 + 40; }
        }

        executeBotSkill(sim, id) {
            let siblings = sim.enemies.filter(e => e.id === this.id); let leader = this;
            const showText = (txt, col) => { sim.emit({ type: 'botText', x: leader.x, y: leader.y, text: txt, color: col }); };

            if (id === 3) { siblings.forEach(s => { s.sprintTime = SKILL_PARAMS.sprintDuration; s.boostX += s.vx * 2; s.boostY += s.vy * 2; s.spawnParticles(sim, 'BOLT'); }); }
            else if (id === 4) { let limit = sim.mapSize - 300; let centerX = Math.random() * (limit * 2) - limit; let centerY = Math.random() * (limit * 2) - limit; siblings.forEach(s => { s.tpPhase = 1; s.tpTimer = 500; s.tpDest = { x: centerX + (Math.random() * 100 - 50), y: centerY + (Math.random() * 100 - 50) }; }); }
            else if (id === 5) { siblings.forEach(s => s.magnetTime = SKILL_PARAMS.magnetDuration); showText("MAGNET", "#A020F0"); }
            else if (id === 6) { siblings.forEach(s => s.immuneTime = SKILL_PARAMS.shieldDuration); showText("SHIELD", "#FFD700"); }
            else if (id === 7) { let totalGain = Math.floor(Math.random() * (SKILL_PARAMS.bigMax - SKILL_PARAMS.bigMin + 1)) + SKILL_PARAMS.bigMin; let gainPerCell = totalGain / siblings.length; siblings.forEach(s => { s.r = Math.sqrt((s.mass + gainPerCell) / (Math.PI * PILL_RATIO)); s.flashColor = '#00ff00'; s.flashTime = 1000; s.spawnParticles(sim, 'PLUS'); }); showText("MASS UP", "#00FF00"); }
            else if (id === 8) { let totalVal = (Math.random() < 0.5) ? -5000 : 15000; let valPerCell = totalVal / siblings.length; siblings.forEach(s => { let newMass = s.mass + valPerCell; if (newMass < 314) newMass = 314; s.r = Math.sqrt(newMass / (Math.PI * PILL_RATIO)); s.flashColor = (totalVal >= 0) ? '#00ff00' : '#ff0000'; s.flashTime = 1000; s.spawnParticles(sim, totalVal >= 0 ? 'PLUS' : 'MINUS'); }); showText(totalVal >= 0 ? "JACKPOT!" : "FAIL!", totalVal >= 0 ? "#00FF00" : "#FF0000"); }
        }
    }

    // --- SIMULACIÓN (una instancia = una sala) ---
    class Simulation {
        constructor(config) {
            this.config = Object.assign({
                mode: 'classic',                                   // 'classic' | 'arcade' | 'skills'
                mapSize: WORLD_CONFIG.classic.size,
                worldSettings: { map: 1, food: 1, virus: 1, speed: 1 },
                botConfig: { enabled: true, count: 25, respawn: true },
                maxBotCells: 16,
                fx: { enabled: true, enemyFX: true },              // el servidor pondrá enabled:false
                emitFoodEvents: false                              // el servidor lo activa para publicar diffs de comida
            }, config);
            this.mapSize = this.config.mapSize;
            this.now = 0;
            this.timeScale = 1.0;
            this.foods = []; this.viruses = []; this.enemies = [];
            this.ejectedMasses = []; this.projectiles = [];
            this.players = new Map();
            this.events = [];
            this.botRespawnQueue = [];
            this.foodPool = new ObjectPool(createFood);
            this.virusPool = new ObjectPool(createVirus);
            this.foodGrid = new SpatialGrid(150);
        }

        emit(ev) { this.events.push(ev); }
        drainEvents() { const evs = this.events; this.events = []; return evs; }

        allPlayerCells() { const out = []; for (const p of this.players.values()) { for (const c of p.cells) out.push(c); } return out; }
        // Push manual en vez de spread: con 200+ celdas el [...a, ...b] crea basura
        // proporcional al total, y livingCells() se llama 2 veces por step + dentro de cada bot líder.
        livingCells() {
            const out = this.allPlayerCells();
            for (const e of this.enemies) out.push(e);
            return out;
        }
        ownerCellsOf(cell) { if (cell.isBot) return this.enemies; const p = this.players.get(cell.id); return p ? p.cells : []; }

        addPlayer(id, opts = {}) {
            const skillState = {}; for (let i = 1; i <= 8; i++) skillState[i] = 0;
            const p = {
                id, name: opts.name || "", colorBot: opts.colorBot || getRandomColor(), colorTop: opts.colorTop || getRandomColor(),
                skinUrl: opts.skinUrl || null, godMode: !!opts.godMode,
                cells: [], skillSlots: [null, null, null, null], skillState, globalCD: 0,
                killStreak: 0, splitMilestones: { level1: false, level2: false },
                lastSplitTime: -Infinity, alive: false, input: null, actions: []
            };
            this.players.set(id, p);
            return p;
        }
        removePlayer(id) { this.players.delete(id); }

        spawnPlayer(id, initialImmuneMs) {
            const p = this.players.get(id);
            const pos = this.getSafePos(this.mapSize);
            const cell = new Cell(pos.x, pos.y, INITIAL_RADIUS, p.colorBot, p.colorTop, p.name, false, p.skinUrl, id, this.now);
            if (initialImmuneMs > 0) cell.immuneTime = initialImmuneMs;
            p.cells = [cell];
            p.alive = true;
            p.splitMilestones = { level1: false, level2: false };
            p.lastSplitTime = -Infinity;
            for (let i = 1; i <= 8; i++) p.skillState[i] = 0;
            return p.cells[0];
        }

        setInput(id, input) { const p = this.players.get(id); if (p) p.input = input; }
        queueAction(id, action) { const p = this.players.get(id); if (p) p.actions.push(action); }

        // Genera comida/virus/bots iniciales. Igual que generateWorldData() original:
        // el área de spawn inicial usa mapSize * multiplicador de mapa.
        populate() {
            const ws = this.config.worldSettings;
            let currentMapSize = this.mapSize * (ws.map || 1);
            let areaMillions = Math.pow(currentMapSize * 2, 2) / 1000000;
            let foodCount = Math.floor(areaMillions * WORLD_CONFIG.foodDensity);
            let virusCount = Math.floor(areaMillions * WORLD_CONFIG.virusDensity * (ws.virus || 1));
            for (let i = 0; i < foodCount; i++) this.spawnFoodSafe(this.foods, currentMapSize);
            for (let i = 0; i < virusCount; i++) this.spawnVirusSafe(this.viruses, currentMapSize);
            if (this.config.botConfig.enabled) { for (let i = 0; i < this.config.botConfig.count; i++) this.spawnBot(currentMapSize); }
        }

        spawnFoodSafe(foodArray, limit) {
            let food = this.foodPool.get();
            food.x = Math.random() * limit * 2 - limit;
            food.y = Math.random() * limit * 2 - limit;
            food.r = Math.random() * 4 + 5;
            food.c1 = COLORS[Math.floor(Math.random() * COLORS.length)];
            food.c2 = COLORS[Math.floor(Math.random() * COLORS.length)];
            food.angle = Math.random() * Math.PI;
            food.eaten = false;
            food.spikes = [];
            for (let j = 0; j < 4; j++) food.spikes.push(Math.random() * Math.PI * 2);
            foodArray.push(food);
        }

        spawnVirusSafe(virusArray, limit) {
            let attempts = 0, x, y, valid; do { x = Math.random() * limit * 2 - limit; y = Math.random() * limit * 2 - limit; valid = true; for (let other of virusArray) { if (Math.hypot(x - other.x, y - other.y) < 350) { valid = false; break; } } attempts++; } while (!valid && attempts < 30);
            let spots = []; for (let k = 0; k < 2; k++) { let angle = Math.random() * Math.PI * 2; let dist = Math.random() * (VIRUS_RADIUS * 0.5); spots.push({ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, r: Math.random() * 8 + 4 }); }
            let v = this.virusPool.get();
            v.ci = nextSeq();
            v.x = x; v.y = y; v.r = VIRUS_RADIUS; v.vx = 0; v.vy = 0; v.hits = 0; v.damaged = false; v.animTime = 0; v.spots = spots;
            virusArray.push(v);
        }

        spawnFood() { this.spawnFoodSafe(this.foods, this.mapSize); }
        spawnVirus() { this.spawnVirusSafe(this.viruses, this.mapSize); }
        spawnBot(limit) {
            if (!this.config.botConfig.enabled) return;
            let p = this.getSafePos(limit || this.mapSize);
            // Online (servidor): nombres realistas tipo "xDarkz", "Pablo23..." para parecer jugadores reales.
            // Offline (navegador): nombres simples originales del juego ("ETH", "Doge", "NASA"...).
            let name = this.config.realisticBotNames ? genBotName() : BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
            this.enemies.push(new Cell(p.x, p.y, Math.random() * 5 + 14, getRandomColor(), getRandomColor(), name, true, null, null, this.now));
        }

        getSafePos(limit) {
            let attempts = 0;
            const allEntities = this.livingCells();
            while (attempts < 100) {
                let x = Math.random() * limit * 0.9 - limit * 0.45; let y = Math.random() * limit * 0.9 - limit * 0.45; let isSafe = true;
                for (let e of allEntities) { if (e.mass === 0) continue; let dist = Math.hypot(x - e.x, y - e.y); if (dist < 600 + (e.r * 4)) { isSafe = false; break; } }
                if (isSafe) return { x: x, y: y };
                attempts++;
            }
            return { x: Math.random() * limit * 0.8 - limit * 0.4, y: Math.random() * limit * 0.8 - limit * 0.4 };
        }

        grantBotSkill(bot) {
            let siblings = this.enemies.filter(e => e.id === bot.id);
            let pool = [3, 4, 5, 6, 7, 7, 8, 8];
            let skillId = pool[Math.floor(Math.random() * pool.length)];
            siblings.forEach(s => { s.botSkills.push(skillId); });
        }

        botEmitProjectile(bot, type, cost) {
            if (bot.mass - cost < 314) return;
            bot.r = Math.sqrt((bot.mass - cost) / (Math.PI * PILL_RATIO));
            let angle = Math.atan2(bot.vy, bot.vx); if (Math.abs(bot.vx) < 0.1 && Math.abs(bot.vy) < 0.1) angle = Math.random() * Math.PI * 2;
            let spawnDist = bot.r * 1.5 + 25, spd = (type === 'shoot') ? 20 : 40, r = (type === 'shoot') ? 12 : 16;
            let obj = { ci: nextSeq(), x: bot.x + Math.cos(angle) * spawnDist, y: bot.y + Math.sin(angle) * spawnDist, vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd, r: r, angle: Math.random() * Math.PI, type: type, c1: bot.colorBot, c2: bot.colorTop };
            if (type === 'shoot') { obj.c1 = '#ff2a2a'; obj.c2 = '#fff'; }
            this.ejectedMasses.push(obj);
            this.emit({ type: 'shootSound', isBot: true, x: bot.x, y: bot.y });
        }

        // Dispara masa desde la celda del jugador más cercana al objetivo (tx, ty).
        emitProjectile(p, type, cost, tx, ty) {
            let best = null, minD = Infinity;
            p.cells.forEach(c => { if (c.mass - cost > 314) { let d = Math.hypot(c.x - tx, c.y - ty); if (d < minD) { minD = d; best = c; } } });
            if (best) {
                let c = best; c.r = Math.sqrt((c.mass - cost) / (Math.PI * PILL_RATIO));
                let a = Math.atan2(ty - c.y, tx - c.x); let relAngle = a - (-Math.PI / 4); let edgeDist = (c.r * (c.r * PILL_RATIO)) / Math.sqrt(Math.pow((c.r * PILL_RATIO) * Math.cos(relAngle), 2) + Math.pow(c.r * Math.sin(relAngle), 2));
                let spawnDist = edgeDist + 25; let spd = (type === 'shoot') ? 20 : 40; let r = (type === 'shoot') ? 12 : 16;
                let obj = { ci: nextSeq(), x: c.x + Math.cos(a) * spawnDist, y: c.y + Math.sin(a) * spawnDist, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, r, angle: Math.random() * Math.PI, type };
                if (type === 'shoot') { obj.c1 = '#ff2a2a'; obj.c2 = '#fff'; } else { obj.c1 = c.colorBot; obj.c2 = c.colorTop; }
                this.ejectedMasses.push(obj); this.emit({ type: 'shootSound', isBot: false, playerId: p.id, x: c.x, y: c.y });
            }
        }

        performSplit(cell, angle) {
            let nR = cell.r / 1.414; cell.r = nR; cell.bornTime = this.now;
            let s = new Cell(cell.x + Math.cos(angle) * cell.r * 2, cell.y + Math.sin(angle) * cell.r * 2, nR, cell.colorBot, cell.colorTop, cell.name, cell.isBot, cell.skinUrl, cell.id, this.now);
            if (cell.isBot) { s.botSkills = [...cell.botSkills]; s.botGcd = cell.botGcd; s.botNextSkillTime = cell.botNextSkillTime; s.massMilestoneMet = cell.massMilestoneMet; }
            // sprint/magnet viven en cada celda: las piezas nuevas heredan el buff activo
            s.magnetTime = cell.magnetTime; s.sprintTime = cell.sprintTime;
            s.boostX = Math.cos(angle) * SPLIT_FORCE; s.boostY = Math.sin(angle) * SPLIT_FORCE;
            this.ownerCellsOf(cell).push(s);
            this.emit({ type: 'splitSound', isBot: cell.isBot, x: cell.x, y: cell.y });
        }

        splitPlayer(p, tx, ty) {
            if (this.now - p.lastSplitTime < SPLIT_COOLDOWN_MS || p.cells.length >= MAX_CELLS) return;
            let did = false;
            for (let i = p.cells.length - 1; i >= 0; i--) { let c = p.cells[i]; if (c.r >= 35 && p.cells.length < MAX_CELLS) { let a = Math.atan2(ty - c.y, tx - c.x); this.performSplit(c, a); did = true; } }
            if (did) p.lastSplitTime = this.now;
        }

        triggerRandomSplit(p) {
            if (p.cells.length >= MAX_CELLS) return;
            let newC = [];
            p.cells.forEach(c => {
                if (c.r >= 35 && p.cells.length + newC.length < MAX_CELLS) {
                    let nR = c.r / 1.414; c.r = nR; c.bornTime = this.now; let a = Math.random() * Math.PI * 2;
                    let s = new Cell(c.x + Math.cos(a) * c.r * 2, c.y + Math.sin(a) * c.r * 2, nR, c.colorBot, c.colorTop, c.name, false, c.skinUrl, c.id, this.now);
                    s.magnetTime = c.magnetTime; s.sprintTime = c.sprintTime;
                    s.boostX = Math.cos(a) * SPLIT_FORCE; s.boostY = Math.sin(a) * SPLIT_FORCE; newC.push(s);
                }
            });
            p.cells.push(...newC);
            if (p.cells.length > 0) this.emit({ type: 'explosion', x: p.cells[0].x, y: p.cells[0].y });
        }

        isHiddenInVirus(cell) { for (let v of this.viruses) { if (cell.r < v.r && getEllipticalDist(cell, v) + cell.r < v.r) { return true; } } return false; }

        handleVirusCollision(v, vIdx, cell, isP = false) {
            this.emit({ type: 'explosion', x: v.x, y: v.y });
            if (vIdx !== -1) { this.virusPool.free(this.viruses[vIdx]); this.viruses.splice(vIdx, 1); }
            this.spawnVirus();
            this.emit({ type: 'virusSound', isBot: cell.isBot, x: v.x, y: v.y });
            if (!isP) { let g = (cell.mass < VIRUS_GAIN_THRESHOLD) ? VIRUS_GAIN_LOW : VIRUS_GAIN_HIGH; cell.r = Math.sqrt((cell.mass + g) / (Math.PI * PILL_RATIO)); if (!cell.isBot) this.emit({ type: 'text', playerId: cell.id, world: true, text: "VIRUS GAIN MASS+", color: "#00FF00" }); }
            if (cell.immuneTime > 0) return;
            let list = this.ownerCellsOf(cell); let lim = MAX_CELLS; let myCount = 0;
            if (cell.isBot) { for (let e of this.enemies) if (e.id === cell.id) myCount++; } else { myCount = list.length; }
            if (myCount >= lim) return;
            cell.r /= 1.732; cell.bornTime = this.now;
            for (let k = 0; k < 2; k++) {
                let currentCountCheck = 0; if (cell.isBot) { for (let e of this.enemies) if (e.id === cell.id) currentCountCheck++; } else { currentCountCheck = list.length; } if (currentCountCheck >= lim) break;
                let a = Math.random() * Math.PI * 2; let f = new Cell(cell.x, cell.y, cell.r, cell.colorBot, cell.colorTop, cell.name, cell.isBot, cell.skinUrl, cell.id, this.now);
                if (cell.isBot) { f.botSkills = [...cell.botSkills]; f.botGcd = cell.botGcd; f.botNextSkillTime = cell.botNextSkillTime; f.massMilestoneMet = cell.massMilestoneMet; f.immuneTime = cell.immuneTime; }
                f.magnetTime = cell.magnetTime; f.sprintTime = cell.sprintTime;
                f.boostX = Math.cos(a) * 45; f.boostY = Math.sin(a) * 45; list.push(f);
            }
        }

        // Las celdas de atk intentan comer a las de def (mismas reglas que contra bots:
        // 15% más grande, dist < r*0.8, escudo/teleport/escondido en virus respetados).
        resolvePlayerCombat(atk, def) {
            for (let i = atk.cells.length - 1; i >= 0; i--) {
                const cA = atk.cells[i];
                for (let k = def.cells.length - 1; k >= 0; k--) {
                    const cB = def.cells[k];
                    if (cA.tpPhase > 0 || cB.tpPhase > 0) continue;
                    if (cB.immuneTime > 0) continue;
                    if (def.godMode) continue;
                    if (cA.r > cB.r * 1.15 && getEllipticalDist(cA, cB) < cA.r * 0.8 && !this.isHiddenInVirus(cB)) {
                        cA.r = Math.sqrt((cA.mass + cB.mass) / (Math.PI * PILL_RATIO));
                        def.cells.splice(k, 1);
                        if (def.cells.length === 0) {
                            if (this.config.mode === 'classic') atk.killStreak++;
                            this.emit({ type: 'botKilled', playerId: atk.id, victimId: def.id, botName: def.name || 'PLAYER', streak: atk.killStreak, mode: this.config.mode });
                            if (def.alive) { def.alive = false; this.emit({ type: 'playerDied', playerId: def.id }); }
                        } else {
                            this.emit({ type: 'botPieceEaten', playerId: atk.id });
                        }
                    }
                }
            }
        }

        resolveCellCollision(c1, c2, sameTeam) {
            if (c1.tpPhase > 0 || c2.tpPhase > 0) return;
            let dx = c1.x - c2.x; let dy = c1.y - c2.y; let dist = Math.sqrt(dx * dx + dy * dy); let minDist = c1.r + c2.r;
            if (dist < minDist && dist > 0.001) {
                let pen = minDist - dist;
                if (sameTeam) {
                    if (c1.canMerge(this.now) && c2.canMerge(this.now)) {
                        if (c1.mass >= c2.mass) { c1.r = Math.sqrt((c1.mass + c2.mass) / (Math.PI * PILL_RATIO)); c2.r = 0; }
                        else { c2.r = Math.sqrt((c2.mass + c1.mass) / (Math.PI * PILL_RATIO)); c1.r = 0; }
                    } else {
                        let f = pen / dist * 0.5;
                        let tx = dx * f; let ty = dy * f;
                        c1.x += tx; c1.y += ty; c2.x -= tx; c2.y -= ty;
                    }
                }
            }
        }

        // Comandos de reglas/hacks (consola del juego). Misma autoridad que el resto
        // de la sim: en local se llama directo, en red lo invoca el servidor.
        runCommand(id, name, args, fromAdmin = false) {
            // id puede ser null cuando lo invoca el panel de admin (reglas de sala);
            // los comandos que actúan sobre un jugador concreto exigen id válido.
            // fromAdmin = el panel de admin lo ejecuta sobre un jugador (salta enforceGod).
            const p = id ? this.players.get(id) : null;
            if (id && !p) return;
            args = Array.isArray(args) ? args : [];
            const say = (text, color) => { if (p) this.emit({ type: 'text', playerId: id, world: false, text, color: color || '#00ffaa' }); };
            name = String(name || '').toLowerCase();
            // Servidor autoritativo (enforceGod): los comandos de truco exigen GOD,
            // que solo concede el panel de admin (id === null). Offline = sin restricción.
            if (this.config.enforceGod && !fromAdmin && id !== null && !(p && p.godMode)) {
                return say('🔒 COMANDOS SOLO EN MODO GOD', '#ff5555');
            }
            if (name === 'god') {
                if (!p) return;
                p.godMode = !p.godMode;
                // En arcade/skills, god también da TODAS las skills (999 usos);
                // al quitarlo, la barra vuelve a los 4 huecos vacíos.
                if (this.config.mode !== 'classic') {
                    p.skillSlots = p.godMode
                        ? Array(10).fill().map((_, k) => (k < 8 ? { id: k + 1, uses: 999 } : null))
                        : [null, null, null, null];
                    this.emit({ type: 'skillsUI', playerId: id });
                }
                say('GOD MODE: ' + (p.godMode ? 'ON' : 'OFF'));
            } else if (name === 'mass') {
                if (!p) return;
                const n = parseFloat(args[0]);
                if (!(n > 0)) return say('USO: /mass 50000', '#ff5555');
                if (p.cells.length === 0) return say('ESTAS MUERTO', '#ff5555');
                const per = Math.max(314, n / p.cells.length);
                p.cells.forEach(c => { c.r = Math.sqrt(per / (Math.PI * PILL_RATIO)); });
                say('MASS = ' + Math.floor(per * p.cells.length));
            } else if (name === 'bots') {
                const n = parseInt(args[0], 10);
                if (isNaN(n) || n < 0 || n > 200) return say('USO: /bots 25 (0-200)', '#ff5555');
                this.config.botConfig.count = n; this.config.botConfig.enabled = n > 0;
                const groups = [...new Set(this.enemies.map(e => e.id))];
                if (groups.length < n) { for (let i = groups.length; i < n; i++) this.spawnBot(); }
                else if (groups.length > n) { const toRemove = new Set(groups.slice(n)); this.enemies = this.enemies.filter(e => !toRemove.has(e.id)); }
                say('BOTS = ' + n);
            } else if (name === 'speed') {
                let x = parseFloat(args[0]);
                if (isNaN(x)) return say('USO: /speed 2 (0.25-5)', '#ff5555');
                x = Math.max(0.25, Math.min(5, x));
                this.config.worldSettings.speed = x;
                say('SPEED x' + x);
            } else if (name === 'help') {
                say('/god  /mass N  /bots N  /speed X');
            } else {
                say('COMANDO DESCONOCIDO: /' + name + ' (prueba /help)', '#ff5555');
            }
        }

        // Da una skill al jugador (elección de carta en arcade).
        grantSkillToPlayer(id, skillId) {
            const p = this.players.get(id); if (!p) return;
            let idx = p.skillSlots.findIndex(s => s && s.id === skillId);
            if (idx !== -1) { p.skillSlots[idx].uses += SKILL_DEFS[skillId].uses; }
            else { let slot = p.skillSlots.indexOf(null); if (slot === -1) slot = 3; p.skillSlots[slot] = { id: skillId, uses: SKILL_DEFS[skillId].uses }; }
            this.emit({ type: 'skillsUI', playerId: id });
        }

        useSkill(p, slotIndex, tx, ty) {
            if (p.globalCD > 0) return;
            if (this.config.mode === 'classic') {
                if (slotIndex === 1) { if (p.cells.some(c => c.mass > SKILL_PARAMS.shootCost + 314) || p.godMode) { this.emitProjectile(p, 'shoot', SKILL_PARAMS.shootCost, tx, ty); p.globalCD = GLOBAL_CD_MS; } }
                else if (slotIndex === 2 && p.godMode) { let totalGain = 10000; let gainPerCell = (p.cells.length > 0) ? (totalGain / p.cells.length) : totalGain; p.cells.forEach(c => { c.r = Math.sqrt((c.mass + gainPerCell) / (Math.PI * PILL_RATIO)); c.flashColor = '#00ff00'; c.flashTime = 1000; c.spawnParticles(this, 'PLUS'); }); this.emit({ type: 'skillUsed', playerId: p.id, id: 'godmass' }); p.globalCD = 200; }
                return;
            }
            if (slotIndex > p.skillSlots.length) return;
            let skillObj = p.skillSlots[slotIndex - 1];
            if (skillObj && skillObj.uses <= 0 && !p.godMode) { p.skillSlots[slotIndex - 1] = null; this.emit({ type: 'skillsUI', playerId: p.id }); return; }
            if (!skillObj) return;
            let def = SKILL_DEFS[skillObj.id]; if (p.skillState[skillObj.id] > 0) return;
            let activated = false, id = skillObj.id, win = false;
            if (id === 1) { if (p.cells.some(c => c.mass > SKILL_PARAMS.clonCost + 314) || p.godMode) { this.emitProjectile(p, 'clon', SKILL_PARAMS.clonCost, tx, ty); activated = true; } }
            else if (id === 2) { if (p.cells.some(c => c.mass > SKILL_PARAMS.shootCost + 314) || p.godMode) { this.emitProjectile(p, 'shoot', SKILL_PARAMS.shootCost, tx, ty); activated = true; } }
            else if (id === 3) { p.cells.forEach(c => c.sprintTime = SKILL_PARAMS.sprintDuration); activated = true; }
            else if (id === 4) { let limit = this.mapSize - 300; let targetX = Math.random() * (limit * 2) - limit; let targetY = Math.random() * (limit * 2) - limit; let avgX = 0, avgY = 0; p.cells.forEach(c => { avgX += c.x; avgY += c.y; }); avgX /= p.cells.length; avgY /= p.cells.length; let dx = targetX - avgX, dy = targetY - avgY; p.cells.forEach(c => { c.tpPhase = 1; c.tpTimer = 500; c.tpDest = { x: c.x + dx, y: c.y + dy }; }); activated = true; }
            else if (id === 5) { activated = true; }
            else if (id === 6) { p.cells.forEach(c => c.immuneTime = SKILL_PARAMS.shieldDuration); activated = true; }
            else if (id === 7) { let totalGain = Math.floor(Math.random() * (SKILL_PARAMS.bigMax - SKILL_PARAMS.bigMin + 1)) + SKILL_PARAMS.bigMin, gainPerCell = (p.cells.length > 0) ? (totalGain / p.cells.length) : totalGain; p.cells.forEach(c => { c.r = Math.sqrt((c.mass + gainPerCell) / (Math.PI * PILL_RATIO)); c.flashColor = '#00ff00'; c.flashTime = 1000; c.spawnParticles(this, 'PLUS'); }); activated = true; }
            else if (id === 8) { let totalVal = (Math.random() < 0.5) ? -5000 : 15000, valPerCell = (p.cells.length > 0) ? (totalVal / p.cells.length) : totalVal; p.cells.forEach(c => { let newMass = c.mass + valPerCell; if (newMass < 314) newMass = 314; c.r = Math.sqrt(newMass / (Math.PI * PILL_RATIO)); c.flashColor = (valPerCell >= 0) ? '#00ff00' : '#ff0000'; c.flashTime = 1000; c.spawnParticles(this, valPerCell >= 0 ? 'PLUS' : 'MINUS'); }); activated = true; win = totalVal >= 0; }
            if (activated) {
                if (!p.godMode) skillObj.uses--;
                if (id >= 3 && id <= 8) { p.skillState[id] = def.maxActive; }
                p.globalCD = GLOBAL_CD_MS;
                // Emite skillUsed para todas las skills 1-8 (antes solo 3-8). El cliente lo usa para sonidos
                // específicos de slots 3-8 y para contar Q3 (use 2 skills) — ahora cuentan los 8 slots.
                this.emit({ type: 'skillUsed', playerId: p.id, id, win });
                this.emit({ type: 'skillsUI', playerId: p.id });
            }
        }

        step(deltaMs) {
            const delta = deltaMs;
            this.timeScale = delta / (1000 / 60); if (this.timeScale > 3) this.timeScale = 3;
            this.now += delta;
            const timeScale = this.timeScale;

            // Timers por jugador + acciones encoladas (split / skills)
            for (const p of this.players.values()) {
                if (p.globalCD > 0) { p.globalCD -= delta; if (p.globalCD < 0) p.globalCD = 0; }
                for (let i = 1; i <= 8; i++) { if (p.skillState[i] > 0) { p.skillState[i] -= delta; if (p.skillState[i] < 0) p.skillState[i] = 0; } }
                const actions = p.actions; p.actions = [];
                for (const a of actions) {
                    if (a.kind === 'split') this.splitPlayer(p, a.tx, a.ty);
                    else if (a.kind === 'skill') this.useSkill(p, a.slot, a.tx, a.ty);
                }
            }

            this.foodGrid.clear();
            for (let f of this.foods) this.foodGrid.insert(f);

            // Imán: atrae comida cercana hacia cada celda del jugador con la skill activa.
            // Antes iteraba TODAS las foods por cada celda (O(N×K) con N=miles); ahora consulta
            // el foodGrid en el radio del magnet (~3-4 celdas del grid) — 2 órdenes menos.
            for (const p of this.players.values()) {
                if (p.skillState[5] <= 0) continue;
                for (const c of p.cells) {
                    if (c.tpPhase > 0) continue;
                    const range = SKILL_PARAMS.magnetRange + c.r;
                    const nearby = this.foodGrid.query(c.x, c.y, range);
                    for (const f of nearby) {
                        const dx = c.x - f.x, dy = c.y - f.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist < range && dist > 1) {
                            f.x += (dx / dist) * 3 * timeScale;
                            f.y += (dy / dist) * 3 * timeScale;
                        }
                    }
                }
            }

            // Auto-split por hitos de masa
            for (const p of this.players.values()) {
                if (!p.alive) continue;
                let totalM = 0; p.cells.forEach(c => totalM += c.mass);
                if (totalM >= AUTO_SPLIT_LEVEL_1 && !p.splitMilestones.level1) { this.triggerRandomSplit(p); p.splitMilestones.level1 = true; }
                if (totalM >= AUTO_SPLIT_LEVEL_2 && !p.splitMilestones.level2) { this.triggerRandomSplit(p); p.splitMilestones.level2 = true; }
            }

            // Masas eyectadas (disparos / clon): física, impactos y alimentación de virus
            let living = this.livingCells();
            for (let i = this.ejectedMasses.length - 1; i >= 0; i--) {
                let m = this.ejectedMasses[i], f = (m.type === 'shoot') ? 0.93 : 0.9; m.x += m.vx * timeScale; m.y += m.vy * timeScale; m.vx *= Math.pow(f, timeScale); m.vy *= Math.pow(f, timeScale);
                // Shoot impacta jugador: SIN explosión visual (era ruido innecesario al
                // disparar contra rivales; la explosión solo se mantiene contra virus lila).
                if (m.type === 'shoot') { for (let c of living) { if (getEllipticalDist(m, c) < c.r) { this.ejectedMasses.splice(i, 1); break; } } }
                for (let c of living) { if (getEllipticalDist(m, c) < c.r) { c.r = Math.sqrt((c.mass + (Math.PI * m.r * m.r * 2)) / (Math.PI * PILL_RATIO)); this.ejectedMasses.splice(i, 1); break; } }
                if (i < this.ejectedMasses.length) {
                    for (let vIdx = 0; vIdx < this.viruses.length; vIdx++) {
                        let v = this.viruses[vIdx];
                        if (Math.hypot(m.x - v.x, m.y - v.y) < v.r) {
                            if (m.type === 'shoot') { this.ejectedMasses.splice(i, 1); if (!v.damaged) { v.damaged = true; v.animTime = 0; this.emit({ type: 'explosion', x: v.x, y: v.y }); } else { this.emit({ type: 'explosion', x: v.x, y: v.y }); this.virusPool.free(this.viruses[vIdx]); this.viruses.splice(vIdx, 1); this.projectiles.push({ ci: nextSeq(), x: v.x, y: v.y, vx: Math.cos(Math.atan2(m.vy, m.vx)) * 20, vy: Math.sin(Math.atan2(m.vy, m.vx)) * 20, r: 25, type: 'virusShot' }); this.spawnVirus(); } }
                            else { this.ejectedMasses.splice(i, 1); this.emit({ type: 'explosion', x: v.x, y: v.y }); v.hits = (v.hits || 0) + 1; v.r += 6; if (v.hits >= 2) { v.hits = 0; v.r = 70; let a = Math.atan2(m.vy, m.vx); let vNew = this.virusPool.get(); vNew.ci = nextSeq(); vNew.x = v.x + Math.cos(a) * 55; vNew.y = v.y + Math.sin(a) * 55; vNew.r = 70; vNew.vx = Math.cos(a) * 30; vNew.vy = Math.sin(a) * 30; vNew.hits = 0; vNew.damaged = false; this.viruses.push(vNew); this.emit({ type: 'virusFedSplit' }); } }
                            break;
                        }
                    }
                }
            }

            // Proyectiles de virus (explosión púrpura)
            for (let i = this.projectiles.length - 1; i >= 0; i--) { let pr = this.projectiles[i]; pr.x += pr.vx * timeScale; pr.y += pr.vy * timeScale; if (Math.abs(pr.x) > this.mapSize || Math.abs(pr.y) > this.mapSize) { this.projectiles.splice(i, 1); continue; } for (let c of living) { if (c.immuneTime > 0 || c.tpPhase > 0) continue; if (getEllipticalDist(pr, c) < c.r + pr.r) { this.emit({ type: 'explosion', x: c.x, y: c.y }); this.handleVirusCollision({ x: c.x, y: c.y }, -1, c, true); this.projectiles.splice(i, 1); break; } } }

            // Virus: movimiento y colisión con celdas
            for (let i = 0; i < this.viruses.length; i++) {
                let v = this.viruses[i]; if (v.damaged && v.animTime < 1) { v.animTime += 0.015 * timeScale; if (v.animTime > 1) v.animTime = 1; }
                v.x += v.vx * timeScale; v.y += v.vy * timeScale; v.vx *= Math.pow(0.94, timeScale); v.vy *= Math.pow(0.94, timeScale);
                if (Math.abs(v.x) > this.mapSize) v.vx *= -1; if (Math.abs(v.y) > this.mapSize) v.vy *= -1;
                for (let c of living) { if (c.immuneTime > 0 || c.tpPhase > 0) continue; let vulnerable = (c.mass >= 15000) || (c.r > v.r); if (((v.vx ** 2 + v.vy ** 2) > 25 && getEllipticalDist(c, v) < c.r + v.r - 10) || (vulnerable && getEllipticalDist(c, v) < c.r * 0.9)) { this.handleVirusCollision(v, i, c, false); i--; break; } }
            }

            // Celdas de jugadores: movimiento, colisiones internas, muerte
            for (const p of this.players.values()) {
                if (p.cells.length > 0) {
                    let maxR = 0; for (const c of p.cells) if (c.r > maxR) maxR = c.r;
                    for (const c of p.cells) c.groupMaxR = maxR;
                }
                for (let i = 0; i < p.cells.length; i++) { let c = p.cells[i]; c.update(this, delta, p.input); for (let j = i + 1; j < p.cells.length; j++) this.resolveCellCollision(c, p.cells[j], true); }
                p.cells = p.cells.filter(c => c.r > 0);
                if (p.alive && p.cells.length === 0) { p.alive = false; this.emit({ type: 'playerDied', playerId: p.id }); }
            }

            // Bots: IA + movimiento. groupMaxR precalculado en O(N) en vez de O(N²).
            const _botMaxR = new Map();
            for (const bot of this.enemies) { const prev = _botMaxR.get(bot.id) || 0; if (bot.r > prev) _botMaxR.set(bot.id, bot.r); }
            for (const bot of this.enemies) { bot.groupMaxR = _botMaxR.get(bot.id) || bot.r; bot.update(this, delta, null); }

            for (let i = this.enemies.length - 1; i >= 0; i--) {
                let bot = this.enemies[i]; if (bot.r <= 0) { this.enemies.splice(i, 1); continue; }
                let resolved = false;
                for (const p of this.players.values()) {
                    for (let k = p.cells.length - 1; k >= 0; k--) {
                        let c = p.cells[k]; if (c.tpPhase > 0 || bot.tpPhase > 0) continue; if (c.immuneTime > 0 && bot.r > c.r) continue; if (bot.immuneTime > 0 && c.r > bot.r) continue;
                        if (this.config.mode === 'classic' && p.killStreak >= 5) continue;
                        let botHiding = this.isHiddenInVirus(bot); let playerHiding = this.isHiddenInVirus(c);
                        if (!p.godMode && bot.r > c.r * 1.15 && getEllipticalDist(bot, c) < bot.r * 0.8 && !playerHiding) { bot.r = Math.sqrt((bot.mass + c.mass) / (Math.PI * PILL_RATIO)); p.cells.splice(k, 1); }
                        else if (c.r > bot.r * 1.15 && getEllipticalDist(c, bot) < c.r * 0.8 && !botHiding) {
                            c.r = Math.sqrt((c.mass + bot.mass) / (Math.PI * PILL_RATIO)); let botId = bot.id; let botName = bot.name; this.enemies.splice(i, 1);
                            let remainingPieces = this.enemies.filter(e => e.id === botId).length;
                            if (remainingPieces === 0) {
                                if (this.config.mode === 'classic') { p.killStreak++; }
                                this.emit({ type: 'botKilled', playerId: p.id, botName, streak: p.killStreak, mode: this.config.mode });
                                if (this.config.botConfig.respawn) this.botRespawnQueue.push(this.now + 3000);
                            } else { this.emit({ type: 'botPieceEaten', playerId: p.id }); }
                            i--; resolved = true; break;
                        }
                    }
                    if (resolved) break;
                }
                if (i < 0 || i >= this.enemies.length) continue;
                for (let j = i - 1; j >= 0; j--) {
                    let other = this.enemies[j]; this.resolveCellCollision(bot, other, bot.id === other.id);
                    if (bot.id !== other.id) {
                        if (bot.r > other.r * 1.15 && getEllipticalDist(bot, other) < bot.r * 0.6) { if (!this.isHiddenInVirus(other) && other.immuneTime <= 0) { bot.r = Math.sqrt((bot.mass + other.mass) / (Math.PI * PILL_RATIO)); let otherId = other.id; this.enemies.splice(j, 1); let remaining = this.enemies.filter(e => e.id === otherId).length; if (remaining === 0 && this.config.botConfig.respawn) this.botRespawnQueue.push(this.now + 3000); i--; } }
                        else if (other.r > bot.r * 1.15 && getEllipticalDist(other, bot) < other.r * 0.6) { if (!this.isHiddenInVirus(bot) && bot.immuneTime <= 0) { other.r = Math.sqrt((other.mass + bot.mass) / (Math.PI * PILL_RATIO)); let botId = bot.id; this.enemies.splice(i, 1); let remaining = this.enemies.filter(e => e.id === botId).length; if (remaining === 0 && this.config.botConfig.respawn) this.botRespawnQueue.push(this.now + 3000); break; } }
                    }
                }
            }

            // Combate jugador contra jugador (PvP)
            const plist = [...this.players.values()];
            for (let a = 0; a < plist.length; a++) {
                for (let b = a + 1; b < plist.length; b++) {
                    const pA = plist[a], pB = plist[b];
                    if (this.config.mode === 'classic' && (pA.killStreak >= 5 || pB.killStreak >= 5)) continue;
                    this.resolvePlayerCombat(pA, pB);
                    this.resolvePlayerCombat(pB, pA);
                }
            }

            // Comer comida (grid espacial)
            living = this.livingCells(); let gainMultiplier = this.config.worldSettings.food || 1;
            living.forEach(c => {
                const nearbyFoods = this.foodGrid.query(c.x, c.y);
                for (let f of nearbyFoods) {
                    if (f.eaten) continue;
                    if (getEllipticalDist(c, f) < c.r + f.r) {
                        let gain = (Math.PI * f.r * f.r * 2.5) * gainMultiplier;
                        c.r = Math.sqrt((c.mass + gain) / (Math.PI * PILL_RATIO));
                        f.eaten = true;
                    }
                }
            });
            for (let i = this.foods.length - 1; i >= 0; i--) {
                if (this.foods[i].eaten) {
                    this.foods[i].eaten = false;
                    this.foodPool.free(this.foods[i]);
                    this.foods[i] = this.foods[this.foods.length - 1];
                    this.foods.pop();
                    this.spawnFood();
                    // Diff replicable en cliente: f[i]=f[último]; f.pop(); f.push(food)
                    if (this.config.emitFoodEvents) this.emit({ type: 'foodRespawn', index: i, food: this.foods[this.foods.length - 1] });
                }
            }

            // Respawn de bots pendientes
            for (let i = this.botRespawnQueue.length - 1; i >= 0; i--) {
                if (this.botRespawnQueue[i] <= this.now) { this.botRespawnQueue.splice(i, 1); this.spawnBot(); }
            }
        }
    }

    return {
        Simulation, Cell, ObjectPool, SpatialGrid,
        uuid, getEllipticalDist, getRandomColor,
        WORLD_CONFIG, SKILL_PARAMS, SKILL_DEFS,
        VIRUS_RADIUS, VIRUS_GAIN_LOW, VIRUS_GAIN_HIGH, VIRUS_GAIN_THRESHOLD,
        BASE_MERGE_TIME, MERGE_MASS_FACTOR, SPLIT_COOLDOWN_MS, GLOBAL_CD_MS,
        AUTO_SPLIT_LEVEL_1, AUTO_SPLIT_LEVEL_2,
        INITIAL_RADIUS, MAX_CELLS, VELOC_BASE, SPLIT_FORCE, PILL_RATIO,
        COLORS, BOT_NAMES
    };
}));
